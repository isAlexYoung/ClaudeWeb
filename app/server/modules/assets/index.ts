// Express router mounted at /api/assets by server/index.ts for uploading and
// serving chat attachments stored in the global ~/.cloudcli/assets folder.
export { default as assetsRoutes } from './assets.routes.js';
// Run once at start-up: lists older uploads on their project's File management page.
export { indexOlderUploads } from './services/upload-index.service.js';
// Periodic cleanup belongs to the upload service; the server starts it once.
export { initializeUploadCleanup } from './services/chunked-upload.service.js';
