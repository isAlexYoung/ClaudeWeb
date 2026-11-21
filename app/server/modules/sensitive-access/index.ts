// The list of the user's sensitive information and the check the Claude
// runtime's PreToolUse hook runs on every tool call.
export { findSensitiveAccess, sensitiveEntries } from './sensitive-access.service.js';
export type { SensitiveKind } from './sensitive-access.service.js';
