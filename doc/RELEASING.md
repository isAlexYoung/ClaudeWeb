# Releasing ClaudeWeb

Servers trust exactly one thing: `releases.json`, signed with the ClaudeWeb
minisign key (key id `8D95EBD30103FEDD`). The list pins each package's size and
SHA-256, so packages themselves are not signed. The public key is built into
`install.sh` and `packaging/claudeweb`.

| What | Where |
| --- | --- |
| Signed list | branch `releases` of this repository: `releases.json`, `releases.json.minisig` (read through `raw.githubusercontent.com`, no GitHub API) |
| Packages | GitHub Release `vX.Y.Z`, asset `claudeweb-X.Y.Z-linux-x64.tar.xz` |
| Private key | kept by the maintainer, never in the repository |

Every release is `test` or `stable`. `install.sh` and `claudeweb update`
without `--version` only take stable releases; Settings > About only offers
stable releases newer than the installed one. A test release becomes stable
by changing its channel in the list and signing again; the package is not
rebuilt.

## Steps

Build on Ubuntu 22.04 amd64 with `build-essential`, `pkg-config`, `python3`,
`git`, `curl`, and `xz-utils`. Native modules are rebuilt against this glibc
2.35 baseline and the package declares `debian-12` and `ubuntu-22.04` as its
target platforms beginning with test release 2.0.3; run the target
acceptance tests before publishing. Keep the signing key on the maintainer's
machine, where minisign is installed.

1. Commit everything, then build from that commit:

   ```bash
   bash packaging/build-release.sh --version=X.Y.Z --channel=test
   ```

   Or start the **Release package** workflow (Actions, on the commit to
   release) and download its artifact: the same script in a clean Ubuntu 22.04.
   Check the package against its `.sha256` before uploading it. Signing
   (step 4) always happens on the maintainer's machine.

2. Before publishing, start the **CI** workflow by hand on the commit to
   release (pushes do not start it): it runs the app checks and the release
   checks on disposable machines, among them a fresh install
   (`packaging/test-install.sh`) and an update from the previous stable
   release (`packaging/test-update.sh`). `packaging/test-domain.sh` checks
   `claudeweb domain` on a test install against a local stand-in for the
   Cloudflare API.

   CI builds once on Ubuntu 22.04, then runs the installation, update, browser,
   device and sudo checks in both Debian 12 and Ubuntu 22.04 VMs. Shared platform
   rules live in `packaging/platform.sh`; after changing them, run
   `python3 packaging/sync-platform.py` to refresh both standalone entry points.
   CI rejects stale embedded copies. A VM check alone does not replace the
   dedicated VPS acceptance recorded in `doc/LINUX_COMPATIBILITY_PLAN.md`.

3. Create the GitHub Release `vX.Y.Z` (marked as a pre-release while the
   channel is `test`) and upload the package.

4. Add it to the list and sign, in a checkout of the `releases` branch:

   ```bash
   python3 packaging/release-list.py add --list . --channel test \
     --package claudeweb-X.Y.Z-linux-x64.tar.xz \
     --url https://github.com/isAlexYoung/ClaudeWeb/releases/download/vX.Y.Z/claudeweb-X.Y.Z-linux-x64.tar.xz \
     --notes "What changed"
   python3 packaging/release-list.py sign --list . --key /path/to/minisign.key
   ```

   Commit and push `releases.json` and `releases.json.minisig` together.
   Then start the **Check a published release** workflow with the version:
   select each supported target OS; it installs the release in that fresh VM
   with the README's one-line command, using only what is published. The old
   Debian-only 2.0.2 package cannot be used for Ubuntu acceptance.

5. To make it stable later:

   ```bash
   python3 packaging/release-list.py promote --list . --version X.Y.Z
   python3 packaging/release-list.py sign --list . --key /path/to/minisign.key
   ```

Versions are never replaced: a broken release is followed by a new version.

## Bundled components

Node.js and Playwright's Chromium ship inside each release package and are
updated with ClaudeWeb's own releases. A serious security hole in one of them
is fixed by a separate release, for the latest stable release only.

Updates change only the program under `/opt/claudeweb` (and its units); they
never change the `claudeweb` user, its home folder, the paths in the table of
`doc/PROJECT_CHECKLIST.md` or any resource limit.

## Database rule

A new version must not need a database change that the previous version
cannot run on: `claudeweb rollback` and an update that fails its health check
return to the previous version without restoring the database (a copy is kept
in `/var/lib/claudeweb-update/backups`). Schema changes therefore only add
tables or columns that the previous version can ignore.

The health check after an update only asks whether the new version answers;
it never compares the database, so writes while the new version starts
(additive migrations, cleanup) cannot make an update look failed.
