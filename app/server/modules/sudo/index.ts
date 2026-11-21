// sudo confirmation: the server entrypoint starts it and mounts its routes; the
// Claude provider puts the `sudo` shim on the PATH of the commands Claude runs.
export { sudoRoutes, startSudoConfirmation, sudoShimEnvironment } from './sudo.module.js';
