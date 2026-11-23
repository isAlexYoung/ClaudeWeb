# Custom plugins (Plugin Host v2)

ClaudeWeb plugins extend the workspace with tabs, full-screen backgrounds (such as wallpapers), floating overlays (such as desktop pets or widgets), custom settings panels, and optional local Node.js backends.

## Security & Trust Model

ClaudeWeb currently uses a **Trusted Plugin Model**, not an OS or browser sandbox:

- **Frontend code** runs directly inside the authenticated ClaudeWeb origin (the same DOM and JS context as the app).
- **Backend code** runs as a child Node.js process under the `claudeweb` service user with a reduced environment (`PATH`, `HOME`, `NODE_ENV`, `PLUGIN_NAME`, `PLUGIN_DATA_DIR`, `CLAUDEWEB_HOST_VERSION`, `CLAUDEWEB_PLUGIN_API_VERSION`).
- **Host-enforced protections**: plugin-directory path traversal checks, authenticated RPC/asset/WebSocket proxy, short-lived Scoped Media Tickets (bound to plugin + path + active login session, safe MIME whitelist with magic-byte sniffing, no SVG/HTML), single-active background slot arbitration, atomic staging updates, prebuilt artifact SHA-256 verification, and non-sensitive public login-screen snapshots.
- **Not enforced as a hard sandbox**: `permissions` in `manifest.json` are declarative metadata for reviewers/users; frontend CSS `z-index` layering is a convention rather than a DOM security boundary, and backend processes share the `claudeweb` user's filesystem permissions.

**Only install plugins whose source code you have reviewed or from authors you trust.**

## Install, Manage & Recovery

Open **Settings → Plugins**, enter a Git repository URL, and click **Install**. Installed plugins appear below with:

- **Open Panel** (for plugins declaring the `settings` slot) — opens a drawer or modal directly in the workspace.
- **Enable / Disable** switch — disabling a plugin immediately stops its backend, revokes its media tickets, clears its injected styles and login-screen snapshot, and unmounts its UI layers.
- **Pull latest from Git** — updates run in an isolated staging copy (`.tmp-update-*`) and swap atomically only after install, build, and integrity checks succeed; failures leave the existing installation intact.
- **Uninstall** — removes the plugin directory while keeping persistent user data in `~/.claude-code-ui/plugin-data/<name>/` by default unless *"Also delete saved plugin data"* is checked.

### Emergency Recovery

If a broken third-party plugin interferes with the interface:

1. **Browser Safe Mode**: append `?safe-plugins=1` (or `#safe-plugins`) to the ClaudeWeb URL. No third-party frontend plugin code executes while Safe Mode is active, so you can open **Settings → Plugins** and disable or remove the offending plugin.
2. **Boot Crash Guard**: if a plugin crashes during startup, the host remembers it for the session and skips it on reload while showing a **Restart** action in Settings.
3. **Server CLI**: run `sudo claudeweb plugins --disable-all` over SSH to disable every third-party plugin, clear the public login appearance snapshot, and restart `claudeweb.service`.

## Slots & Multi-Plugin Arbitration

A plugin declares one or more slots in `manifest.json` (`slots: [...]`; v1 `slot: "tab"` remains fully supported):

| Slot | Mount Container | Cardinality & Behavior |
| --- | --- | --- |
| `tab` | Workspace main tab (`More → <Plugin>`) | Multi-active; mounted on demand via `mount(container, host)`. |
| `background` | `#cw-plugin-background-layer` (`z-0`) | **Strictly single-active**. Enabling a second background plugin returns `409 BACKGROUND_SLOT_OCCUPIED` until the user confirms switching. Only the active background plugin receives `host.surface`. |
| `overlay` | `#cw-plugin-overlay-layer` (`z-[38]`) | Multi-active; deterministic order by `overlayOrder` (then name), below modals and sudo prompts. |
| `settings` | Host drawer or modal (`PluginSettingsPanel`) | Opened on demand from **Settings → Plugins → Open Panel** via `mountSettings(container, host)`. Drawer mode temporarily hides the Settings backdrop so visual edits (like wallpapers) preview live over the workspace. |

## Manifest v2 (`manifest.json`)

```json
{
  "manifestVersion": 2,
  "minPluginApi": 2,
  "requiredCapabilities": ["slots:background", "slots:settings", "media-ticket"],
  "name": "my-wallpaper",
  "displayName": "Wallpaper",
  "version": "1.0.0",
  "description": "Custom static and video wallpapers for ClaudeWeb.",
  "author": "your-name",
  "icon": "icon.svg",
  "type": "module",
  "slot": "background",
  "slots": ["background", "settings"],
  "panel": { "title": "Wallpaper Settings", "mode": "drawer", "width": 440 },
  "publicAppearance": true,
  "entry": "dist/index.js",
  "server": "dist/server.cjs",
  "build": {
    "mode": "prebuilt",
    "integrity": {
      "dist/index.js": "sha256-...",
      "dist/server.cjs": "sha256-..."
    }
  },
  "permissions": ["storage", "media", "public-appearance"]
}
```

Key rules:

- `minPluginApi` decouples SDK compatibility from ClaudeWeb marketing versions (current host exposes `apiVersion: 2`). Always probe `host.capabilities.has(...)` before calling optional APIs.
- Unknown manifest fields are preserved/tolerated so newer plugins degrade gracefully.
- `build.mode`:
  - `"prebuilt"`: skips `npm install` and `npm run build` at install/update time when `entry` (and `server`, if declared) already exist and pass `build.integrity` SHA-256 verification. Recommended for fast, reliable zero-runtime-dependency plugins!
  - `"source"` (default when omitted): runs `npm ci --ignore-scripts` (if `package-lock.json` exists) or `npm install --ignore-scripts`, then `npm run build` if defined.
- All entry/icon/server paths must be relative without `..` or symlinks escaping the plugin directory.

## Frontend Lifecycle Contract

The host fetches `entry` with authentication headers and imports it via a temporary Blob URL (bundle all browser dependencies into `entry`). One module instance is shared per `(pluginName, revision)` across slots, allowing live draft preview between `mountSettings` and `mountLayer`.

Export any combination of:

```ts
export async function activate(host: PluginHostApi): Promise<void> {}
export async function mountLayer(slot: 'background' | 'overlay', container: HTMLElement, host: PluginHostApi): Promise<void> {}
export function unmountLayer(slot: 'background' | 'overlay', container: HTMLElement): void {}
export async function mountSettings(container: HTMLElement, host: PluginHostApi): Promise<void> {}
export function unmountSettings(container: HTMLElement): void {}
export async function mount(container: HTMLElement, host: PluginHostApi): Promise<void> {} // slot: "tab" & v1 compat
export function unmount(container: HTMLElement): void {}
export function deactivate(): void {}
```

Always observe `host.signal` (`AbortSignal`) in async work so a disable, update, or logout mid-activation cancels cleanly without writing stale DOM.

## `PluginHostApi` v2 Reference

| Member | Contract |
| --- | --- |
| `pluginName`, `hostVersion`, `apiVersion`, `capabilities`, `signal` | Identity, capability set (`ReadonlySet<string>`), and lifecycle `AbortSignal`. |
| `context`, `onContextChange(cb)` | `{ theme, themeMode ('warm' \| 'light' \| 'dark'), locale, route, project, session, reducedMotion, isMobile }`. |
| `events.on(type, cb)`, `events.getSnapshot()` | Normalized real-time events: `agent:state` (with `sessionId`, `turnId`, `runId`, `seq`, `state`: `idle \| thinking \| streaming \| tool_use \| waiting_approval \| completed \| cancelled \| error`), `chat:user-sent`, `chat:turn-finished`, `sudo:requested`, `connection:status`. Use `getSnapshot()` on startup and reconnect. |
| `rpc(method, path, body?)` | Authenticated JSON RPC proxied to the plugin backend. |
| `rpcRaw(method, path, init?)` | Authenticated streaming binary/multipart RPC (up to 100 MiB) preserving `Range`, `If-Range`, and `Content-Type`. |
| `media.createUrl(path, ttlMs?)` | Mints a short-lived Scoped Media Ticket URL (`/api/plugins/:name/media/:ticketId`) usable directly in `<img src>` and `<video src>` with full HTTP `Range` / `206` seeking and automatic revocation on logout or plugin disable. |
| `assets.fetch(relativePath)` | Authenticated fetch for static assets inside the plugin folder. |
| `ws.connect()` | Authenticated WebSocket connection to `/plugin-ws/:name`. |
| `style.set(id, css)` / `remove(id)` / `clearAll()` | Host-managed `<style data-cw-plugin="...">` tags, auto-purged on disable/uninstall. |
| `surface.setWallpaperVars(vars)` / `clear()` | Available **only** to the active `background` plugin. Sets `html[data-cw-wallpaper="chat" \| "workspace"]`, `--cw-surface-opacity`, and `--cw-glass-blur`. |
| `storage.get/set/remove` | Namespaced `localStorage` (`cw-plugin:<name>:`). |
| `publicAppearance.uploadMedia/publish/clear` | Available when `publicAppearance: true`. Publishes a host-verified, non-sensitive login-screen snapshot (`single` or `per-theme` for `warm`/`light`/`dark`) served via `GET /api/public/appearance` (`no-store`) and `GET /api/public/appearance/media/:hash`. |
| `ui.closePanel()`, `ui.notify(msg, tone?)`, `ui.setPanelDirty?(dirty)` | Panel dismissal, toast notification, and unsaved-draft close guard. |

## Local Backend Service (`server`)

Add `"server": "dist/server.cjs"` to `manifest.json`. The backend must listen on `127.0.0.1:0` and print `{"ready":true,"port":<port>}` on stdout within 10 seconds:

```js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const dataDir = process.env.PLUGIN_DATA_DIR; // persistent across plugin updates!
fs.mkdirSync(dataDir, { recursive: true });

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, dataDir }));
    return;
  }
  res.writeHead(404).end();
});

server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ ready: true, port: server.address().port }));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
```

- Store user configs and uploaded media under `process.env.PLUGIN_DATA_DIR` (`~/.claude-code-ui/plugin-data/<name>/`) so plugin code updates never overwrite user data.
- If a plugin backend crashes 3 times within 5 minutes, the host opens a circuit breaker and surfaces a **Restart** button in **Settings → Plugins**.

## Minimal Overlay Example (Desktop Pet Skeleton)

```js
let rootEl = null;
let unsub = null;

export function mountLayer(slot, container, host) {
  if (slot !== 'overlay') return;
  rootEl = document.createElement('div');
  rootEl.style.cssText = 'position:fixed;right:24px;bottom:24px;pointer-events:auto;padding:8px 12px;border-radius:12px;background:hsl(var(--popover));border:1px solid hsl(var(--border));font-size:12px;';
  const render = (state) => { rootEl.textContent = `Pet: ${state}`; };
  render(host.events.getSnapshot().activeRuns[0]?.state ?? 'idle');
  unsub = host.events.on('agent:state', (ev) => render(ev.state));
  container.replaceChildren(rootEl);
}

export function unmountLayer(_slot, container) {
  unsub?.();
  unsub = null;
  container.replaceChildren();
}
```

[Back to the user guide](USER_GUIDE.md) · [ClaudeWeb](../README.md)
