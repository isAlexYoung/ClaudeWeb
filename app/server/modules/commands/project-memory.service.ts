import path from 'node:path';
import type * as FileSystem from 'node:fs/promises';

/** Used by the /memory command: creates the project's instruction file once and opens existing content unchanged. */
export async function prepareProjectMemory(projectPath: string, fs: typeof FileSystem) {
  const filename = path.join(projectPath, 'CLAUDE.md');
  let created = false;
  try {
    // Exclusive creation also preserves a file created by another tab or Claude between the two requests.
    await fs.writeFile(filename, '# Project instructions\n\n', { flag: 'wx', encoding: 'utf8' });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!(await fs.stat(filename)).isFile()) throw new Error('CLAUDE.md is not a regular file');
  }
  return { path: filename, exists: true, created, message: `Opening CLAUDE.md at ${filename}` };
}
