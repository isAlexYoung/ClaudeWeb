import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  describeUnusablePassword,
  generateLoginPassword,
  readStoredLoginPassword,
  writeLoginPassword,
} from '@/modules/login-password/index.js';
import type { CliApplication, CliPackageMetadata } from '@/shared/types.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { createCliService } from './cli.service.js';

/**
 * Reads one line from stdin. On a terminal the typed characters are not echoed
 * (a password must not stay on screen or in scrollback); piped input is read
 * as it comes.
 */
function readSecretLine(prompt: string): Promise<string> {
  const input = process.stdin;
  return new Promise((resolve, reject) => {
    let text = '';
    if (!input.isTTY) {
      input.setEncoding('utf8');
      const onData = (chunk: string) => {
        text += chunk;
        const end = text.indexOf('\n');
        if (end >= 0) finish(text.slice(0, end));
      };
      const onEnd = () => finish(text);
      const finish = (line: string) => {
        input.off('data', onData);
        input.off('end', onEnd);
        input.pause();
        resolve(line.replace(/\r$/, ''));
      };
      input.on('data', onData);
      input.on('end', onEnd);
      input.once('error', reject);
      return;
    }

    process.stdout.write(prompt);
    input.setRawMode(true);
    input.setEncoding('utf8');
    const onKey = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          input.off('data', onKey);
          input.setRawMode(false);
          input.pause();
          process.stdout.write('\n');
          resolve(text);
          return;
        }
        if (character === '\u0003') {
          input.off('data', onKey);
          input.setRawMode(false);
          input.pause();
          process.stdout.write('\n');
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          text = text.slice(0, -1);
        } else {
          text += character;
        }
      }
    };
    input.on('data', onKey);
    input.resume();
  });
}

/**
 * Creates the production CLI application for the executable entrypoint. This is
 * the CLI module's single composition root: it reads package metadata and wires
 * all concrete Node filesystem, subprocess, environment, clock, and module-start
 * adapters before passing them into otherwise isolated services.
 */
export function createCliApplication(): CliApplication {
  const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
  const packageMetadataJson = JSON.parse(
    fs.readFileSync(path.join(applicationRoot, 'package.json'), 'utf8'),
  ) as { version: string; homepage?: string; bugs?: { url?: string } };
  const packageMetadata: CliPackageMetadata = {
    version: packageMetadataJson.version,
    homepage: packageMetadataJson.homepage,
    bugsUrl: packageMetadataJson.bugs?.url,
  };
  const fileSystem = {
    pathExists: (filePath: string) => fs.existsSync(filePath),
    getFileStats: (filePath: string) => {
      const stats = fs.statSync(filePath);
      return { size: stats.size, modifiedAt: stats.mtime };
    },
  };
  const output = {
    log: (message?: string) => console.log(message),
    error: (message?: string) => console.error(message),
  };
  const homeDirectory = os.homedir();
  return createCliService({
    applicationRoot,
    defaultDatabasePath: path.join(homeDirectory, '.claudeweb', 'auth.db'),
    homeDirectory,
    packageMetadata,
    environment: process.env,
    fileSystem,
    output,
    loginPassword: {
      read: () => readStoredLoginPassword(),
      write: (password) => writeLoginPassword(password),
      generate: generateLoginPassword,
      describeUnusable: describeUnusablePassword,
    },
    readSecretLine,
    startServer: async () => {
      // The server executable is an entrypoint rather than a feature module,
      // so it has no barrel contract to import through.
      // eslint-disable-next-line boundaries/no-unknown
      await import('../../index.js');
    },
  });
}
