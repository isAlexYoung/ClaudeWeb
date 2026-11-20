# Repository guidance

## Backend code

For every task that creates, modifies, refactors, or reviews backend code under `server/`, load and follow `$backend-module-standards` from `.agents/skills/backend-module-standards/SKILL.md`. Apply it only to backend code; do not impose those architecture rules on the frontend.

## Frontend code

For every task that creates, modifies, refactors, or reviews frontend code under `src/`, load and follow `$frontend-module-standards` from `.agents/skills/frontend-module-standards/SKILL.md`. Apply it only to frontend code; do not impose those architecture rules on the backend.

## UI change records

For each changed feature or UI area, add a separate Markdown record under
`../changes/` named `YYYY-MM-DD-NN-description.md`. Describe the request, resulting
behavior, every changed file, validation results, and any remaining limitations.
Record design proposals separately from implemented UI. A preview does not
authorize implementation of its layout or secondary menus. Keep
`../cloudcli.patch` synchronized with changes to this integrated application.
