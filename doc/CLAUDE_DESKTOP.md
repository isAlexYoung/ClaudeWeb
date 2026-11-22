# ClaudeDesktop

Open and manage ClaudeDesktop from the same ClaudeWeb page as your projects.
ClaudeDesktop uses its own sign-in; signing in to Claude CLI does not sign in
to the desktop application.

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

The installer verifies the official signing key before adding the APT
repository and creates missing APT configuration directories. It supports the
same Debian and Ubuntu amd64 systems listed in the project README.

On Ubuntu 24.04 and 26.04, ClaudeWeb manages the browser's AppArmor policy at
`/etc/apparmor.d/claudeweb-graphical`, while the official ClaudeDesktop package
manages its own profile. Installation and repair preserve the graphical
sandboxes and reload the needed policy.

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

[Back to ClaudeWeb](../README.md)
