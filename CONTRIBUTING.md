# Contributing to ClaudeWeb

Thank you for helping. Issues and pull requests are welcome in English or
Chinese.

## Before you start

For anything larger than a small fix, open an issue first so we can agree on
the approach. [`doc/PROJECT_CHECKLIST.md`](doc/PROJECT_CHECKLIST.md) lists
what is planned for 2.0.0 and the decisions already made.

## Making a change

The application is in [`app/`](app) and needs Node.js 22 or later.

```bash
cd app
npm ci
npm run typecheck
npm run lint
npm test
```

- Backend code under `app/server/` follows
  `app/.agents/skills/backend-module-standards/SKILL.md`; frontend code under
  `app/src/` follows `app/.agents/skills/frontend-module-standards/SKILL.md`.
- Add or update tests for what you change.
- Describe user-visible changes in [CHANGELOG.md](CHANGELOG.md) under
  "Unreleased".
- Keep the attribution to CloudCLI UI in the About page, the READMEs and
  [NOTICE](NOTICE); the license requires it.

## Developer Certificate of Origin

Every commit must be signed off under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/).
Signing off states that you wrote the change, or otherwise have the right to
submit it, under the project's license. Add the line with `git commit -s`:

```
Signed-off-by: Your Name <you@example.com>
```

Pull requests with commits that are not signed off cannot be merged.

## License

By contributing you agree that your contribution is licensed under the GNU
Affero General Public License v3.0 or later, including the additional terms
in [LICENSE](LICENSE).
