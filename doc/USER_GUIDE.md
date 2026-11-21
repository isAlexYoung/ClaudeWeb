# ClaudeWeb user guide

[中文](USER_GUIDE.zh-CN.md)

ClaudeWeb runs on your own Linux server and gives you Claude Code in a browser.
This guide covers installing it, reaching it, connecting CMCP, moving from
WebDesktop, and common problems. Every `claudeweb` command runs as root;
`claudeweb help` lists them all.

## 1. Install

You need a Debian 12 (amd64) server you can reinstall, with at least 2 CPU
cores and 2 GB of memory.

As root (only test releases exist so far, so name the version):

```bash
curl -fsSL https://raw.githubusercontent.com/isAlexYoung/ClaudeWeb/main/install.sh | bash -s -- --version=2.0.1
```

Signed in as a user with sudo, write `sudo bash` instead of `bash`. The installer:

- installs the dependencies, ClaudeWeb, the official Claude Code CLI and the
  built-in browser, and sizes swap from the machine's memory;
- generates the **login password** and the **sudo password** and shows them
  once at the end (later: `claudeweb password`, `claudeweb sudo-password`);
- finally offers to set up a domain (press Enter to skip; see section 3).

Running the same command again repairs an installation of that version; it
never changes the login password or any data.

Then sign in to Claude: run `claude` in ClaudeWeb's terminal, open the link it
prints in ClaudeWeb's built-in browser and finish the sign-in. Chats and the
terminal both use it from then on.

## 2. Reach it through an SSH tunnel (no domain needed)

ClaudeWeb only listens on `127.0.0.1:3001` on the server, so nothing on the
internet can reach it. On your computer run:

```bash
ssh -L 3001:127.0.0.1:3001 root@your-server
```

Keep that window open, visit `http://localhost:3001` and sign in with the
login password.

## 3. Reach it through a domain (phones and tablets too)

You need a domain managed in Cloudflare, and:

- its **Account ID** and **Zone ID** (bottom right of the domain's Overview
  page in Cloudflare);
- an **API token** (My Profile > API Tokens) with *Account > Cloudflare Tunnel
  > Edit* and *Zone > DNS > Edit* for that domain.

Then run:

```bash
claudeweb domain
```

Type the domain twice, take a random name under it or give one exactly one
level under it (such as `claude.example.com`), then the Account ID, the Zone
ID and the API token (input hidden). It ends with an `https://…` address that
opens ClaudeWeb on any device, behind the same login password.

- It uses a Cloudflare Tunnel: the server connects out to Cloudflare and **no
  port is opened**. The server must be able to connect out on port 7844.
- The API token is used during the setup only and never stored.
- An interrupted setup continues when you run `claudeweb domain` again, or is
  cleaned up if you choose to start over.
- `claudeweb domain --status` shows it; `claudeweb domain --remove` deletes
  the tunnel and its DNS record.
- A new name can take a few minutes to answer.

## 4. Connect CMCP

CMCP 4.24.1 or later connects to ClaudeWeb and lets Claude use the files and
tools on your computer.

1. Add the server in CMCP with its SSH login and choose ClaudeWeb sign-in.
2. As the ClaudeWeb address, use the domain if you set one up, or the local
   address through the SSH tunnel.
3. Enter the ClaudeWeb login password and turn on automatic sign-in. CMCP
   signs in with a one-time code, so the password never appears in an address.
4. Click Connect: once connected, the browser opens signed in. Local tools go
   through the device's SSH background channel.

"Set up / repair ClaudeWeb connection" recognises standalone ClaudeWeb and
installs no second Claude CLI.

## 5. Move from WebDesktop

WebDesktop and the ClaudeWeb inside it are left untouched. Data moves through
a backup file:

1. In the old ClaudeWeb, export a backup in Settings > Backup & restore
   (optionally with a password).
2. On the new server, import that file on the same page. Paths under the old
   home folder `/home/wdguest` move to `/home/claudeweb`, so the
   conversations continue there. Existing conversations and files are never
   replaced.
3. Project files: between standalone servers, tick "Include project folders"
   when exporting. WebDesktop's ClaudeWeb has no such option, so copy the
   project folders on the **new** server as root, for example:

   ```bash
   rsync -a root@old-server:/home/wdguest/Code/my-project/ /home/claudeweb/Code/my-project/
   chown -R claudeweb:claudeweb /home/claudeweb/Code
   ```

   Both servers need rsync (`apt-get install -y rsync`). Keep the same path under the home folder (`/home/wdguest/X` →
   `/home/claudeweb/X`) so the conversations find their project.

Not moved: Claude's sign-in (run `claude` again on the new server), plugins,
and sign-ins inside the browser.

## 6. Update and roll back

- `claudeweb update --check` says whether a newer release exists;
  `claudeweb update` installs the latest stable release. For a test release
  use `claudeweb update --version=X.Y.Z`. Stable releases can also be
  installed from Settings > About.
- The database is backed up first; a new version that does not start is
  replaced by the previous one automatically.
- `claudeweb rollback` returns to the previous version at any time and keeps
  all data as it is.

## 7. Limits of permissions and resources

- **No sandbox per conversation**: every conversation, the terminal and the
  built-in browser run as the same user `claudeweb` and reach the same
  projects and files. Claude in one conversation can read and change another
  conversation's project. The browser keeps Chromium's own sandbox.
- **The sensitive-information prompt and the sudo confirmation** only catch
  the accesses they recognise; they cannot stop every program running as the
  same user from reading those files, and commands you type in the terminal
  yourself are not asked about.
- **Resources**: ClaudeWeb sets no memory, CPU or process quotas and can use
  the whole server, but the VPS plan, the operating system, the filesystem and
  the runtimes still have their own limits. When the disk or memory runs out,
  work fails or is ended.

## 8. Common problems

**Forgot the login password**: `claudeweb password` shows it;
`claudeweb password --set` sets a new one (every device signs out).

**"Locked" when signing in**: 5 wrong passwords from one address lock it for
1 minute, the next 5 for 5 minutes, then 30 minutes. Wait, then use the right
password.

**An update failed**: check `claudeweb status` and `claudeweb logs`. If it
says an earlier update did not finish, run `claudeweb rollback`. For a bug
report, attach the output of `claudeweb doctor` (it has no passwords or keys).

**CMCP cannot connect**: check that `claudeweb status` shows the service
running, SSH works, CMCP is 4.24.1 or later, the password saved in CMCP is
the one `claudeweb password` shows, and the address is not locked.

**Out of memory**: `claudeweb swap` shows swap; `claudeweb swap --size=4G`
enlarges it. When memory runs out, Claude's, the terminal's and the browser's
processes are ended first and the web page stays up. More memory from your
provider needs no reinstall.

**Claude wants to use sudo**: a card asks first; the command runs only after
you type the sudo password (`claudeweb sudo-password` shows it), every time.

**The domain does not open**: `claudeweb domain --status` shows the tunnel;
`journalctl -u claudeweb-tunnel` has its log; the server must reach port 7844
outbound; a new name can take a few minutes.

**Uninstall**: `claudeweb uninstall` keeps `/home/claudeweb/projects`;
`--delete-projects` removes the projects too. With a domain, run
`claudeweb domain --remove` first to delete the tunnel and DNS record in
Cloudflare as well.
