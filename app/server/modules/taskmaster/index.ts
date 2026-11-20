// taskmasterRoutes: used by the server entrypoint to mount protected Taskmaster endpoints.
export { taskmasterRoutes } from './taskmaster.module.js';
// ensureTaskmasterOnPath: used by the server entrypoint so Claude sessions find the bundled TaskMaster.
export { ensureTaskmasterOnPath } from './taskmaster-cli.service.js';
