import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/shared/api';
import type { ProviderSkill, ProviderSkillCreateEntryPayload, SkillsProject, SkillsProvider, SkillsScope } from '@/shared/types';

type ProviderSkillCreatePayload = {
  entries: ProviderSkillCreateEntryPayload[];
};

type ProviderSkillsResponse = {
  provider: SkillsProvider;
  skills: Array<Partial<ProviderSkill>>;
};

type ApiSuccessResponse<T> = {
  success: true;
  data: T;
};

type ApiErrorResponse = {
  success: false;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

type SkillsCacheEntry = {
  skills: ProviderSkill[];
  updatedAt: number;
};

type ProjectTarget = {
  projectId: string;
  displayName: string;
  path: string;
};

const SKILLS_CACHE_TTL_MS = 5 * 60_000;
const skillsCache = new Map<string, SkillsCacheEntry>();

const SKILL_SCOPE_ORDER: Record<SkillsScope, number> = {
  user: 0,
  plugin: 1,
  repo: 2,
  project: 3,
  admin: 4,
  system: 5,
};

const toResponseJson = async <T>(response: Response): Promise<T> => response.json() as Promise<T>;

const getApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }

  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  const details = record.details;
  if (typeof details === 'string' && details.trim()) {
    return details;
  }

  return fallback;
};

const isSkillsScope = (value: unknown): value is SkillsScope => (
  value === 'user'
  || value === 'project'
  || value === 'plugin'
  || value === 'repo'
  || value === 'admin'
  || value === 'system'
);

const normalizeScope = (value: unknown): SkillsScope => (
  isSkillsScope(value) ? value : 'user'
);

const createProjectTargets = (projects: SkillsProject[]): ProjectTarget[] => {
  const seenPaths = new Set<string>();

  const targets = projects.reduce<ProjectTarget[]>((acc, project) => {
    const projectPath = project.fullPath || project.path || '';
    if (!projectPath || seenPaths.has(projectPath)) {
      return acc;
    }

    seenPaths.add(projectPath);
    acc.push({
      projectId: project.projectId,
      displayName: project.displayName || project.projectId,
      path: projectPath,
    });
    return acc;
  }, []);

  return targets.sort((left, right) => left.path.localeCompare(right.path));
};

const normalizeSkill = (
  provider: SkillsProvider,
  skill: Partial<ProviderSkill>,
  project?: ProjectTarget,
): ProviderSkill => {
  const scope = normalizeScope(skill.scope);
  const shouldAttachProject = scope === 'project' || scope === 'repo';

  return {
    provider,
    name: String(skill.name ?? ''),
    description: String(skill.description ?? ''),
    command: String(skill.command ?? ''),
    scope,
    sourcePath: String(skill.sourcePath ?? ''),
    pluginName: typeof skill.pluginName === 'string' ? skill.pluginName : undefined,
    pluginId: typeof skill.pluginId === 'string' ? skill.pluginId : undefined,
    projectDisplayName: shouldAttachProject
      ? project?.displayName ?? skill.projectDisplayName
      : skill.projectDisplayName,
    projectPath: shouldAttachProject
      ? project?.path ?? skill.projectPath
      : skill.projectPath,
  };
};

const getSkillIdentity = (skill: ProviderSkill): string => (
  [
    skill.provider,
    skill.scope,
    skill.command,
    skill.sourcePath || 'no-source-path',
    skill.projectPath || 'global',
  ].join(':')
);

const sortSkills = (skills: ProviderSkill[]): ProviderSkill[] => (
  [...skills].sort((left, right) => {
    const scopeDelta = SKILL_SCOPE_ORDER[left.scope] - SKILL_SCOPE_ORDER[right.scope];
    if (scopeDelta !== 0) {
      return scopeDelta;
    }

    const projectDelta = (left.projectDisplayName || '').localeCompare(right.projectDisplayName || '');
    if (projectDelta !== 0) {
      return projectDelta;
    }

    return left.command.localeCompare(right.command);
  })
);

const mergeSkills = (
  existingSkills: ProviderSkill[],
  incomingSkills: ProviderSkill[],
): ProviderSkill[] => {
  const skillsById = new Map<string, ProviderSkill>();
  existingSkills.forEach((skill) => {
    skillsById.set(getSkillIdentity(skill), skill);
  });
  incomingSkills.forEach((skill) => {
    skillsById.set(getSkillIdentity(skill), skill);
  });

  return sortSkills([...skillsById.values()]);
};

const fetchProviderSkills = async (
  provider: SkillsProvider,
  project?: ProjectTarget,
): Promise<ProviderSkill[]> => {
  const response = await api.providers.skills(provider, { workspacePath: project?.path });
  const data = await toResponseJson<ApiResponse<ProviderSkillsResponse>>(response);
  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, `Failed to load ${provider} skills`));
  }

  return (data.data.skills || []).map((skill) => normalizeSkill(provider, skill, project));
};

const saveProviderSkills = async (
  provider: SkillsProvider,
  payload: ProviderSkillCreatePayload,
): Promise<ProviderSkill[]> => {
  const response = await api.providers.saveSkills(provider, payload);
  const data = await toResponseJson<ApiResponse<ProviderSkillsResponse>>(response);
  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to save skills'));
  }

  return (data.data.skills || []).map((skill) => normalizeSkill(provider, skill));
};

const getCacheKey = (provider: SkillsProvider, projects: ProjectTarget[]): string => {
  const projectKey = JSON.stringify(projects);
  return `${provider}:${projectKey}`;
};

const clearProviderSkillCache = (provider: SkillsProvider): void => {
  for (const cacheKey of [...skillsCache.keys()]) {
    if (cacheKey.startsWith(`${provider}:`)) {
      skillsCache.delete(cacheKey);
    }
  }
};

type UseProviderSkillsArgs = {
  selectedProvider: SkillsProvider;
  currentProjects: SkillsProject[];
};

export function useProviderSkills({ selectedProvider, currentProjects }: UseProviderSkillsArgs) {
  const [skills, setSkills] = useState<ProviderSkill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  const activeLoadIdRef = useRef(0);
  const lastResult = useRef<{ key: string; skills: ProviderSkill[] } | null>(null);

  const serializedProjectTargets = JSON.stringify(createProjectTargets(currentProjects));
  const projectTargets = useMemo<ProjectTarget[]>(
    () => JSON.parse(serializedProjectTargets) as ProjectTarget[],
    [serializedProjectTargets],
  );
  const cacheKey = useMemo(() => getCacheKey(selectedProvider, projectTargets), [projectTargets, selectedProvider]);

  const refreshSkills = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;

    const cachedEntry = skillsCache.get(cacheKey);
    const canUseCache = !options.force && cachedEntry && Date.now() - cachedEntry.updatedAt < SKILLS_CACHE_TTL_MS;
    if (canUseCache) {
      lastResult.current = { key: cacheKey, skills: cachedEntry.skills };
      setSkills(cachedEntry.skills);
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    const previous = cachedEntry?.skills ?? (lastResult.current?.key === cacheKey ? lastResult.current.skills : undefined);
    if (previous) setSkills(previous);
    else setSkills([]);
    setIsLoading(!previous);
    setLoadError(null);
    const results = await Promise.allSettled([
      fetchProviderSkills(selectedProvider),
      ...projectTargets.map(project => fetchProviderSkills(selectedProvider, project)),
    ]);
    if (activeLoadIdRef.current !== loadId) return;
    let nextSkills: ProviderSkill[] = [];
    let firstError: string | null = null;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') nextSkills = mergeSkills(nextSkills, result.value);
      else {
        firstError ??= result.reason instanceof Error ? result.reason.message : 'Failed to load skills';
        const failedProject = index === 0 ? undefined : projectTargets[index - 1].path;
        nextSkills = mergeSkills(nextSkills, (previous ?? []).filter(skill => skill.projectPath === failedProject));
      }
    });
    const finalSkills = sortSkills(nextSkills);
    lastResult.current = { key: cacheKey, skills: finalSkills };
    if (!firstError) skillsCache.set(cacheKey, { skills: finalSkills, updatedAt: Date.now() });
    setSkills(finalSkills);
    setLoadError(firstError);
    setIsLoading(false);
  }, [cacheKey, projectTargets, selectedProvider]);

  const addSkills = useCallback(async (payload: ProviderSkillCreatePayload) => {
    try {
      const createdSkills = await saveProviderSkills(selectedProvider, payload);
      clearProviderSkillCache(selectedProvider);
      await refreshSkills({ force: true });
      setSaveStatus('success');
      return createdSkills;
    } catch (error) {
      setSaveStatus('error');
      throw error;
    }
  }, [refreshSkills, selectedProvider]);

  const addSkillFromUrl = useCallback(async (url: string) => {
    const response = await api.providers.importSkill(selectedProvider, url);
    const data = await toResponseJson<ApiResponse<ProviderSkillsResponse>>(response);
    if (!response.ok || !data.success) throw new Error(getApiErrorMessage(data, 'Failed to add skill from link'));
    clearProviderSkillCache(selectedProvider);
    await refreshSkills({ force: true });
    setSaveStatus('success');
  }, [refreshSkills, selectedProvider]);

  useEffect(() => {
    void refreshSkills();

    return () => {
      activeLoadIdRef.current += 1;
    };
  }, [refreshSkills]);

  useEffect(() => {
    setSaveStatus(null);
  }, [selectedProvider]);

  useEffect(() => {
    if (saveStatus === null) {
      return;
    }

    const timer = window.setTimeout(() => setSaveStatus(null), 6000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  return {
    skills,
    isLoading,
    loadError,
    saveStatus,
    addSkills,
    addSkillFromUrl,
    refreshSkills,
  };
}
