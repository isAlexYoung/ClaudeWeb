import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { ProjectMemoryEntry, ProjectMemorySnapshot, TextQuote } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const START = '<!-- claudeweb-project-memories:start -->';
const END = '<!-- claudeweb-project-memories:end -->';
const fail = (code: string, statusCode = 400): never => { throw new AppError(code, { code, statusCode }); };
const hash = (content: string | null) => createHash('sha256').update(content === null ? 'missing' : `file:${content}`).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
type Provenance = { source: TextQuote; sessionId: string; createdAt: string };

function parse(content: string) {
  const start = content.indexOf(START), end = content.indexOf(END);
  if (start < 0 && end < 0) return { start: -1, end: -1, entries: [] as ProjectMemoryEntry[] };
  if (start < 0 || end < start || content.indexOf(START, start + START.length) >= 0 || content.indexOf(END, end + END.length) >= 0) return fail('MEMORY_FORMAT_CONFLICT', 409);
  const region = content.slice(start + START.length, end);
  const entries: ProjectMemoryEntry[] = [];
  const pattern = /<!-- claudeweb-memory:([0-9a-f-]{36}) (\S+) -->\r?\n([\s\S]*?)\r?\n<!-- \/claudeweb-memory:\1 -->/g;
  for (const match of region.matchAll(pattern)) {
    if (entries.some(entry => entry.id === match[1])) fail('MEMORY_FORMAT_CONFLICT', 409);
    entries.push({ id: match[1], text: match[3], updatedAt: match[2], createdAt: match[2] });
  }
  // Never replace hand-edited or damaged managed content we cannot account for.
  const residue = region.replace(pattern, '').replace(/^\s*## Project memories\s*/, '').trim();
  if (residue) fail('MEMORY_FORMAT_CONFLICT', 409);
  return { start, end: end + END.length, entries };
}

/** Used by the project-memory API and filesystem tests; CLAUDE.md is the authoritative memory text. */
export function createProjectMemoryService(resolveProject: (id: string) => Promise<string | null | undefined> | string | null | undefined) {
  async function project(id: string) {
    const configured = await resolveProject(id);
    if (!configured) return fail('MEMORY_PROJECT_NOT_FOUND', 404);
    const root = await fs.realpath(configured);
    const file = path.join(root, 'CLAUDE.md');
    const directory = path.join(root, '.claude');
    const index = path.join(directory, 'claudeweb-memory-sources.json');
    return { root, file, directory, index };
  }
  async function read(file: string): Promise<string | null> {
    try {
      const stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile()) return fail('MEMORY_UNSAFE_PATH', 409);
      if (stat.size > 2_000_000) return fail('MEMORY_FILE_TOO_LARGE', 413);
      return await fs.readFile(file, 'utf8');
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  async function checkDirectory(directory: string) {
    try { if ((await fs.lstat(directory)).isSymbolicLink() || !(await fs.stat(directory)).isDirectory()) fail('MEMORY_UNSAFE_PATH', 409); }
    catch (error) { if (!missing(error)) throw error; }
  }
  async function sources(index: string): Promise<Record<string, Provenance>> {
    const raw = await read(index);
    if (raw === null) return {};
    try {
      const data = JSON.parse(raw);
      if (data?.schema !== 1 || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) return fail('MEMORY_INDEX_CONFLICT', 409);
      return data.entries;
    } catch { return fail('MEMORY_INDEX_CONFLICT', 409); }
  }
  async function snapshot(id: string): Promise<ProjectMemorySnapshot> {
    const target = await project(id);
    await checkDirectory(target.directory);
    const content = await read(target.file);
    const metadata = await sources(target.index);
    const { entries } = parse(content || '');
    return { projectId: id, path: target.file, version: hash(content), entries: entries.map(entry => {
      const origin = metadata[entry.id], source = origin?.source;
      const valid = source && typeof source.text === 'string' && typeof source.role === 'string' && typeof source.messageKey === 'string'
        && ['text', 'thinking'].includes(source.kind) && typeof source.timestamp === 'string' && Number.isSafeInteger(source.startOffset);
      return { ...entry, ...(valid && typeof origin.sessionId === 'string' ? { source, sourceSessionId: origin.sessionId, createdAt: typeof origin.createdAt === 'string' ? origin.createdAt : entry.createdAt } : {}) };
    }) };
  }
  async function atomicWrite(file: string, content: string) {
    const temporary = `${file}.${randomUUID()}.tmp`;
    let mode = 0o600;
    try { mode = (await fs.lstat(file)).mode & 0o777; } catch (error) { if (!missing(error)) throw error; }
    try {
      const handle = await fs.open(temporary, 'wx', mode);
      try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary, file);
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  async function change(id: string, expectedVersion: unknown, update: (entries: ProjectMemoryEntry[], metadata: Record<string, Provenance>) => void) {
    if (typeof expectedVersion !== 'string') return fail('MEMORY_VERSION_REQUIRED', 400);
    const target = await project(id);
    await checkDirectory(target.directory);
    await fs.mkdir(target.directory, { recursive: true });
    await checkDirectory(target.directory);
    const lock = path.join(target.directory, 'claudeweb-memory.lock');
    let handle;
    try { handle = await fs.open(lock, 'wx', 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A process crash must not leave the project permanently locked.
      let abandoned = false;
      try {
        const owner = JSON.parse(await fs.readFile(lock, 'utf8'));
        if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
          try { process.kill(owner.pid, 0); } catch (probe) { abandoned = (probe as NodeJS.ErrnoException).code === 'ESRCH'; }
        }
      } catch { abandoned = Date.now() - (await fs.lstat(lock)).mtimeMs > 120_000; }
      if (!abandoned) return fail('MEMORY_BUSY', 409);
      await fs.unlink(lock);
      try { handle = await fs.open(lock, 'wx', 0o600); } catch { return fail('MEMORY_BUSY', 409); }
    }
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid }));
      const before = await read(target.file);
      if (hash(before) !== expectedVersion) return fail('MEMORY_VERSION_CONFLICT', 409);
      const parsed = parse(before || '');
      const metadata = await sources(target.index);
      const retainedIds = new Set(parsed.entries.map(entry => entry.id));
      update(parsed.entries, metadata);
      parsed.entries.forEach(entry => retainedIds.add(entry.id));
      const section = `${START}\n## Project memories\n\n${parsed.entries.map(entry => `<!-- claudeweb-memory:${entry.id} ${entry.updatedAt} -->\n${entry.text}\n<!-- /claudeweb-memory:${entry.id} -->`).join('\n\n')}\n${END}`;
      const next = parsed.start < 0 ? `${before || ''}${before ? '\n\n' : ''}${section}\n`
        : `${(before || '').slice(0, parsed.start)}${section}${(before || '').slice(parsed.end)}`;
      const nextIndex = `${JSON.stringify({ schema: 1, entries: Object.fromEntries(Object.entries(metadata).filter(([entryId]) => retainedIds.has(entryId))) }, null, 2)}\n`;
      if (Buffer.byteLength(next) > 2_000_000 || Buffer.byteLength(nextIndex) > 2_000_000) return fail('MEMORY_FILE_TOO_LARGE', 413);
      // Provenance is a sidecar, not model instructions. An interrupted write may leave an orphan
      // source entry; listings only use IDs actually present in CLAUDE.md, so it never invents a memory.
      await atomicWrite(target.index, nextIndex);
      if (hash(await read(target.file)) !== expectedVersion) return fail('MEMORY_VERSION_CONFLICT', 409);
      await checkDirectory(target.directory);
      await atomicWrite(target.file, next);
      return await snapshot(id);
    } finally { await handle.close(); await fs.unlink(lock).catch(() => {}); }
  }
  function text(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.length > 20_000 || /<!--\s*\/?claudeweb-/i.test(value)) return fail('INVALID_MEMORY_TEXT');
    return value.trim();
  }
  return {
    list: snapshot,
    create(id: string, body: Record<string, unknown>) {
      const content = text(body.text);
      const raw = body.source as Partial<TextQuote> | undefined;
      if (!raw || typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 100_000 || typeof raw.messageKey !== 'string'
        || typeof raw.role !== 'string' || !['text', 'thinking'].includes(raw.kind || '') || typeof body.sessionId !== 'string' || !body.sessionId) return fail('INVALID_MEMORY_SOURCE');
      const source: TextQuote = { id: randomUUID(), text: raw.text, messageKey: raw.messageKey, role: raw.role, kind: raw.kind!,
        timestamp: typeof raw.timestamp === 'string' ? raw.timestamp : '', startOffset: Number.isSafeInteger(raw.startOffset) && raw.startOffset! >= 0 ? raw.startOffset! : 0 };
      return change(id, body.version, (entries, metadata) => {
        if (entries.some(entry => entry.text === content)) return;
        if (entries.length >= 200) fail('MEMORY_LIMIT_REACHED', 409);
        const now = new Date().toISOString(), entry = { id: randomUUID(), text: content, createdAt: now, updatedAt: now };
        entries.push(entry);
        metadata[entry.id] = { source, sessionId: String(body.sessionId), createdAt: now };
      });
    },
    update(id: string, entryId: string, body: Record<string, unknown>) {
      const content = text(body.text);
      return change(id, body.version, entries => {
        const entry = entries.find(entry => entry.id === entryId) || fail('MEMORY_NOT_FOUND', 404);
        if (entries.some(other => other.id !== entryId && other.text === content)) fail('MEMORY_DUPLICATE', 409);
        entry.text = content; entry.updatedAt = new Date().toISOString();
      });
    },
    remove(id: string, entryId: string, version: unknown) {
      return change(id, version, entries => {
        const index = entries.findIndex(entry => entry.id === entryId);
        if (index < 0) fail('MEMORY_NOT_FOUND', 404);
        entries.splice(index, 1);
      });
    },
  };
}
