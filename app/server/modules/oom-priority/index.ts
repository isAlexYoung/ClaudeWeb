// Under memory pressure Linux ends ClaudeWeb's children before ClaudeWeb: the
// server entrypoint starts this on Linux.
export { startChildOomPriority } from './oom-priority.service.js';
