# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub:
**Security → Report a vulnerability** on
<https://github.com/isAlexYoung/ClaudeWeb>. Do not open a public issue for
them.

Include what you found, the ClaudeWeb version, and the steps to reproduce it.
Reports in English or Chinese are both fine. You should get a first answer
within 7 days.

## Supported versions

Only the latest stable release receives security fixes. Test releases are
for trying changes before they become stable and are not supported.

## Scope

In scope: the ClaudeWeb web application, its login and session handling, the
installer, the `claudeweb` management command and the updater in this
repository.

Out of scope:

- Someone who already has root on the server. Root can read the login
  password by design.
- Claude itself, the Claude CLI and Anthropic's services. Report those to
  Anthropic.
- Problems in upstream CloudCLI UI that do not affect ClaudeWeb. Report those
  to <https://github.com/siteboon/claudecodeui>.
