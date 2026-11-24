// ClaudeWeb Artefacts: spreadsheets (and later other kinds) kept as files in
// ~/Artefacts that Claude edits in a conversation of their own.
// The HTTP surface, mounted by the app at /api/artefacts.
export { default as artefactsRoutes } from './artefacts.routes.js';

// Gives artefact runs the provider runtime; started with the server.
export { initializeArtefacts } from './services/artefacts.service.js';
