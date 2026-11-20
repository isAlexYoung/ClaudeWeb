// WebDesktop stand-in for @ai-sdk/perplexity. TaskMaster imports createPerplexity at startup, so it must exist;
// any attempt to use this provider fails with a clear message instead of a missing-module crash.
const message = 'The @ai-sdk/perplexity provider is not installed in WebDesktop. TaskMaster here only runs on Claude Code (provider claude-code).';
const fail = () => { throw new Error(message); };
const unavailable = new Proxy(fail, { get: (_target, key) => (key === 'then' ? undefined : fail), apply: fail, construct: fail });

export function createPerplexity() {
  return unavailable;
}
