// WebDesktop stand-in for ai-sdk-provider-codex-cli. TaskMaster imports createCodexCli at startup, so it must exist;
// any attempt to use this provider fails with a clear message instead of a missing-module crash.
const message = 'The ai-sdk-provider-codex-cli provider is not installed in WebDesktop. TaskMaster here only runs on Claude Code (provider claude-code).';
const fail = () => { throw new Error(message); };
const unavailable = new Proxy(fail, { get: (_target, key) => (key === 'then' ? undefined : fail), apply: fail, construct: fail });

export function createCodexCli() {
  return unavailable;
}
