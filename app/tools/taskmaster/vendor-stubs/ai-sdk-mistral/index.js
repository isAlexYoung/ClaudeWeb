// ClaudeWeb stand-in for @ai-sdk/mistral. TaskMaster imports createMistral at startup, so it must exist;
// any attempt to use this provider fails with a clear message instead of a missing-module crash.
const message = 'The @ai-sdk/mistral provider is not installed in ClaudeWeb. TaskMaster here only runs on Claude Code (provider claude-code).';
const fail = () => { throw new Error(message); };
const unavailable = new Proxy(fail, { get: (_target, key) => (key === 'then' ? undefined : fail), apply: fail, construct: fail });

export function createMistral() {
  return unavailable;
}
