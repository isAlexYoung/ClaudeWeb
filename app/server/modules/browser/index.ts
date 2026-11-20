// browserRoutes: used by the server entrypoint to mount the browser panel's API at /api/browser.
// browserService: its relay() is used by the websocket gateway for the panel's /browser-ws picture.
export { browserRoutes, browserService } from './browser.module.js';
