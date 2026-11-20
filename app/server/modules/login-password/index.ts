// This module touches only the two password files, never the database, so the
// CLI can use it as root without opening or creating auth.db.

// getLoginPasswordFiles: used by Auth and the CLI to locate login.json and the root-only copy.
export { getLoginPasswordFiles } from './login-password.service.js';
// getLoginPasswordGeneration, verifyLoginPassword: used by Auth to check passwords and sessions.
export { getLoginPasswordGeneration, verifyLoginPassword } from './login-password.service.js';
// generateLoginPassword, describeUnusablePassword, writeLoginPassword, readStoredLoginPassword:
// used by the CLI `password` command.
export {
  describeUnusablePassword,
  generateLoginPassword,
  readStoredLoginPassword,
  writeLoginPassword,
} from './login-password.service.js';
