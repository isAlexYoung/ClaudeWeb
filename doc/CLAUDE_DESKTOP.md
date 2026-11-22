# ClaudeDesktop integration (2.0.3 test release)

ClaudeWeb 2.0.3 includes this integration. It remains a test release;
real account sign-in and long-running use require separate acceptance.

## Use

The asterisk immediately before Terminal opens ClaudeDesktop in a fixed window.
Hover text is “打开ClaudeDesktop” in Simplified Chinese. Its title bar offers:

- Fullscreen, with a restore control; Escape leaves native fullscreen.
- Minimize: hide the window while retaining the same app and picture connection.
- Close: end the private application/display processes and reclaim regenerable
  caches and runtime files. Login data, preferences and encrypted keyrings stay.

An orange dot appears on the ClaudeDesktop, terminal or browser icon while its
live window is hidden. Clicking the icon restores that session. Closing a tool
removes its dot. Closing ClaudeDesktop does not close the independent browser.

## Installation

Fresh installs install the official signed ClaudeDesktop APT package. The updater
also attempts to install it when absent. An installation failure does not prevent
the rest of ClaudeWeb from running; an administrator can retry with:

```sh
sudo claudeweb install-desktop
```

The installer verifies the official signing key before adding the APT repository,
creates missing APT configuration directories, and preserves an already installed
Desktop package. The 2.0.3 installer enables Debian 12 and Ubuntu 22.04
amd64. Ubuntu 22.04 VPS checks received real Desktop frames and exercised
minimize, fullscreen, close, cache cleanup and reopening. Real account sign-in
and long-running acceptance remain pending.

## Profile and cleanup

The app runs as the existing ordinary service user, on its own private X display
and D-Bus session. VNC is a private Unix socket, forwarded through ClaudeWeb's
authenticated WebSocket gateway; no public VNC port is opened. The Electron
sandbox remains enabled. No new resource quotas are applied.

Paths below are relative to the service user's home:

| Path | Retention |
| --- | --- |
| `.config/claudeweb-desktop/Claude` | Persistent Desktop profile |
| `.config/claudeweb-desktop/data/keyrings` | Persistent encrypted keyrings |
| `.config/claudeweb-desktop/.keyring-secret` | Private unlocking secret (0600), never logged |
| `.cache/claudeweb-desktop-runtime` | Removed after close |
| `.cache/claudeweb-desktop-cache` | Removed after close |
| `Claude/{Cache,Code Cache,GPUCache,DawnCache,GrShaderCache,ShaderCache}` under the profile | Removed after close |

Cleanup first terminates only the session's saved process groups, waits for them
to exit and then removes the listed files. It refuses unsafe profile ancestors
such as symbolic links. It does not wipe the profile, remove unrelated files,
or globally kill processes by their names. Persistent login data still consumes
disk space and inodes; closing does not reset all inode usage to zero.
Closing during startup also cancels the pending window lookup. Normal server
shutdown follows the same cleanup path for both graphical tools.

## Verification

Run frontend/backend tests and builds using the application package scripts.
For an actual graphical lifecycle check after installing the official package,
run the following as the ordinary service user against a built application:

```sh
node packaging/test-desktop.mjs /path/to/built/app
```

The check creates a temporary isolated profile, receives real Desktop and browser
frames, tests retention/reopen/close, checks cache reclamation and process exit,
and removes its test profile. It does not sign in or modify the user's profile.
