import { providerRegistry } from '@/modules/providers/provider.registry.js';
import { loadSkillsFromGitHub } from '@/modules/providers/services/skill-url.service.js';
import type {
  ProviderSkill,
  ProviderSkillCreateInput,
  ProviderSkillListOptions,
  ProviderSkillRemoveInput,
} from '@/shared/types.js';

export const providerSkillsService = {
  /** Used by provider routes to import linked skills through the normal validated installer. */
  async importProviderSkills(providerName: string, url: string): Promise<ProviderSkill[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    const input = await loadSkillsFromGitHub(url);
    return provider.skills.addSkills(input);
  },
  /**
   * Lists normalized skills visible to one provider.
   */
  async listProviderSkills(
    providerName: string,
    options?: ProviderSkillListOptions,
  ): Promise<ProviderSkill[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.skills.listSkills(options);
  },

  /**
   * Writes one or more global skills for one provider.
   */
  async addProviderSkills(
    providerName: string,
    input: ProviderSkillCreateInput,
  ): Promise<ProviderSkill[]> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.skills.addSkills(input);
  },

  async removeProviderSkill(
    providerName: string,
    input: ProviderSkillRemoveInput,
  ): Promise<{ removed: boolean; provider: string; directoryName: string }> {
    const provider = providerRegistry.resolveProvider(providerName);
    return provider.skills.removeSkill(input);
  },
};
