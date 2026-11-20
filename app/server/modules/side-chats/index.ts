import { projectsDb, sessionsDb, sideChatsDb } from '@/modules/database/index.js';
import { streamClaudeSideQuestion } from '@/modules/providers/index.js';
import { createSideChatsService } from '@/modules/side-chats/side-chats.service.js';
import { createSideChatsRouter } from '@/modules/side-chats/side-chats.routes.js';

/** Used by the authenticated server entrypoint for isolated side-conversation management. */
const sideChatsService = createSideChatsService({
  repository: sideChatsDb, generate: streamClaudeSideQuestion,
  resolveParent(id) {
    const session = sessionsDb.getSessionById(id);
    if (!session?.project_path) return null;
    const project = projectsDb.getProjectPath(session.project_path);
    return { projectId: project?.project_id || '', cwd: session.project_path, provider: session.provider, model: session.model, effort: session.effort };
  },
});

/** Used by the server entrypoint to stop independent SDK requests during shutdown. */
export const closeSideChats = () => sideChatsService.close();

/** Used by the server entrypoint as the authenticated side-chat API. */
export const sideChatsRoutes = createSideChatsRouter(sideChatsService);
