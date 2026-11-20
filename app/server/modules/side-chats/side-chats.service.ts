import { randomUUID } from 'node:crypto';
import type { sideChatsDb } from '@/modules/database/index.js';
import type { streamClaudeSideQuestion } from '@/modules/providers/index.js';
import type { SideChat, TextQuote } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

type Dependencies = {
  repository: typeof sideChatsDb;
  generate: typeof streamClaudeSideQuestion;
  resolveParent: (sessionId: string) => { projectId: string; cwd: string; provider: string; model: string | null; effort: string | null } | null;
};
const fail = (code: string, statusCode = 400): never => { throw new AppError(code, { code, statusCode }); };
function text(value: unknown, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) return fail('INVALID_SIDE_CHAT_INPUT');
  return value;
}
function publicChat(chat: SideChat): SideChat {
  // Explicit projection prevents repeatedly sending the potentially large context snapshot to browsers.
  const { id, parentSessionId, projectId, source, model, effort, createdAt, minimized, position, draft, status, error, messages } = chat;
  return { id, parentSessionId, projectId, source, model, effort, createdAt, minimized, position, draft, status, error, messages };
}

/** Used by the side-chat router and tests; persistence and SDK execution are injected boundaries. */
export function createSideChatsService({ repository, generate, resolveParent }: Dependencies) {
  const active = new Map<string, AbortController>();
  const get = (userId: number, id: string) => repository.get(userId, id) || fail('SIDE_CHAT_NOT_FOUND', 404);
  const key = (userId: number, id: string) => `${userId}:${id}`;
  const service = {
    close() {
      for (const controller of active.values()) controller.abort();
      active.clear();
    },
    list(userId: number, parent: string) { return repository.list(userId, parent).map(publicChat); },
    create(userId: number, body: Record<string, unknown>) {
      const parentSessionId = text(body.parentSessionId, 256);
      const parent = resolveParent(parentSessionId) || fail('SIDE_CHAT_PARENT_NOT_FOUND', 404);
      if (parent.provider !== 'claude') fail('SIDE_CHAT_PROVIDER_UNSUPPORTED');
      const raw = body.source as Partial<TextQuote> | undefined;
      if (!raw || (raw.kind !== 'text' && raw.kind !== 'thinking')) fail('INVALID_SIDE_CHAT_INPUT');
      const source: TextQuote = {
        id: randomUUID(), messageKey: text(raw!.messageKey, 1000), text: text(raw!.text, 100_000),
        role: text(raw!.role, 32), kind: raw!.kind!, timestamp: text(raw!.timestamp, 128),
        startOffset: Number.isInteger(raw!.startOffset) && raw!.startOffset! >= 0 ? raw!.startOffset! : 0,
      };
      const context = text(body.context, 2_000_000);
      const chat = {
        id: randomUUID(), parentSessionId, projectId: parent.projectId, source, context, cwd: parent.cwd,
        model: typeof body.model === 'string' && body.model.length <= 256 ? body.model : parent.model || 'default',
        effort: typeof body.effort === 'string' && body.effort.length <= 64 ? body.effort : parent.effort || 'medium',
        createdAt: new Date().toISOString(), minimized: false,
        position: { x: 100, y: 100, width: 440, height: 460 }, draft: '', status: 'idle' as const, messages: [],
      };
      repository.insert(userId, chat);
      return publicChat(chat);
    },
    update(userId: number, id: string, patch: Record<string, unknown>) {
      const chat = get(userId, id);
      if (typeof patch.minimized === 'boolean') chat.minimized = patch.minimized;
      if (typeof patch.draft === 'string' && patch.draft.length <= 100_000) chat.draft = patch.draft;
      if (patch.position && typeof patch.position === 'object') {
        const position = patch.position as SideChat['position'];
        if (['x', 'y', 'width', 'height'].some(k => !Number.isFinite(position[k as keyof typeof position]))) fail('INVALID_SIDE_CHAT_POSITION');
        chat.position = { x: Math.max(0, position.x), y: Math.max(0, position.y), width: Math.max(260, Math.min(2000, position.width)), height: Math.max(220, Math.min(2000, position.height)) };
      }
      repository.update(userId, chat);
      return publicChat(chat);
    },
    remove(userId: number, id: string) {
      get(userId, id);
      const runKey = key(userId, id);
      active.get(runKey)?.abort();
      active.delete(runKey);
      repository.delete(userId, id);
    },
    stop(userId: number, id: string) {
      const chat = get(userId, id);
      active.get(key(userId, id))?.abort();
      active.delete(key(userId, id));
      chat.status = 'idle';
      repository.update(userId, chat);
      return publicChat(chat);
    },
    send(userId: number, id: string, content: unknown) {
      const chat = get(userId, id);
      if (!resolveParent(chat.parentSessionId)) fail('SIDE_CHAT_PARENT_NOT_FOUND', 404);
      const runKey = key(userId, id);
      if (active.has(runKey)) fail('SIDE_CHAT_BUSY', 409);
      const question = text(content, 100_000);
      const controller = new AbortController();
      active.set(runKey, controller);
      const answerId = randomUUID();
      chat.messages.push({ id: randomUUID(), role: 'user', content: question }, { id: answerId, role: 'assistant', content: '' });
      chat.draft = ''; chat.status = 'running'; delete chat.error;
      repository.update(userId, chat);
      const prompt = JSON.stringify({
        main_conversation_snapshot: chat.context,
        selected_excerpt: chat.source,
        side_conversation: chat.messages.filter(m => m.id !== answerId),
      });
      // The route returns immediately. A closed tab neither cancels nor loses a running answer.
      void (async () => {
        let answer = ''; let lastWrite = 0;
        const commit = (status: SideChat['status'], error?: string) => {
          const latest = repository.get(userId, id);
          if (!latest || active.get(runKey) !== controller) return;
          latest.messages = latest.messages.map(m => m.id === answerId ? { ...m, content: answer } : m);
          latest.status = status; latest.error = error;
          repository.update(userId, latest);
        };
        try {
          for await (const chunk of generate({ prompt, cwd: chat.cwd, model: chat.model, effort: chat.effort, controller })) {
            if (controller.signal.aborted || active.get(runKey) !== controller) break;
            answer += chunk;
            if (Date.now() - lastWrite >= 200) { commit('running'); lastWrite = Date.now(); }
          }
          commit('idle');
        } catch (error) {
          commit(controller.signal.aborted ? 'idle' : 'error', controller.signal.aborted ? undefined : String(error instanceof Error ? error.message : error));
        } finally { if (active.get(runKey) === controller) active.delete(runKey); }
      })();
      return publicChat(chat);
    },
  };
  return service;
}
