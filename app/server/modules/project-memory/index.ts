import { projectsDb } from '@/modules/database/index.js';
import { createProjectMemoryService } from '@/modules/project-memory/project-memory.service.js';
import { createProjectMemoryRouter } from '@/modules/project-memory/project-memory.routes.js';

/** Used by the server entrypoint; project roots come from the registered project catalog. */
export const projectMemoryRoutes = createProjectMemoryRouter(createProjectMemoryService(id => projectsDb.getProjectPathById(id)));
