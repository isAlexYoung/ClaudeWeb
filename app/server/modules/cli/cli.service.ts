import path from 'node:path';

import type {
  CliApplication,
  CliEnvironment,
  CliFileSystem,
  CliOutput,
  CliPackageMetadata,
} from '@/shared/types.js';
import { terminalTextStyles } from '@/shared/utils.js';

type CliServiceDependencies = {
  applicationRoot: string;
  defaultDatabasePath: string;
  homeDirectory: string;
  packageMetadata: CliPackageMetadata;
  environment: CliEnvironment;
  fileSystem: CliFileSystem;
  output: CliOutput;
  loginPassword: {
    /** The current password from the root-only file; throws AppError when unset or unreadable. */
    read(): string;
    /** Stores a new password; every signed-in device is signed out. */
    write(password: string): Promise<void>;
    generate(): string;
    /** An English reason the password cannot be used, or null. */
    describeUnusable(password: string): string | null;
  };
  /** One line typed by the user (hidden on a terminal) or piped in. */
  readSecretLine(prompt: string): Promise<string>;
  startServer(): Promise<void>;
};

type ParsedCliArguments = {
  command: string;
  options: {
    serverPort?: string;
    databasePath?: string;
  };
  /** Everything after a command that takes its own options, such as `password`. */
  commandArguments: string[];
};

function parseCliArguments(argumentsList: string[]): ParsedCliArguments {
  const parsedArguments: ParsedCliArguments = {
    command: 'start',
    options: {},
    commandArguments: [],
  };

  for (let argumentIndex = 0; argumentIndex < argumentsList.length; argumentIndex += 1) {
    const argument = argumentsList[argumentIndex];
    if (argument === '--port' || argument === '-p') {
      parsedArguments.options.serverPort = argumentsList[++argumentIndex];
    } else if (argument.startsWith('--port=')) {
      parsedArguments.options.serverPort = argument.slice('--port='.length);
    } else if (argument === '--database-path') {
      parsedArguments.options.databasePath = argumentsList[++argumentIndex];
    } else if (argument.startsWith('--database-path=')) {
      parsedArguments.options.databasePath = argument.slice('--database-path='.length);
    } else if (argument === '--help' || argument === '-h') {
      parsedArguments.command = 'help';
    } else if (argument === '--version' || argument === '-v') {
      parsedArguments.command = 'version';
    } else if (!argument.startsWith('-')) {
      parsedArguments.command = argument;
      if (argument === 'password') {
        parsedArguments.commandArguments = argumentsList.slice(argumentIndex + 1);
        break;
      }
    }
  }

  return parsedArguments;
}

function showStatus(dependencies: CliServiceDependencies): void {
  const { environment, fileSystem, output } = dependencies;
  const databasePath = environment.DATABASE_PATH || dependencies.defaultDatabasePath;
  const databaseExists = fileSystem.pathExists(databasePath);
  const claudeProjectsPath = path.join(dependencies.homeDirectory, '.claude', 'projects');
  const environmentFilePath = path.join(dependencies.applicationRoot, '.env');

  output.log(`\n${terminalTextStyles.bright('ClaudeWeb - Status')}\n`);
  output.log(terminalTextStyles.dim('═'.repeat(60)));
  output.log(`\n${terminalTextStyles.info('[INFO]')} Version: ${terminalTextStyles.bright(dependencies.packageMetadata.version)}`);
  output.log(`\n${terminalTextStyles.info('[INFO]')} Installation Directory:`);
  output.log(`       ${terminalTextStyles.dim(dependencies.applicationRoot)}`);
  output.log(`\n${terminalTextStyles.info('[INFO]')} Database Location:`);
  output.log(`       ${terminalTextStyles.dim(databasePath)}`);
  output.log(`       Status: ${databaseExists
    ? terminalTextStyles.ok('[OK] Exists')
    : terminalTextStyles.warn('[WARN] Not created yet (will be created on first run)')}`);

  if (databaseExists) {
    const databaseStats = fileSystem.getFileStats(databasePath);
    output.log(`       Size: ${terminalTextStyles.dim(`${(databaseStats.size / 1024).toFixed(2)} KB`)}`);
    output.log(`       Modified: ${terminalTextStyles.dim(databaseStats.modifiedAt.toLocaleString())}`);
  }

  output.log(`\n${terminalTextStyles.info('[INFO]')} Configuration:`);
  output.log(`       SERVER_PORT: ${terminalTextStyles.bright(environment.SERVER_PORT || environment.PORT || '3001')} ${terminalTextStyles.dim(environment.SERVER_PORT || environment.PORT ? '' : '(default)')}`);
  output.log(`       DATABASE_PATH: ${terminalTextStyles.dim(environment.DATABASE_PATH || '(using default location)')}`);
  output.log(`       CLAUDE_CLI_PATH: ${terminalTextStyles.dim(environment.CLAUDE_CLI_PATH || 'claude (default)')}`);
  output.log(`       CONTEXT_WINDOW: ${terminalTextStyles.dim(environment.CONTEXT_WINDOW || '160000 (default)')}`);
  output.log(`\n${terminalTextStyles.info('[INFO]')} Claude Projects Folder:`);
  output.log(`       ${terminalTextStyles.dim(claudeProjectsPath)}`);
  output.log(`       Status: ${fileSystem.pathExists(claudeProjectsPath)
    ? terminalTextStyles.ok('[OK] Exists')
    : terminalTextStyles.warn('[WARN] Not found')}`);
  output.log(`\n${terminalTextStyles.info('[INFO]')} Configuration File:`);
  output.log(`       ${terminalTextStyles.dim(environmentFilePath)}`);
  output.log(`       Status: ${fileSystem.pathExists(environmentFilePath)
    ? terminalTextStyles.ok('[OK] Exists')
    : terminalTextStyles.warn('[WARN] Not found (using defaults)')}`);
  output.log(`\n${terminalTextStyles.dim('═'.repeat(60))}`);
  output.log(`\n${terminalTextStyles.tip('[TIP]')} Hints:`);
  output.log(`      ${terminalTextStyles.dim('>')} Use ${terminalTextStyles.bright('claudeweb --port 8080')} to run on a custom port`);
  output.log(`      ${terminalTextStyles.dim('>')} Use ${terminalTextStyles.bright('claudeweb --database-path /path/to/db')} for custom database`);
  output.log(`      ${terminalTextStyles.dim('>')} Run ${terminalTextStyles.bright('claudeweb help')} for all options`);
  output.log(`      ${terminalTextStyles.dim('>')} Access the UI at http://localhost:${environment.SERVER_PORT || environment.PORT || '3001'}\n`);
}

function showHelp(dependencies: CliServiceDependencies): void {
  dependencies.output.log(`
╔═══════════════════════════════════════════════════════════════╗
║              ClaudeWeb - Command Line Tool               ║
╚═══════════════════════════════════════════════════════════════╝

Usage:
  claudeweb [command] [options]

Commands:
  start            Start the ClaudeWeb server (default)
  status           Show configuration and data locations
  password         Show the login password (root only)
  password --set   Set a new, generated login password and sign out every device
  password --set --stdin
                   Set a login password you type (or pipe in) instead
  update           Explain how ClaudeWeb is updated
  help             Show this help information
  version          Show version information

Options:
  -p, --port <port>           Set server port (default: 3001)
  --database-path <path>      Set custom database location
  -h, --help                  Show this help information
  -v, --version               Show version information

Examples:
  $ claudeweb                        # Start with defaults
  $ claudeweb --port 8080            # Start on port 8080
  $ claudeweb status                 # Show configuration
  $ sudo claudeweb password          # Show the login password

Environment Variables:
  SERVER_PORT         Set server port (default: 3001)
  PORT                Set server port (default: 3001) (LEGACY)
  DATABASE_PATH       Set custom database location
  CLAUDE_CLI_PATH     Set custom Claude CLI path
  CONTEXT_WINDOW      Fallback context window size (default: 160000)

Documentation:
  ${dependencies.packageMetadata.homepage || 'https://github.com/isAlexYoung/ClaudeWeb'}

Report Issues:
  ${dependencies.packageMetadata.bugsUrl || 'https://github.com/isAlexYoung/ClaudeWeb/issues'}
`);
}

/**
 * Creates the top-level CLI command service used by the CLI composition root
 * and unit tests. Every filesystem, subprocess, environment, output, and
 * cross-module startup dependency is explicit and required.
 */
export function createCliService(dependencies: CliServiceDependencies): CliApplication {
  // Releases are signed and installed by the root-owned updater, never by the
  // service account, so this command only points at it.
  const explainUpdates = (): void => {
    dependencies.output.log(`${terminalTextStyles.info('[INFO]')} ClaudeWeb ${dependencies.packageMetadata.version} is updated by root on the server.`);
    dependencies.output.log(`${terminalTextStyles.tip('[TIP]')} Run as root: ${terminalTextStyles.bright('claudeweb update')}`);
  };

  const reportPasswordError = (error: unknown): number => {
    dependencies.output.error(`${terminalTextStyles.error('[ERROR]')} ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  };

  // `password` shows the current password; `password --set` replaces it with a
  // generated one, `--set --stdin` with one the user types. Reading needs root
  // (the file is 0600 root); so does writing to /etc/claudeweb.
  const runPassword = async (commandArguments: string[]): Promise<number> => {
    const unknown = commandArguments.filter((argument) => argument !== '--set' && argument !== '--stdin');
    const setting = commandArguments.includes('--set');
    if (unknown.length > 0 || (!setting && commandArguments.includes('--stdin'))) {
      dependencies.output.error(`${terminalTextStyles.error('[ERROR]')} Usage: claudeweb password [--set [--stdin]]`);
      return 1;
    }

    if (!setting) {
      try {
        dependencies.output.log(dependencies.loginPassword.read());
        return 0;
      } catch (error) {
        return reportPasswordError(error);
      }
    }

    let password: string;
    const chosen = commandArguments.includes('--stdin');
    if (chosen) {
      password = await dependencies.readSecretLine('New login password: ');
      const problem = dependencies.loginPassword.describeUnusable(password);
      if (problem) {
        dependencies.output.error(`${terminalTextStyles.error('[ERROR]')} ${problem}`);
        return 1;
      }
    } else {
      password = dependencies.loginPassword.generate();
    }

    try {
      await dependencies.loginPassword.write(password);
    } catch (error) {
      const status = reportPasswordError(error);
      // The new password may already be active (only root's copy failed): show
      // a generated one rather than lose it.
      if (!chosen && (error as { code?: string }).code === 'PASSWORD_COPY_FAILED') {
        dependencies.output.log(`New login password: ${password}`);
      }
      return status;
    }

    dependencies.output.log(chosen ? 'The login password was changed.' : `New login password: ${password}`);
    dependencies.output.log('Every signed-in device has to sign in again.');
    return 0;
  };

  return {
    async run(argumentsList) {
      const parsedArguments = parseCliArguments(argumentsList);
      if (parsedArguments.options.serverPort) {
        dependencies.environment.SERVER_PORT = parsedArguments.options.serverPort;
      } else if (!dependencies.environment.SERVER_PORT && dependencies.environment.PORT) {
        dependencies.environment.SERVER_PORT = dependencies.environment.PORT;
      }
      if (parsedArguments.options.databasePath) {
        dependencies.environment.DATABASE_PATH = parsedArguments.options.databasePath;
      }

      switch (parsedArguments.command) {
        case 'start':
          await dependencies.startServer();
          return 0;
        case 'status':
        case 'info':
          showStatus(dependencies);
          return 0;
        case 'help':
          showHelp(dependencies);
          return 0;
        case 'version':
          dependencies.output.log(dependencies.packageMetadata.version);
          return 0;
        case 'update':
          explainUpdates();
          return 0;
        case 'password':
          return runPassword(parsedArguments.commandArguments);
        default:
          dependencies.output.error(`\n❌ Unknown command: ${parsedArguments.command}`);
          dependencies.output.log('   Run "claudeweb help" for usage information.\n');
          return 1;
      }
    },
  };
}
