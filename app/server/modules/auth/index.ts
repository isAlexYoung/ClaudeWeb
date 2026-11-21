// authRoutes: used by the server entrypoint to mount public authentication endpoints.
export { authRoutes } from './auth.module.js';

// authenticateToken: used by the server entrypoint to protect authenticated API modules.
export { authenticateToken } from './auth.module.js';
// authenticateWebSocket: used by WebSocket setup to verify connection tokens.
export { authenticateWebSocket } from './auth.module.js';
// loginSessionAlive: used by the server entrypoint's WebSocket setup to close a signed-out device's connections.
// isMainLoginDevice: used by the ClaudeWeb update routes, which only the main device may use to update.
export { isMainLoginDevice, loginSessionAlive } from './auth.module.js';
// validateApiKey: used by the server entrypoint for optional API-wide key validation.
export { validateApiKey } from './auth.middleware.js';
