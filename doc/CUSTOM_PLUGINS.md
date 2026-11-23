# Custom plugins (Plugin Host v2)

ClaudeWeb plugins extend the workspace with tabs, full-screen backgrounds (such as wallpapers), floating overlays (such as desktop pets or widgets), custom settings panels, and optional local Node.js backends.

## Developer Kit & Reference Plugin

Third-party repositories do not need to depend on ClaudeWeb's internal source tree:

- **Standalone TypeScript declarations**: [doc/plugin-sdk/claudeweb-plugin.d.ts](plugin-sdk/claudeweb-plugin.d.ts) — copy into your plugin repo (e.g. `types/claudeweb-plugin.d.ts`) for full `PluginHostApi` / `ClaudeWebPluginModule` typing.
- **Manifest JSON Schema**: [doc/plugin-sdk/manifest.schema.json](plugin-sdk/manifest.schema.json) — add `"$schema": "https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/doc/plugin-sdk/manifest.schema.json"` to `manifest.json` for editor validation and autocomplete.
- **Complete runnable reference repository**: [isAlexYoung/claudeweb-wallpaper](https://github.com/isAlexYoung/claudeweb-wallpaper) — demonstrates `background` + `settings` slots, zero-dependency prebuilt SHA-256 bundles, Scoped Media Tickets with `Range`/`206` video streaming, `/plugin-ws/:name` live sync, optimistic locking, and login-screen snapshots.

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
| `settings` | Host drawer or modal (`PluginSettingsPanel`) | Opened on demand from **Settings → Plugins → Open Panel** via `mountSettings(container, host)`. Drawer mode hides the Settings backdrop so visual edits (like wallpapers) preview live over the workspace. |

## Manifest v2 (`manifest.json`)

```json
{
  "$schema": "https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/doc/plugin-sdk/manifest.schema.json",
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

- `minPluginApi` decouples SDK compatibility from ClaudeWeb product versions (current host exposes `apiVersion: 2`). Always probe `host.capabilities.has(...)` before calling optional APIs.
- Unknown manifest fields are preserved/tolerated so newer plugins degrade gracefully.
- `build.mode` accepts **`"auto"`** or **`"prebuilt"`**:
  - `"prebuilt"`: skips `npm install` and `npm run build` at install/update time when `entry` (and `server`, if declared) already exist and pass `build.integrity` SHA-256 verification. Add `dist/** -text` to `.gitattributes` so line endings never alter digests across OSes.
  - `"auto"` (default when omitted): if `package.json` exists, runs `npm ci --ignore-scripts` (when `package-lock.json` is present) or `npm install --ignore-scripts`, then `npm run build` if defined.
- All `entry` / `icon` / `server` paths must be relative POSIX paths without `..` or symlinks escaping the plugin directory.

## Frontend Lifecycle Contract

The host fetches `entry` with authentication headers and imports it via a temporary Blob URL (bundle all browser dependencies into `entry`). One live ES module instance is shared per `(pluginName, version, entry, revision)` across all mounted slots.

**Unified activation guarantee**:
- `activate(host)` is called **exactly once** per live plugin instance before its first slot mounts — regardless of whether the plugin mounts `background` + `overlay` simultaneously, or only `settings` / `tab`.
- Each slot then mounts independently (`mountLayer`, `mountSettings`, `mount`) with its own slot `AbortSignal`.
- Refreshing the plugin list does **not** unmount or remount active tabs, settings panels, or layers unless the plugin's version, entry, enabled state, compatibility, or revision actually changes.
- `deactivate()` is called **exactly once** when the last mounted slot unmounts or when the plugin is disabled, updated, uninstalled, or the user logs out.

```ts
import type { ClaudeWebPluginModule, PluginHostApi } from './types/claudeweb-plugin';

export const activate: ClaudeWebPluginModule['activate'] = async (host: PluginHostApi) => {
  // Runs once per plugin instance: load initial config, open shared WS, etc.
};

export const mountLayer: ClaudeWebPluginModule['mountLayer'] = async (slot, container, host) => {};
export const unmountLayer: ClaudeWebPluginModule['unmountLayer'] = (slot, container) => {};
export const mountSettings: ClaudeWebPluginModule['mountSettings'] = async (container, host) => {};
export const unmountSettings: ClaudeWebPluginModule['unmountSettings'] = (container) => {};
export const mount: ClaudeWebPluginModule['mount'] = async (container, host) => {};
export const unmount: ClaudeWebPluginModule['unmount'] = (container) => {};
export const deactivate: ClaudeWebPluginModule['deactivate'] = () => {};
```

Always observe `host.signal` (`AbortSignal`) in async work so a disable, update, or logout mid-activation cancels cleanly without writing stale DOM.

## `PluginHostApi` v2 Reference

| Member | Contract |
| --- | --- |
| `pluginName`, `hostVersion`, `apiVersion`, `capabilities`, `signal` | Identity, capability set (`ReadonlySet<string>`), and lifecycle `AbortSignal`. |
| `context`, `onContextChange(cb)` | Live `{ theme, themeMode ('warm' \| 'light' \| 'dark'), locale, route, project, session, reducedMotion, isMobile }`. Updated across **all** slots (including `background` and `overlay`) whenever project, session, route, theme, or locale changes. |
| `events.on(type, cb)`, `events.getSnapshot()` | Normalized real-time events: `agent:state` (with `sessionId`, `turnId`, `runId`, `seq`, `isFocusedSession`, `state`: `idle \| thinking \| streaming \| tool_use \| waiting_approval \| completed \| cancelled \| error`), `chat:user-sent`, `chat:turn-finished`, `sudo:requested`, `connection:status`. Use `getSnapshot()` on startup and reconnect. |
| `rpc(method, path, body?)` | Authenticated JSON RPC proxied to the plugin backend. |
| `rpcRaw(method, path, init?)` | Authenticated streaming binary/multipart RPC (up to 100 MiB) preserving `Range`, `If-Range`, and `Content-Type`. |
| `media.createUrl(path, ttlMs?)` | Mints a short-lived Scoped Media Ticket URL (`/api/plugins/:name/media/:ticketId`) usable directly in `<img src>` and `<video src>` with full HTTP `Range` / `206` seeking and automatic revocation on logout or plugin disable. |
| `assets.fetch(relativePath)` | Authenticated fetch for static assets inside the plugin folder. |
| `ws.connect()` | Authenticated WebSocket connection to `/plugin-ws/:name`. |
| `style.set(id, css)` / `remove(id)` / `clearAll()` | Host-managed `<style data-cw-plugin="...">` tags, auto-purged on disable/uninstall. |
| `surface.setWallpaperVars(vars)` / `clear()` | Available **only** to the active `background` plugin. Sets `html[data-cw-wallpaper="chat" \| "workspace"]`, `html[data-cw-wallpaper-tone="dark" \| "light"]`, `--cw-surface-opacity`, and `--cw-glass-blur`. |
| `storage.get/set/remove` | Namespaced `localStorage` (`cw-plugin:<name>:`). |
| `publicAppearance.uploadMedia/publish/clear` | Available when `publicAppearance: true`. Publishes a host-verified, non-sensitive login-screen snapshot (`single` or `per-theme` for `warm`/`light`/`dark`) served via `GET /api/public/appearance` (`no-store`) and `GET /api/public/appearance/media/:hash`. |
| `ui.closePanel()`, `ui.notify(msg, tone?)`, `ui.setPanelDirty?(dirty)` | Panel dismissal, toast notification, and unsaved-draft close guard. |

## Scoped Media Ticket Renewal & Backend `Range` Streaming

Media tickets expire after 10 minutes by default (configurable between 30s and 15m) and are immediately invalidated on logout or plugin disable (`HTTP 401`). For long-lived `<video>` elements, renew tickets before expiry and retry once on playback error:

```js
async function attachTicketedVideo(video, host, mediaPath) {
  let ticket = await host.media.createUrl(mediaPath, 10 * 60_000);
  video.src = ticket.url;

  let retried = false;
  video.addEventListener('error', async () => {
    if (retried || host.signal.aborted) return;
    retried = true;
    const savedTime = video.currentTime || 0;
    ticket = await host.media.createUrl(mediaPath, 10 * 60_000);
    if (!host.signal.aborted && video.isConnected) {
      video.src = ticket.url;
      video.currentTime = savedTime;
      void video.play().catch(() => {});
    }
  });
}
```

On the plugin backend (`server`), respond to `GET` / `HEAD` with a whitelisted MIME (`image/png`, `image/jpeg`, `image/webp`, `image/avif`, `image/gif`, `video/mp4`, `video/webm`; SVG/HTML are rejected by the host with `415 UNSAFE_MEDIA_TYPE`) and implement HTTP `Range` + `ETag`:

```js
function serveRangeFile(req, res, filePath, mimeType, etag) {
  const { size } = fs.statSync(filePath);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('ETag', etag);

  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304).end();
    return;
  }

  const range = req.headers.range;
  if (typeof range === 'string' && range.startsWith('bytes=')) {
    const [startRaw, endRaw] = range.slice(6).split('-');
    const start = startRaw ? Number.parseInt(startRaw, 10) : Math.max(0, size - Number.parseInt(endRaw, 10));
    const end = endRaw ? Math.min(size - 1, Number.parseInt(endRaw, 10)) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start >= size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, { 'Content-Length': String(size) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}
```

## Plugin WebSocket (`/plugin-ws/:name`) Protocol

Calling `host.ws.connect()` opens an authenticated WebSocket to `/plugin-ws/<pluginName>?token=<jwt>`. The ClaudeWeb host verifies the user's JWT session before proxying the raw WebSocket upgrade straight to your plugin backend's HTTP `upgrade` handler on `127.0.0.1:<port>` (so your backend does not need to verify JWTs itself):

```js
// Plugin backend: handle `upgrade` (e.g. using RFC 6455 or `ws` package)
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  // Register socket, reply to ping (opcode 0x9) with pong (0xA), and close on 0x8.
});
```

Frontend plugins should reconnect with exponential backoff when `ws.onclose` fires and stop reconnecting once `host.signal.aborted` becomes `true`. See [claudeweb-wallpaper/src/server/ws.cjs](https://github.com/isAlexYoung/claudeweb-wallpaper/blob/main/src/server/ws.cjs) for a complete zero-dependency implementation.

## Local Backend Service (`server`)

Add `"server": "dist/server.cjs"` to `manifest.json`. The backend must listen on `127.0.0.1:0` and print `{"ready":true,"port":<port>}` on stdout within 10 seconds:

```js
const http = require('node:http');
const fs = require('node:fs');

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
- If a plugin backend crashes 3 times within 5 minutes, the host opens a circuit breaker (`503 PLUGIN_CIRCUIT_OPEN`) and surfaces a **Restart** button in **Settings → Plugins**.

## Host Error Codes

| HTTP | Error `code` | Meaning & Handling |
| --- | --- | --- |
| `400` | `INVALID_MEDIA_PATH` | Media ticket path contained traversal (`..`), backslash, or scheme. |
| `401` | `MEDIA_TICKET_INVALID` | Ticket expired, belongs to another plugin, or login session ended. Re-mint with `host.media.createUrl()` if still signed in. |
| `409` | `BACKGROUND_SLOT_OCCUPIED` | Another background plugin is active (`error.details.activePlugin`). Retry with `{ takeoverBackground: true }` after user confirmation. |
| `413` | `RPC_BODY_TOO_LARGE` / `PUBLIC_MEDIA_TOO_LARGE` | Binary upload exceeded host limit (100 MiB for `rpcRaw`, 50 MiB for public login media). |
| `415` | `UNSAFE_MEDIA_TYPE` / `UNSUPPORTED_PUBLIC_MEDIA` | Media MIME or binary magic bytes are not in the safe whitelist (SVG/HTML/scripts are rejected). |
| `422` | `PLUGIN_INCOMPATIBLE` | Plugin requires a newer `minPluginApi` or unsupported capability in `requiredCapabilities`. |
| `422` | `PLUGIN_ARTIFACT_MISSING` / `PLUGIN_INTEGRITY_MISMATCH` | Declared `entry`/`server` missing or SHA-256 mismatch against `build.integrity`. |
| `503` | `PLUGIN_SERVER_UNAVAILABLE` / `PLUGIN_CIRCUIT_OPEN` | Plugin backend is disabled, failed startup, or tripped the 3-in-5-minute crash circuit breaker. |

## Minimal Overlay Example (Desktop Pet Skeleton)

```js
let rootEl = null;
let unsubEvents = null;
let unsubCtx = null;

export function activate(_host) {
  // Runs once for this plugin instance across all slots.
}

export function mountLayer(slot, container, host) {
  if (slot !== 'overlay') return;
  rootEl = document.createElement('div');
  rootEl.style.cssText = 'position:fixed;right:24px;bottom:24px;pointer-events:auto;padding:8px 12px;border-radius:12px;background:hsl(var(--popover));border:1px solid hsl(var(--border));font-size:12px;';
  const render = (state, projectName) => {
    rootEl.textContent = `Pet (${projectName || 'Home'}): ${state}`;
  };
  let lastState = host.events.getSnapshot().activeRuns.find((r) => r.isFocusedSession)?.state ?? 'idle';
  render(lastState, host.context.project?.name);
  unsubEvents = host.events.on('agent:state', (ev) => {
    if (!ev.isFocusedSession) return;
    lastState = ev.state;
    render(lastState, host.context.project?.name);
  });
  unsubCtx = host.onContextChange((ctx) => render(lastState, ctx.project?.name));
  container.replaceChildren(rootEl);
}

export function unmountLayer(_slot, container) {
  unsubEvents?.();
  unsubCtx?.();
  unsubEvents = null;
  unsubCtx = null;
  container.replaceChildren();
}
```

[Back to the user guide](USER_GUIDE.md) · [ClaudeWeb](../README.md)
