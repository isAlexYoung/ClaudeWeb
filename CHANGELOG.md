# Changelog

All notable changes to ClaudeWeb are listed here. Versions start at 2.0.0;
2.0.0 to 2.0.3 were test releases and 2.1.0 is the first stable release.

## Unreleased

## 2.3.13 - 2026-11-28 (stable)

- Clawd: the Claude Code mascot as pixel animations, from the 400 animations of "Clawd 400" by 风花叶 (CC BY 4.0, https://github.com/khiqwq/clawd-400; unofficial fan art, the character belongs to Anthropic). On a new Chat or Code conversation Clawd stands beside the heading and says hello for the time of day, marks Chinese and Western holidays (lunar festivals included), or offers something to do together; clicking its bubble puts that in the message box without sending it. Above a conversation's message box Clawd acts out what Claude is doing (thinking, writing, editing files, running commands, searching, waiting for a permission, compacting) and how the turn ended (celebrating, stopped, upset, or asleep at a usage limit). Double-click Clawd for another animation of the same state. Clawd cannot be selected or dragged, pauses when it is not visible, and is still when the system asks for reduced motion. Settings → Appearance → Clawd turns each part on or off: new conversations, above the message box, double-click switching, holiday greetings, and a still picture.

## 2.3.12 - 2026-11-27 (stable)

- Plugins: links on the Plugins page (the Claude connectors page and the Claude CLI connection guide in a recommended connector's dialog, a plugin's repository, the custom plugin guide) now open in the built-in browser on the server, which keeps your sign-ins there; ClaudeWeb opens the page in a new tab of the running browser, or as the first page of the browser it starts. Every such link has a copy button beside it to open it anywhere else. In Settings, where the built-in browser cannot be shown, links still open in a new tab of your own browser.
- Connectors: CMCP connectors are named after the computer and the way it is reached, such as "windows-web" (the ClaudeWeb URL login), "windows-ssh" or "windows-web + ssh", instead of CMCP's internal name, which is shown on hover. Claude's tool names do not change. A standalone SSH connector from CMCP 4.24 is now checked through its relay too and shown as "ssh".

## 2.3.11 - 2026-11-27 (stable)

- Settings > About: when an update finishes, the page now reloads into the new version. Before, the update section re-read its status in a loop while About was open, and that loop cancelled the pending reload as soon as the update finished, so the old release notes stayed, the version number changed only sometimes, and clicking Update again failed. If the server already runs a newer version than the open page (an update finished in another tab, for example), the old notes give way to "ClaudeWeb X is installed. Reload the page to use it." with a reload button, an offer for the installed version is no longer shown, and clicking Update while an update is already running follows that update instead of showing an error. The page you update from still runs the old code, so after updating from 2.3.10 reload once by hand if it does not reload on its own.
- Connectors: CMCP 4.25's single connector per PC (`cmcp-pc-<id>`, which reaches the PC through the URL or SSH route chosen in CMCP) is shown as connected while its PC is reachable. Before, ClaudeWeb did not recognise it and showed "Disconnected" whenever no reply was running, even though the PC could be used. Other connectors now say "Not started" while no reply is running, because Claude starts them with each reply, instead of "Disconnected".
- Menus: a submenu opened near the bottom of the window (Code's Recents sort menu, for example) no longer shows a scrollbar for content that fits.

## 2.3.10 - 2026-11-27 (stable)

- Model menus: models the signed-in Claude account cannot use are shown greyed out and cannot be chosen, with the reason in place of the description. Fable is not included in Pro (or Free) subscriptions or in Team and Enterprise standard seats, but Claude Code still lists it for them; ClaudeWeb now reads the plan from the Claude login (`subscriptionType` and the account's `seatTier`) and marks every Fable model in the composer's model menu and the scheduled-task editor. A session or default saved on such a model falls back to the account's default instead of sending to it. Nothing is greyed out when chats run on an API key, a long-lived token or a cloud provider, or when the login names no plan.

## 2.3.9 - 2026-11-26 (stable)

- Usage limits: Claude Code's "You've hit your 5-hour limit · resets 9:20pm (Asia/Singapore)" reply (and the weekly and Opus variants) is now shown as a card with the limit, the reset time in your time zone and a live countdown. A checkbox on the card schedules a message for a minute after the reset that asks Claude to continue the previous task; it is an ordinary scheduled message, so it also shows above the composer, can be cancelled there or by unticking, and is sent by the server even if the page is closed. Once sent, the card says when. The usage-limit banner at the top of the conversation is gone.
- Editing the first message of a Claude conversation works again. The replacement starts a new Claude session, and the conversation now moves onto it: before, it ran in a transcript nothing pointed at, so it showed up as a second conversation in the sidebar, the original message stayed in the conversation (and reappeared at the bottom after switching away and back), and the next message continued the conversation from before the edit. The transcript left behind is no longer offered as a conversation of its own and is deleted together with the conversation.
- Deleting a conversation first stops a reply or background task still running in it. Before, the still-running process wrote to the deleted transcript again, and the conversation came back in the sidebar.
- Sidebar Projects: several projects can be open at once. Opening a project no longer closes the others, and the open projects are remembered after reloading. The "Keep projects expanded" setting, which used to be needed for this, is gone.

## 2.3.8 - 2026-11-25 (stable)

- Artefacts import and export: the download menu (editor title menu and the conversation card's download button) now offers spreadsheets as Excel `.xlsx` (every sheet, with formulas, styles, merges, column widths, row heights and frozen panes) or CSV of the current sheet; documents as Word `.docx` (headings, lists, task lists, quotes, code, tables and images), PDF through the print dialog, or Markdown; and whiteboards as PNG, SVG or `.excalidraw`. The Artefacts page imports `.xlsx`, `.csv`, `.tsv`, `.docx`, `.md`/`.txt` and `.excalidraw` files from New → "Import files…" or by dropping them on the page; one file opens straight away, several are summed up, and anything a file held that the artefact cannot keep (images or conditional formatting in a workbook, for example) is named. Old `.xls`/`.doc` files are refused with a hint to save them in the newer format. CSV files in GBK are read correctly.
- Backup and restore now include artefacts: their files and their list entries (title, pinned, linked conversation) are exported, and the restore preview offers them as one choice. Restoring never replaces an artefact or file that is already here, and an artefact is linked back to its conversation only when that conversation exists.

## 2.3.7 - 2026-11-25 (stable)

- Long conversations: scrolling up through history is smooth. Older messages are now loaded a screen and a half before you reach the top, in larger pages while they keep landing inside a collapsed "Thinking and work" section, so new content actually appears above instead of only the "Showing X of Y" count going up. Loading no longer stalls at the top until you scroll down and back up. The view stays on what you were reading while pages arrive, the first turn on screen is no longer rebuilt (an opened "Thinking and work" stays open), and "Load all messages" no longer jumps to the start of the conversation. The load-all prompt and the loading line no longer push the transcript up and down when they appear.

## 2.3.6 - 2026-11-25 (stable)

- Sidebar Recents: Chat and Code now keep separate Recents lists (Chat shows chats and artefacts, Code shows project conversations), and the separate Chats list is gone. Rows no longer start with a chat or artefact icon; conversations owned by an artefact show a small kind icon at the end of the row instead. The Recents header has a collapse toggle and a filter button. In Chat the filter offers status (active, archived, all), last activity (1, 3, 7 or 30 days, or all time), scheduled runs (shown, grouped or hidden), grouping (date, unread, status or none), sorting (name, created or last activity) and New section. Sections are named folders that conversations can be moved into from the row's "…" menu, and they can be collapsed, renamed or deleted. In Code the button offers sorting only (last updated, created or name, ascending or descending). Filters, sections and collapsed state are saved with your preferences.

## 2.3.5 - 2026-11-25 (stable)

- Artefacts split view: showing or hiding the conversation now narrows or widens the spreadsheet, document or whiteboard together with the sliding conversation, instead of resizing it only once the slide has finished. The compact conversation header shows "Conversation" instead of a missing-translation message.

## 2.3.4 - 2026-11-25 (stable)

- Artefacts: documents and whiteboards can now be created and edited, with the same split view, minimize card, scroll-docked header pill, floating composer, empty-state sketch with suggestions, read-only while Claude works, 800ms autosave and conflict reload as spreadsheets. Documents use Tiptap and are stored as Markdown (`~/Artefacts/<id>.md`) with a formatting toolbar and Markdown download; whiteboards use Excalidraw and are stored as `.excalidraw` scenes, follow the dark theme and interface language, download as PNG or `.excalidraw`, and ship their fonts with ClaudeWeb instead of loading them from a CDN. Claude may write simplified whiteboard shapes and arrows; arrows joined to shapes by id are drawn edge to edge and are not clipped by frames.

## 2.3.3 - 2026-11-25 (stable)

- Spreadsheet scrolling & panning: replace the blocking `.sheet-editor-lock` overlay with FortuneSheet's native `allowEdit` read-only mode so wheel scrolling (vertical and `Shift`+wheel horizontal) and panning continue working smoothly both while idle and while Claude is editing.
- Smooth split view reusing the live main Chat window: opening a spreadsheet from Chat or 「作品 / Artefacts」 smoothly glides the real `ChatInterface` to the right (`left spreadsheet + right live chat`, hiding the duplicate bottom composer while keeping full Markdown, interactive SVG charts, right-aligned user bubbles, thinking/tool groups, and permission prompts), with the floating spreadsheet composer wired directly into the live Chat submission pipeline and smooth reverse glide on close or panel toggle.
- Scroll-linked spreadsheet card transition: when scrolling down in a spreadsheet's Chat conversation, the top spreadsheet card smoothly fades/lifts out while a compact clickable spreadsheet pill smoothly transitions into the header bar next to the conversation title, reversing smoothly on scroll back up.

## 2.3.2 - 2026-11-24 (stable)

- Database migration & session resume: stop `addProviderSessionIdMapping` from backfilling `provider_session_id = session_id` on every restart for pending app sessions with no transcript yet (which caused newly created spreadsheet/chat sessions to fail after an upgrade/restart with `No conversation found with session ID`), and automatically heal already-affected rows on startup.
- Detached runs & spreadsheet error visibility: propagate runtime-emitted `error` / non-zero `complete` events (and SDK `result.is_error` frames) from `dispatchRun` to detached callers (`artefacts`, scheduled tasks, scheduled messages) instead of silently reporting success; surface failed-run errors in the spreadsheet editor notice and right-hand conversation drawer.
- Spreadsheet model/settings & transcript sync: forward the user's selected Claude model, reasoning effort and Chat MCP preference from the spreadsheet editor, respect the merged provider catalog default (including custom-models-only) when no explicit model is passed, and locate newly written Claude JSONL transcripts on disk before the periodic watcher indexes `jsonl_path`.

## 2.3.1 - 2026-11-24 (stable)

- Artefacts sidebar icon: synchronously propagate created/opened/renamed artefact sessions so conversations owned by an artefact immediately display the Artefacts icon instead of a chat bubble.
- Chat & spreadsheet card: center the minimized spreadsheet card above the conversation, apply the spreadsheet placeholder in the Chat composer, and hide the bottom-right quota ring in Chat mode (both Chat home and conversations).
- Spreadsheet conversation drawer & header: redesign the empty drawer with a sketched grid illustration and clickable suggestion pills that fill the composer without auto-sending (removing the redundant close `×` and old empty text); update the top-right controls so diagonal arrows toggle the conversation panel and `×` minimizes the spreadsheet to Chat; raise the floating composer layer above FortuneSheet's bottom control strip so underlying text no longer bleeds through.

## 2.3.0 - 2026-11-24 (stable)

- 更新了“作品”功能。 / Updated the Artefacts feature.
- Artefacts: creating a spreadsheet now immediately creates its dedicated Chat conversation (marked with the Artefacts icon in the left sidebar and synced on rename); the spreadsheet editor adds a Minimize button to return to that conversation with a top card to reopen the sheet or download CSV, and messages sent directly in that Chat automatically edit the linked spreadsheet.
- Artefacts & sidebar: show Artefacts only in Chat mode (expanded and collapsed), fix overlapping filter submenus in `ScheduledTaskMenu`, fix the spreadsheet conversation drawer being covered by the FortuneSheet canvas and resize cleanly when toggled, and fix `A1:NaN` in the formula bar name box.

## 2.2.8 - 2026-11-24 (stable)

- Add Artefacts (作品) to the left sidebar, between Search and Scheduled tasks, in both Chat and Code. The page lists your artefacts as cards or rows, with search, a filter menu (sort by last opened, date created or name; type with counts; opened date; pinned only), a grid/list switch that is remembered, and a New menu. Cards can be opened, pinned, renamed, deleted or followed to their conversation.
- Spreadsheets can be created and edited: an open-source grid (FortuneSheet) with formulas, merged cells, frozen rows, number formats, text and fill colours, undo and CSV download. Describe a change in the box under the sheet and Claude edits the file (`~/Artefacts/<id>.sheet.json`) in its own conversation while the grid waits read-only; the conversation can be shown beside the sheet or opened in the full chat. Your own edits save automatically, and a save that would overwrite a change Claude just made reloads Claude's version instead. Documents, slides, designs, data and whiteboards show their tiles and say they are coming soon.
- Scheduled tasks now appears in the left sidebar only in Chat mode. Switching between Chat and Code slides the mode switch and fades the sidebar's content across.

## 2.2.7 - 2026-11-24 (stable)

- Compaction: the summary a compaction produces no longer shows up during the run as a message you sent; it is folded into the one-line "Compacted" row, as it already was after a reload, and its full text leaves out the reminder blocks written for the model.
- Context panel: the context window is no longer taken as 160K for sessions that are clearly larger. A session that has held more than that (or a model chosen with the [1m] suffix) is measured against the next window size, so a 1M session stops reading 100% before and after compacting, and the counter drops to the compacted size as soon as a compaction finishes.
- Chat: conversations stay loaded in the browser until the page is reloaded. Switching to another conversation, or to Scheduled tasks or Plugins, and back shows the conversation as it was — older pages included — and only fetches what is new. The 30 most recently opened conversations are kept; signing out clears them.
- Right sidebar: running background tasks (workflows, agents, backgrounded commands) are listed under Memory with how long each has been running and a button to stop it. Nothing is shown when no task runs.

## 2.2.6 - 2026-11-24 (stable)

- Scheduled task editor: the Model menu lists the Claude models again (Default model, Fable / Opus / Sonnet / Haiku by version, older versions under More models); the Instructions box grows with its text instead of showing a resize handle; the "+" run-location option is gone and new scheduled tasks always run in Chat (editing an existing task keeps its folder).
- Chat composer: images and files attached to a message you have not sent yet stay with that conversation while you open Scheduled tasks or Plugins and come back, and no longer carry over when you switch to another conversation. Reloading the page still clears them.
- Scheduled task editor: the time button opens an hour and minute menu in the same style as the frequency menu instead of the browser's time picker; one-off tasks keep their date field and use the same time menu.

## 2.2.5 - 2026-11-24 (stable)

- Redesign Scheduled tasks: a large title with My tasks and Templates tabs, search, Source and Status filters, sorting by next run or name with an option to include completed one-off tasks, and a New task menu with "Create with Claude" and "Set up manually". Six templates (daily briefing, inbox triage, meeting prep, weekly review, content ideas, topic watch) sit under a wavy divider below your tasks and on their own tab.
- Templates, "Create with Claude" and the editor's "Set up with Claude instead" open a new chat with the prompt already typed, ready to edit or send.
- The task editor gains Instructions with Permission (Manual / Auto / Skip all approvals) and Model menus (with More models), a Trigger row (scheduled every day, on weekdays or on chosen days; every few hours; once) and a "+" for where the task runs. Scheduled tasks accept a new `manual` permission that approves nothing automatically; backups keep it.

## 2.2.4 - 2026-11-24 (stable)

- Add a sidebar Plugins page that shares the Settings extension manager, with full-size search, filters, enabled/disabled cards, and installation flows. Add Google Drive, Gmail, Google Calendar, and Microsoft 365 recommendations with Claude account authorization guidance, a selectable/copyable connection link, access to the persistent built-in browser, and documented VPS CLI requirements.
- Share the existing browser session and its minimized orange indicator between chat and the standalone Plugins page. Keep connector recommendations exclusive to the standalone page.

## 2.2.3 - 2026-11-24 (stable)

- Unify Settings > Plugins into searchable, filterable extension cards grouped by enabled state, with installation on a separate page and animated state changes. Add persistent MCP/skill toggles and move the chat MCP preference to Tasks & sessions.

## 2.2.2 - 2026-11-23 (stable)

- Promote Plugin Host v2 (`apiVersion: 2`) to stable: multi-slot plugin architecture (`background`, `overlay`, `settings`, `tab`), single-active background slot arbitration, unified `activate()`/`deactivate()` lifecycle, live workspace `project`/`session` and `isFocusedSession` propagation, and stable plugin UIs across list refreshes.
- Add seamless full-window smoked-dark / frosted-light wallpaper glassmorphism with adaptive `tone` (`auto` / `dark` / `light`), floating transparent header, frosted glass composer capsule, adaptive Markdown/prose contrast, and host-verified public login-screen appearance snapshots (`/api/public/appearance`).
- Add short-lived session-bound Scoped Media Tickets (`Range`/`206` streaming with magic-byte MIME whitelist), streaming binary `rpcRaw`, persistent `PLUGIN_DATA_DIR`, prebuilt SHA-256 artifact verification, atomic temp-directory Git updates, Safe Mode (`?safe-plugins=1`), Boot Crash Guard, and `claudeweb plugins --disable-all`.
- Publish standalone third-party plugin SDK declarations (`doc/plugin-sdk/claudeweb-plugin.d.ts`), Manifest JSON Schema (`doc/plugin-sdk/manifest.schema.json`), and complete `doc/CUSTOM_PLUGINS.md` developer reference.

## 2.2.1 - 2026-11-23 (test)

- Redesign wallpaper glassmorphism (`workspace-theme.css`) to a seamless full-window smoked-dark / frosted-light glass aesthetic with adaptive `tone` (`auto` / `dark` / `light`), floating transparent header, frosted composer capsule, and adaptive Markdown/prose typography contrast across Warm, Light, and Dark themes.
- Unify plugin lifecycle coordination (`createPluginInstanceManager`) so `activate()` runs once per live plugin instance across `background`, `overlay`, `settings`, and `tab` slots and `deactivate()` runs once on final slot teardown, disable, update, uninstall, or logout.
- Propagate live workspace `route`, `project`, and `session` context plus live `focusedSessionId` (`isFocusedSession`) to global plugins and the normalized event bus.
- Stabilize `PluginTabContent` and `PluginSettingsPanel` effect dependencies on primitive identity/version/revision keys so refreshing the plugin list never remounts active plugin UIs.
- Fix `doc/CUSTOM_PLUGINS.md` (`build.mode`: `"auto"` / `"prebuilt"`), add standalone `doc/plugin-sdk/claudeweb-plugin.d.ts` and `doc/plugin-sdk/manifest.schema.json`, and document media ticket renewal, `Range`/`206`, `/plugin-ws/:name`, and host error codes.

## 2.2.0 - 2026-11-23 (test)

- Introduce Plugin Host v2 (`apiVersion: 2`) supporting `background`, `overlay`, `settings`, and `tab` slots with single-active background arbitration and drawer/modal settings panels.
- Add short-lived session-bound Scoped Media Tickets (`Range`/`206` streaming with safe MIME sniffing), streaming binary `rpcRaw`, persistent `PLUGIN_DATA_DIR`, prebuilt SHA-256 artifact verification, and atomic temp-directory Git updates.
- Add host-verified public login-screen appearance snapshots (`/api/public/appearance`, `no-store`, `single` and `per-theme` warm/light/dark slots) and workspace glassmorphism CSS surface variables.
- Add normalized plugin event bus (`turnId`/`runId`/`getSnapshot`), browser Safe Mode (`?safe-plugins=1`), Boot Crash Guard, backend crash circuit breaker, and `claudeweb plugins --disable-all` CLI recovery command.

## 2.1.5 - 2026-11-23 (stable)

- Connect PC MCP tools directly through a ClaudeWeb URL with CMCP 4.24.2, without a separate SSH connection.
- Register the connector in the ClaudeWeb service user's own configuration and retain existing MCP entries.
- Share one authenticated session between the tool connection and its browser, and sign out that session when CMCP disconnects.

## 2.1.4 - 2026-11-23 (stable)

- Keep login and loading screens on the chosen theme, with warm white as the default.
- Refine extension list separators, input focus, MCP form colours and the repository link.
- Refresh plugins, MCP and skills together without clearing visible lists or repeated background scans.
- Add skills from public GitHub links, including supporting files.
- Move technical setting notes into `doc/SETTINGS.md` with their storage locations.

## 2.1.3 - 2026-11-22 (stable)

- Updated UI layout.

## 2.1.2 - 2026-11-22 (stable)

- Updated UI layout.

## 2.1.1 - 2026-11-22 (stable)

### Changed

- Place a smaller 24 px repository logo before the sidebar controls and in the
  collapsed rail. Clicking it opens the ClaudeWeb repository. Refresh browser
  icon URLs so older favicons are replaced.
- Simplify Plugins settings to custom repository installation and installed
  plugin controls. Add an original custom-plugin guide; remove the catalog and
  starter-template links. Use Plug and the MessageCircle chat bubble for Plugins
  and Tasks & sessions.
- Remove Git settings and its unused identity APIs/adapters. Existing database
  values and project Git features are retained; identity can be set with Git CLI.
- Center the bilingual README headers with badges and navigation. Keep public
  documentation focused on usage; remove development plans and validation logs.
- Remove stale CloudCLI marketing and plugin-catalog references while keeping
  upstream attribution, third-party provenance and legacy-backup compatibility.

## 2.1.0 - 2026-11-22 (stable)

The first stable release, for amd64 servers running Debian 12, Debian 13,
Ubuntu 22.04, Ubuntu 24.04 or Ubuntu 26.04, each accepted on a real VPS.
The default one-line install and Settings > About now offer it.

### Added

- The ClaudeWeb logo: a chat-bubble C around a folded, raised W in white on
  Claude-style orange. It is the browser tab icon, the home-screen icon
  (192 and 512 px, Apple touch icon) and the mark on the login page.

### Changed

- Hide composer model/effort and permission menu scrollbars while retaining
  scrolling. Disable the model/effort control until Claude CLI is signed in,
  rechecking login when the page regains focus and while it remains visible.
  Animate Side chat and Memory with the same disclosure used by Context and Connectors.
- Default the workspace account label and named home greetings to `User`,
  preserving custom profile names. Remove the API and tokens settings page
  from desktop/mobile navigation and fall back to General for old links to it.
- Add Debian 13 amd64 to the shared platform rules, release metadata and VM
  matrix, using Debian's minisign and ALSA t64 packages. Preserve Debian's
  graphical sandbox policy and use the existing disk-backed staging and
  `/etc/sysctl.d` configuration. Older packages remain refused on Debian 13.
  Accepted on a real Debian 13 VPS.
- Add Ubuntu 26.04 LTS amd64 admission, metadata and VM checks alongside
  24.04. Keep large installer/update staging under
  `/var/tmp` so Resolute's default `/tmp` tmpfs does not hold release archives.
  sudo-rs, Rust coreutils and the graphical policies were checked on a real
  Ubuntu 26.04 VPS.
- Start the loopback web service and retrying tunnel after `network.target`
  without pulling in `network-online.target`. VPS images whose interfaces are
  managed outside systemd-networkd no longer block ClaudeWeb installation while
  its unrelated wait-online service waits.
- Recognize sudo-rs authentication failures, including messages split across
  pipe chunks, so an incorrect password gets the existing wrong-password hint.
- Poll graphical window readiness so class/visibility changes after mapping
  are observed. Lifecycle acceptance checks retain the main application and
  displays, allowing transient renderer/GPU helpers to exit normally.
- Add Ubuntu 24.04 LTS amd64 to the shared installer and package platform rules,
  using the distro's minisign and ALSA t64 package. Keep the Ubuntu 22.04 glibc
  2.35 build baseline and refuse older packages that do not declare Noble.
- Prepare an application-specific AppArmor user-namespace profile for Playwright
  Chromium on Noble, preserving official ClaudeDesktop's own profile. Install,
  repair and update load it without disabling global restrictions or browser sandboxes;
  uninstall removes only ClaudeWeb-managed policy. Existing administrator policy
  and unsafe symlinks are left unchanged with an actionable error.
- Add pinned Ubuntu 24.04 VM targets, AppArmor policy checks and actual Desktop
  lifecycle checks to the Noble browser test.

## 2.0.3 - 2026-11-22 (test release)

### Fixed

- Creating swap works with Ubuntu 22.04's util-linux: silence `mkswap` output
  without its unavailable `-q` option. VM installation checks now verify active
  swap, including installations through the published one-line command.

### Changed

- Installers and repair commands accept Ubuntu 22.04 LTS amd64 as
  well as Debian 12. Platform dependencies are maintained in one shared source;
  Ubuntu enables Universe when needed and bootstraps the missing minisign tool
  from a fixed upstream release with a pinned SHA-256.
- Release packages build their native modules on Ubuntu 22.04 for a common
  glibc 2.35 baseline. Installation and updating check the package's declared
  platforms and load SQLite, bcrypt and a PTY before replacing the running
  version. Existing Debian-only releases are refused on Ubuntu. Settings shows
  a localized explanation when an incompatible package leaves the old version
  running, including after reopening Settings. Redirected installations skip
  the optional domain prompt instead of waiting for invisible terminal input.
- Packaging CI includes Debian 12 and Ubuntu 22.04 VM targets. Real Ubuntu VPS
  acceptance and account sign-in remain separate checks; this is a test release.
- The one-line installer shows 15 numbered stages instead of streaming package
  download output. Detailed command output stays in the private installation
  log; failures show a short error excerpt and its path. Domain prompts and
  final passwords remain visible, with passwords excluded from the log.
- Successful installation ends with a `welcome to` / `CLAUDEWEB` ASCII banner,
  using a compact title on narrow terminals. The large lettering uses the
  reference pale orange (#E0B09D) on its upper three rows and white on its
  lower two rows. ANSI colors appear only in an interactive terminal; logs
  and redirected output stay plain text.

### Added

- ClaudeDesktop opens from the asterisk beside Terminal in a fixed modal with
  full-screen, minimize and close controls. Minimize keeps the app alive;
  close ends its private process groups and removes runtime files and
  regenerable Electron caches, preserving sign-in, configuration and keyrings.
  Closing during startup cancels the window waiter; normal server shutdown also
  reclaims its graphical sessions.
- Minimized terminal, browser and ClaudeDesktop tools show an orange dot on
  their header icons. Restoring keeps the same running session.
- `claudeweb install-desktop` installs the official signed APT package and its
  graphical/keyring dependencies. Fresh installs and updates attempt to install
  Desktop when absent. No stable release is published.

## 2.0.2 - 2026-11-21 (test release)

### Added

- Domains: `claudeweb domain` (also offered at the end of the installation)
  gives ClaudeWeb an HTTPS address under a Cloudflare-managed domain through a
  Cloudflare Tunnel, without opening a port. It asks for the domain (twice), a
  random or chosen name one level under it, the Account ID, the Zone ID and a
  hidden API token that is never stored; creates the tunnel, its route to
  ClaudeWeb and a proxied DNS record; installs cloudflared from Cloudflare's
  signed package source (key pinned); and reports the address only when the
  tunnel is connected, the page answers and an API without a login is
  refused. An interrupted setup continues or is cleaned up on the next run.
  `claudeweb domain --status`, `--remove` and `--remove --local`;
  `claudeweb status` shows the domain. Tested against a local stand-in for the
  Cloudflare API (`packaging/test-domain.sh`), not yet against Cloudflare.
- Moving from WebDesktop: a backup made in another home folder (WebDesktop's
  ClaudeWeb ran in `/home/wdguest`) is restored under this one. Transcript
  folders, every `cwd` in the transcripts and the project paths of the
  restored rows move to `/home/claudeweb`, so the conversations continue in
  the new place; paths outside the old home stay as they are. The import
  preview says so.
- Backups can include project folders: Settings > Backup & restore lists the
  projects inside the home folder to choose from. They are stored under
  `files/` with their Git history and permissions (no links, no set-id
  bits); an import restores them under the home folder, never into its
  hidden folders and never over an existing file.
- Backups include Claude's user settings: settings.json (its `env` entries
  whose names mention a key, token, secret, password, credential or auth are
  left out), CLAUDE.md, and the commands, agents, skills and output-styles
  folders; never the sign-in or `.claude.json`. The import lists them as one
  entry that can be left out, keeps files that exist, and moves paths under
  the old home folder in settings.json to the new one.
- Backups list the plugins installed from a repository (name, source,
  enabled), never their code or keys. After an import, Settings > Backup &
  restore lists the ones this server lacks with an Install button that puts
  each back from its source.
- The update confirmation in Settings > About says how many conversations
  (scheduled tasks included) the restart would stop.

## 2.0.1 - 2026-11-21 (test release)

### Fixed

- Settings showed "TaskMaster AI CLI is not installed" after signing in on
  the login page (or through CMCP), although the bundled TaskMaster works.
  The check ran before sign-in, was refused, and was not repeated; it now
  runs once the session is signed in.
- The README's install command runs as root without `sudo` (Debian has no
  `sudo` until ClaudeWeb installs it).

### Added

- The **Check a published release** workflow can install one published
  release and update it to another (`from` input), the way a server is
  updated with `claudeweb update --version=X.Y.Z`.

## 2.0.0 - 2026-11-21 (test release)

### Added

- One login password per server, set by root: `claudeweb password` shows it,
  `claudeweb password --set` replaces it with a generated one (`--stdin` for
  your own). The web page asks only for the password; there is no sign-up.
- Failed passwords lock the visitor's IP: 1 minute after 5 tries, then
  5 minutes, then 30 minutes. The page shows the time left.
- Sessions are kept on the server: signing out ends only that device, and a
  new password signs out every device.

- `install.sh` installs ClaudeWeb from a release package on Debian 12 amd64:
  the `claudeweb` user, its folders, the official Claude Code CLI, swap when
  the machine has none, IPv6 turned off, a generated login password, and the
  `claudeweb` service on 127.0.0.1:3001. Running it again repairs the install
  and keeps the password and data.
- The `claudeweb` command for root: `help`, `status`, `logs`, `doctor`,
  `password`, `swap`, `uninstall` (projects are kept unless
  `--delete-projects`).
- `packaging/build-release.sh` builds the release package, with its own
  Node.js 22.
- Signed releases: `install.sh` installs the latest stable release from a
  list signed with ClaudeWeb's minisign key (`--version` for test releases).
- `claudeweb update` and Settings > About update to the latest stable
  release: download checked against the list, database copied, automatic
  return to the previous version when the new one does not start.
  `claudeweb rollback` returns to the previous version from any state.

- The browser panel runs Playwright's Chromium on the server, on a private
  display (Xvnc) with Openbox, Chinese fonts and Fcitx 5 Pinyin input. Text
  and PNG clipboard on request; another device takes the browser over; it
  is kept ten minutes after a dropped connection. `claudeweb
  install-browser` installs or repairs it; updates install a newly pinned
  Chromium.

- Up to three devices can be signed in. A new login while another device is
  signed in asks whether to join or take over (sign the others out); when
  three are signed in it asks which one to sign out. Settings > About lists
  the signed-in devices and can sign one out; the others see a notice when
  a new device joins. Web logins end after an hour without use. The oldest
  login is the main device and is the only one that can start an update.
  Connections of a signed-out device close within 15 seconds.
  Scripts calling `POST /api/auth/login` should send `"mode": "join"` or
  `"takeover"`.
- CMCP sign-in (CMCP 4.24.0 and later): `GET /api/auth/cmcp` names the
  protocol `claudeweb-cmcp`; CMCP trades the saved password for a one-time
  code (`POST /api/auth/cmcp/code`, two minutes, under the same IP lockout)
  and opens the page at `/#cmcp=<code>`, which signs itself in through
  `POST /api/auth/cmcp/redeem` with the same join / take over question.
  CMCP logins are listed as CMCP and do not end after an idle hour. Older
  CMCP releases open the page with the normal password form.
- sudo for Claude, allowed each time in ClaudeWeb: a `sudo` in a chat's
  command shows the exact command and folder on every signed-in page;
  typing the sudo password and choosing Allow runs it once through
  `sudo -S -k`, Refuse or five minutes without an answer fails it. The
  password goes only to sudo: not to Claude, the logs or the browser's
  storage. The installer puts the claudeweb user in the sudo group with a
  generated password (never password-free sudo), shows it once, and keeps
  that user out of SSH (DenyUsers); `claudeweb sudo-password` shows or
  changes it. In the terminal, sudo asks for the password as usual.
- A tool call of Claude's that names the user's sensitive information asks
  first, even when tool approvals are off: Claude's login credentials, the
  built-in browser's cookies and sign-in data, ClaudeWeb's database and
  settings, and a release signing key. The card says "This is the user's
  sensitive information" and what the call would reach; Allow this once
  or Refuse. Unattended runs refuse. Only calls that name these files are
  caught (file tools, searches, command lines); one list in
  server/modules/sensitive-access.
- Out of memory, Linux ends what ClaudeWeb started (Claude, terminals, the
  browser) before ClaudeWeb itself: the service runs with
  OOMScoreAdjust=-100 and raises everything below it to 500 every few
  seconds; sshd is not outranked.

### Changed

- ClaudeWeb is now a standalone project, independent of WebDesktop. The
  application started from the ClaudeWeb 1.0.17 code.
- Names, data folder (`~/.claudeweb`), environment variables
  (`CLAUDEWEB_*`) and the package name changed from CloudCLI to ClaudeWeb.
  Backups made by earlier releases still restore.
- The server listens on `127.0.0.1` unless `HOST` says otherwise.
- The app's `update` command no longer installs from npm; updates go through
  the root command `claudeweb update`.

### Removed

- The hosted "platform mode", which trusted every request as the first user.
  ClaudeWeb now checks every request itself.
- Upstream-only parts: Docker sandbox command, desktop app, npm publishing,
  the Pro upsell card.
