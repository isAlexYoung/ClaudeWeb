# Claude usage integration for ClaudeWeb

This bundled plugin supplies the composer's usage ring and the quota dashboard.
ClaudeWeb manages it automatically; no separate plugin installation is needed.
It is hidden from the user-managed Plugins list to keep the usage integration
available.

The integration reads local Claude Code usage records and account usage where
available. Its history view groups usage by date, model and project. Account
sign-in and network access are needed for account-limit information. Displayed
API cost estimates are not subscription billing totals.

The npm package retains the upstream name `cloudcli-plugin-claude-usage`.
It originates from [HandyS11/cloudcli-plugin-claude-usage](https://github.com/HandyS11/cloudcli-plugin-claude-usage).
See its [MIT license](LICENSE) and the project's
[third-party notices](../../../THIRD_PARTY_NOTICES.md). ClaudeWeb-specific
integration changes are maintained in this repository.

To build a separate custom plugin, see the
[ClaudeWeb custom-plugin guide](../../../doc/CUSTOM_PLUGINS.md).
