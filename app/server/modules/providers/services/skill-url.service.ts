import path from 'node:path';

import type { ProviderSkillCreateInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const MAX_FILES = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

type TreeEntry = { path: string; type: string; mode: string; size?: number };

const invalidLink = (message: string): AppError => new AppError(message, { code: 'PROVIDER_SKILL_URL_INVALID', statusCode: 400 });

function parseGitHubLink(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw invalidLink('Enter a public GitHub repository, skill folder or SKILL.md URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['github.com', 'raw.githubusercontent.com'].includes(url.hostname)) {
    throw invalidLink('Only HTTPS links to public GitHub repositories and skills are supported.');
  }
  let segments: string[];
  try { segments = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent); }
  catch { throw invalidLink('Invalid encoded skill URL.'); }
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\\x00-\x1f]/.test(segment))) throw invalidLink('Invalid skill URL path.');
  const [owner, rawRepo, ...rest] = segments;
  const repo = rawRepo?.replace(/\.git$/, '');
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) throw invalidLink('A GitHub owner and repository are required.');
  let ref = 'HEAD';
  let target = '';
  if (url.hostname === 'raw.githubusercontent.com') {
    if (rest.length < 2) throw invalidLink('A raw skill link must include a revision and SKILL.md.');
    ref = rest[0]; target = rest.slice(1).join('/');
  } else if (rest.length) {
    if (!['tree', 'blob'].includes(rest[0]) || rest.length < 2) throw invalidLink('Use a GitHub repository, tree or SKILL.md link.');
    ref = rest[1]; target = rest.slice(2).join('/');
  }
  if (target.toLowerCase().endsWith('/skill.md') || target.toLowerCase() === 'skill.md') target = path.posix.dirname(target);
  else if (url.hostname === 'raw.githubusercontent.com' || rest[0] === 'blob') throw invalidLink('A file link must point to SKILL.md.');
  return { owner, repo, ref, target: target === '.' ? '' : target };
}

/** Used only by the providers skills service; fetches complete GitHub skill folders before any install writes. */
export async function loadSkillsFromGitHub(value: string): Promise<ProviderSkillCreateInput> {
  const { owner, repo, ref, target } = parseGitHubLink(value);
  const signal = AbortSignal.timeout(60_000);
  let totalBytes = 0;
  const read = async (url: string, limit: number): Promise<Buffer> => {
    // All URLs are constructed here on fixed GitHub hosts; redirects cannot reach local services.
    let response: Response;
    try { response = await fetch(url, { redirect: 'error', signal, headers: { 'User-Agent': 'ClaudeWeb-skills', Accept: 'application/vnd.github+json' } }); }
    catch { throw invalidLink('Unable to download this skill. Check the link and server network, then retry.'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw invalidLink(response.status === 403 || response.status === 429 ? 'GitHub download limit reached. Retry later or upload the skill folder.' : `GitHub download failed (${response.status}). Check that the repository, revision and folder are public.`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw invalidLink('The skill download was empty.');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limit) throw invalidLink('The linked skill exceeds the download size limit. Upload a smaller skill folder.');
        chunks.push(chunk.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    return Buffer.concat(chunks);
  };
  const apiRoot = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const commit = JSON.parse((await read(`${apiRoot}/commits/${encodeURIComponent(ref)}`, 2 * 1024 * 1024)).toString()) as { sha?: string };
  if (!commit.sha || !/^[a-f0-9]{40}$/.test(commit.sha)) throw invalidLink('GitHub did not resolve this revision.');
  const tree = JSON.parse((await read(`${apiRoot}/git/trees/${commit.sha}?recursive=1`, 8 * 1024 * 1024)).toString()) as { truncated?: boolean; tree?: TreeEntry[] };
  if (tree.truncated || !Array.isArray(tree.tree)) throw invalidLink('This repository is too large. Upload the skill folder instead.');
  const inside = tree.tree.filter(entry => !target || entry.path.startsWith(`${target}/`));
  const roots = inside.filter(entry => entry.type === 'blob' && path.posix.basename(entry.path) === 'SKILL.md').map(entry => path.posix.dirname(entry.path));
  if (!roots.length || roots.length > 20) throw invalidLink('The link must contain between 1 and 20 skills. Link to a specific skill folder.');
  const entries: ProviderSkillCreateInput['entries'] = [];
  let fileCount = 0;
  for (const root of roots) {
    const files = inside.filter(entry => entry.path === `${root === '.' ? '' : `${root}/`}SKILL.md` || (root === '.' || entry.path.startsWith(`${root}/`)))
      .filter(entry => entry.type !== 'tree' && !roots.some(other => other !== root && (root === '.' || other.startsWith(`${root}/`)) && entry.path.startsWith(`${other}/`)));
    const entry: ProviderSkillCreateInput['entries'][number] = { fileName: 'SKILL.md', content: '', files: [] };
    for (const file of files) {
      const relativePath = root === '.' ? file.path : file.path.slice(root.length + 1);
      if (file.type !== 'blob' || !['100644', '100755'].includes(file.mode) || relativePath.split('/').some(segment => !segment || segment === '.' || segment === '..' || /[\\:\x00-\x1f]/.test(segment))) throw invalidLink('Skills cannot contain links, submodules or unsafe file paths.');
      if (++fileCount > MAX_FILES || (file.size ?? 0) > MAX_FILE_BYTES) throw invalidLink('The linked skills exceed the file count or size limit.');
      const content = await read(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${commit.sha}/${file.path.split('/').map(encodeURIComponent).join('/')}`, MAX_FILE_BYTES);
      totalBytes += content.length;
      if (totalBytes > MAX_TOTAL_BYTES) throw invalidLink('The linked skills exceed the total size limit.');
      if (relativePath === 'SKILL.md') entry.content = content.toString('utf8');
      else entry.files!.push({ relativePath, content: content.toString('base64'), encoding: 'base64' });
    }
    entries.push(entry);
  }
  return { entries };
}
