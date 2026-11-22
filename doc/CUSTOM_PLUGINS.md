# Custom plugins

ClaudeWeb plugins add a project-workspace tab and, optionally, a small local
backend service. This guide describes ClaudeWeb's current host implementation
with a complete minimal example.

## Install and manage

Open **Settings → Plugins**, enter a plugin's Git repository URL, and choose
**Install**. Only install code you trust: plugin UI code runs in the application
page, and a plugin backend runs as the `claudeweb` operating-system user.
Manifest permissions are metadata, not an operating-system sandbox.

Your installed plugins appear below the form. Use their switches to enable or
disable them, the refresh action to pull an update from Git, and the trash
action to remove one after confirmation. The built-in usage integration is
managed by ClaudeWeb and is not listed here.

Alternatively, put a complete plugin folder under
`~/.claude-code-ui/plugins/`, owned by the service user, and reload the page.
For the standard installation, `~` means `/home/claudeweb`. This directory name
is retained for compatibility with existing plugin installations.

## A minimal plugin

Create a repository containing these two files at its root:

```text
workspace-note/
├── manifest.json
└── index.js
```

`manifest.json`:

```json
{
  "name": "workspace-note",
  "displayName": "Workspace Note",
  "version": "1.0.0",
  "description": "Shows the active project and session.",
  "type": "module",
  "slot": "tab",
  "entry": "index.js"
}
```

`index.js` is a browser ES module exporting `mount` and, for cleanup, `unmount`:

```js
const mounted = new WeakMap();

export function mount(container, host) {
  const panel = document.createElement('section');
  panel.style.padding = '1rem';

  const render = (context) => {
    panel.textContent = context.project
      ? `Project: ${context.project.name}; session: ${context.session?.title ?? 'none'}`
      : 'Select a project to begin.';
    panel.dataset.theme = context.theme;
  };

  container.replaceChildren(panel);
  render(host.context);
  mounted.set(container, host.onContextChange(render));
}

export function unmount(container) {
  mounted.get(container)?.();
  mounted.delete(container);
  container.replaceChildren();
}
```

The host imports the entry through an authenticated fetch and a temporary Blob
URL. Bundle browser dependencies into that entry; relative imports or relative
asset URLs do not resolve to the repository directory from a Blob URL. Plain
JavaScript needs no build step. JSX and TypeScript must be compiled first.

## Manifest fields

| Field | Meaning |
| --- | --- |
| `name` | Required unique identifier using letters, numbers, `_` or `-`. |
| `displayName` | Required label shown in the interface. |
| `entry` | Required relative path to the built browser module. |
| `version`, `description`, `author` | Optional metadata. |
| `icon` | Optional relative path to an SVG icon inside the plugin, such as `icon.svg`. The host sanitizes its SVG markup before displaying it. |
| `type` | `module` is recommended. The validator also accepts `react`; the current tab host still expects the exported mount contract above. |
| `slot` | `tab`, currently the only supported placement. |
| `server` | Optional relative path to a Node.js backend entry. |
| `permissions` | Optional array of strings documenting intended access. These declarations do not enforce isolation. |

Entry and server paths cannot be absolute or contain `..`. A Git installation
must include `manifest.json` at the repository root and cannot reuse the name
of another installed plugin.

## Host API

The second argument to `mount(container, host)` provides:

| Member | Contract |
| --- | --- |
| `context` | Current `{ theme, project, session }`. Theme is `light` or `dark`; project is `{ name, path }` or `null`; session is `{ id, title }` or `null`. |
| `onContextChange(callback)` | Subscribes to theme/project/session changes and returns an unsubscribe function. |
| `rpc(method, path, body?)` | Sends an authenticated request to this plugin's local backend and returns parsed JSON; rejects unsuccessful responses. |

Remove event listeners, timers, subscriptions and owned UI resources in
`unmount`. The host can unmount a tab when the plugin is disabled or the active
workspace changes. Never inject session/project text through `innerHTML`.

## Optional local backend

Add `"server": "server.cjs"` to the manifest. A dependency-free example:

```js
const http = require('node:http');

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/status') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ message: 'Workspace Note is ready' }));
});

server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ ready: true, port: server.address().port }));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
```

The server must print a complete JSON readiness line within **10 seconds**.
Use a loopback listener and an OS-assigned port rather than a public listener.
The UI can then call `await host.rpc('GET', '/status')`. Requests go through
ClaudeWeb's authenticated plugin proxy; do not publish the backend port.

The backend receives a small environment containing `PATH`, `HOME`, `NODE_ENV`
and `PLUGIN_NAME` (plus essential Windows variables on that platform). It does
not inherit every ClaudeWeb environment variable. This limits accidental secret
exposure, but the process still has the service user's filesystem permissions.

## Builds, updates and troubleshooting

If a Git repository has a `package.json`, installation runs
`npm install --ignore-scripts`. If it declares a `build` script, that script is
then run, with a **60-second** build timeout. The build itself is executable
code; ignoring dependency lifecycle scripts does not make an untrusted plugin
safe. Native dependencies needing post-install compilation may require manual
setup. Prefer a prebuilt, self-contained browser module when possible.

For a folder copied manually, prepare dependencies and compiled output yourself.
Keep `manifest.json` entry paths consistent with the actual build output.
Updates pull the repository and rebuild when configured. Review upstream
changes before updating a plugin you rely on.

If installation fails, check the URL, repository access, manifest and build
output. A private repository requires Git credentials available to the
`claudeweb` user; an administrator's root-only credentials do not carry over.
Use **Settings → Plugins** for displayed errors and `claudeweb logs` for server
diagnostics. Do not put credentials in a shared repository URL or browser code.

[Back to the user guide](USER_GUIDE.md) · [ClaudeWeb](../README.md)
