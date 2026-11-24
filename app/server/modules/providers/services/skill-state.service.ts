import { lstat, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { providerRegistry } from '@/modules/providers/provider.registry.js';
import type { ProviderSkill } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

async function resolveSkill(providerName: string, sourcePath: unknown, workspacePath?: string): Promise<ProviderSkill> {
  if (typeof sourcePath !== 'string' || !sourcePath) throw new AppError('A skill entry is required.', { statusCode: 400 });
  const provider = providerRegistry.resolveProvider(providerName);
  const skills = await provider.skills.listSkills({ workspacePath, includeDisabled: true });
  const skill = skills.find(item => path.resolve(item.sourcePath) === path.resolve(sourcePath));
  if (!skill) throw new AppError('Skill not found.', { code: 'PROVIDER_SKILL_NOT_FOUND', statusCode: 404 });
  return skill;
}

/** Used by provider routes to park or restore only an entry enumerated by that provider's skill catalog. */
export async function setProviderSkillEnabled(providerName: string, sourcePath: unknown, enabled: boolean, workspacePath?: string): Promise<void> {
  const skill = await resolveSkill(providerName, sourcePath, workspacePath);
  if ((skill.enabled !== false) === enabled) return;
  const from = enabled ? `${skill.sourcePath}.disabled` : skill.sourcePath;
  const to = enabled ? skill.sourcePath : `${skill.sourcePath}.disabled`;
  const entry = await lstat(from);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new AppError('Skill entry must be a regular file.', { statusCode: 400 });
  if (await lstat(to).then(() => true, () => false)) throw new AppError('A skill entry already exists at the destination.', { code: 'PROVIDER_SKILL_CONFLICT', statusCode: 409 });
  await rename(from, to);
}

/** Used by extension removal to delete a managed user skill or a catalogued project/plugin entry. */
export async function removeProviderSkillEntry(providerName: string, sourcePath: unknown, workspacePath?: string): Promise<void> {
  const skill = await resolveSkill(providerName, sourcePath, workspacePath);
  if (skill.scope === 'user' && path.basename(skill.sourcePath).toLowerCase() === 'skill.md') {
    const provider = providerRegistry.resolveProvider(providerName);
    await provider.skills.removeSkill({ directoryName: path.basename(path.dirname(skill.sourcePath)) });
  } else {
    await unlink(skill.enabled === false ? `${skill.sourcePath}.disabled` : skill.sourcePath);
  }
}
