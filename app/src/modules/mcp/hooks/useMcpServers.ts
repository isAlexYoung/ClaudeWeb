import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import { MCP_GLOBAL_SUPPORTED_TRANSPORTS, MCP_PROVIDER_NAMES, MCP_SUPPORTED_SCOPES } from '@/shared/constants';
import type { McpFormState, McpProject, McpProvider, McpScope, McpTransport, ProviderMcpServer, UpsertProviderMcpServerPayload } from '@/shared/types';
import {
  createMcpPayloadFromForm,
  getErrorMessage,
  getProjectPath,
  isMcpScope,
  isMcpTransport,
} from '@/modules/mcp/utils/mcpFormatting';

type GlobalMcpServerResult = {
  provider: McpProvider;
  created: boolean;
  error?: string;
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

type ProviderMcpServerResponse = {
  provider: McpProvider;
  scope: McpScope;
  servers: Array<Partial<ProviderMcpServer>>;
};

type GlobalMcpServerResponse = {
  results: GlobalMcpServerResult[];
};

// Internal MCP-side shape; `name` is now filled from the DB projectId since
// the legacy Project.name field was removed during the projectId migration.
type ProjectTarget = {
  name: string;
  displayName: string;
  path: string;
};

type McpServersCacheEntry = {
  servers: ProviderMcpServer[];
  updatedAt: number;
};

const MCP_CACHE_TTL_MS = 30_000;
const mcpServersCache = new Map<string, McpServersCacheEntry>();

// Settings users often switch between provider tabs repeatedly. A short module
// cache prevents those tab switches from refetching every project config file.

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

const normalizeTransport = (value: unknown, fallback: McpTransport = 'stdio'): McpTransport => (
  isMcpTransport(value) ? value : fallback
);

const normalizeScope = (value: unknown, fallback: McpScope): McpScope => (
  isMcpScope(value) ? value : fallback
);

const normalizeServer = (
  provider: McpProvider,
  scope: McpScope,
  server: Partial<ProviderMcpServer>,
  project?: ProjectTarget,
): ProviderMcpServer => {
  const transport = normalizeTransport(server.transport, server.url ? 'http' : 'stdio');
  return {
    provider,
    name: String(server.name ?? ''),
    scope: normalizeScope(server.scope, scope),
    transport,
    enabled: server.enabled !== false,
    command: server.command,
    args: server.args ?? [],
    env: server.env ?? {},
    cwd: server.cwd,
    url: server.url,
    headers: server.headers ?? {},
    envVars: server.envVars ?? [],
    bearerTokenEnvVar: server.bearerTokenEnvVar,
    envHttpHeaders: server.envHttpHeaders ?? {},
    workspacePath: project?.path || server.workspacePath,
    // Keep the `projectName` key in the MCP wire payload for backwards
    // compatibility. ProjectTarget.name is populated from the DB `projectId`
    // (see createProjectTargets) so this still carries the new identifier.
    projectName: project?.name || server.projectName,
    projectDisplayName: project?.displayName || server.projectDisplayName,
  };
};

const createProjectTargets = (projects: McpProject[]): ProjectTarget[] => {
  const seen = new Set<string>();
  return projects.reduce<ProjectTarget[]>((acc, project) => {
    const projectPath = getProjectPath(project);
    if (!projectPath || seen.has(projectPath)) {
      return acc;
    }

    seen.add(projectPath);
    acc.push({
      // Use projectId as the stable internal identifier.
      name: project.projectId,
      displayName: project.displayName || project.projectId,
      path: projectPath,
    });
    return acc;
  }, []);
};

const fetchProviderScopeServers = async (
  provider: McpProvider,
  scope: McpScope,
  project?: ProjectTarget,
): Promise<ProviderMcpServer[]> => {
  const response = await api.providers.mcpServers(provider, {
    scope,
    workspacePath: project?.path,
  });
  const data = await toResponseJson<ApiResponse<ProviderMcpServerResponse>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, `Failed to load ${provider} MCP servers`));
  }

  return (data.data.servers || []).map((server) => normalizeServer(provider, scope, server, project));
};

const deleteProviderServer = async (
  provider: McpProvider,
  server: ProviderMcpServer,
): Promise<void> => {
  const response = await api.providers.deleteMcpServer(provider, server.name, {
    scope: server.scope,
    workspacePath: server.workspacePath,
  });
  const data = await toResponseJson<ApiResponse<{ removed: boolean }>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to delete MCP server'));
  }
};

const saveProviderServer = async (
  provider: McpProvider,
  payload: UpsertProviderMcpServerPayload,
): Promise<void> => {
  const response = await api.providers.saveMcpServer(provider, payload);
  const data = await toResponseJson<ApiResponse<{ server: ProviderMcpServer }>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to save MCP server'));
  }
};

const saveGlobalServer = async (
  payload: UpsertProviderMcpServerPayload,
): Promise<GlobalMcpServerResult[]> => {
  const response = await api.providers.saveGlobalMcpServer(payload);
  const data = await toResponseJson<ApiResponse<GlobalMcpServerResponse>>(response);

  if (!response.ok || !data.success) {
    throw new Error(getApiErrorMessage(data, 'Failed to save MCP server to all providers'));
  }

  return data.data.results || [];
};

const didServerIdentityChange = (
  editingServer: ProviderMcpServer,
  payload: UpsertProviderMcpServerPayload,
): boolean => (
  editingServer.name !== payload.name
  || editingServer.scope !== payload.scope
  || (editingServer.workspacePath || '') !== (payload.workspacePath || '')
);

const getServerIdentity = (server: ProviderMcpServer): string => (
  `${server.provider}:${server.scope}:${server.workspacePath || 'global'}:${server.name}`
);

const getCacheKey = (provider: McpProvider, projects: ProjectTarget[]): string => {
  const projectKey = projects.map((project) => project.path).sort().join('|');
  return `${provider}:${projectKey}`;
};

const formatGlobalAddFailures = (failures: GlobalMcpServerResult[], t: (key: string) => string): string => (
  failures
    .map((failure) => `${MCP_PROVIDER_NAMES[failure.provider]}: ${failure.error || t('mcpServersAddErrors.unknownError')}`)
    .join('; ')
);

const sortServers = (servers: ProviderMcpServer[]): ProviderMcpServer[] => {
  const scopeOrder: Record<McpScope, number> = {
    user: 0,
    project: 1,
    local: 2,
  };

  return [...servers].sort((left, right) => {
    const scopeDelta = scopeOrder[left.scope] - scopeOrder[right.scope];
    if (scopeDelta !== 0) {
      return scopeDelta;
    }

    const projectDelta = (left.projectDisplayName || '').localeCompare(right.projectDisplayName || '');
    if (projectDelta !== 0) {
      return projectDelta;
    }

    return left.name.localeCompare(right.name);
  });
};

const mergeServers = (
  existingServers: ProviderMcpServer[],
  incomingServers: ProviderMcpServer[],
): ProviderMcpServer[] => {
  const serversById = new Map<string, ProviderMcpServer>();
  existingServers.forEach((server) => {
    serversById.set(getServerIdentity(server), server);
  });
  incomingServers.forEach((server) => {
    serversById.set(getServerIdentity(server), server);
  });

  return sortServers([...serversById.values()]);
};

const replaceScopedServers = (
  existingServers: ProviderMcpServer[],
  incomingServers: ProviderMcpServer[],
  scope: McpScope,
  workspacePath?: string,
): ProviderMcpServer[] => {
  const remainingServers = existingServers.filter((server) => (
    server.scope !== scope || (server.workspacePath || '') !== (workspacePath || '')
  ));

  return mergeServers(remainingServers, incomingServers);
};

type UseMcpServersArgs = {
  selectedProvider: McpProvider;
  currentProjects: McpProject[];
};

/**
 * Which MCP server form is open, if any. One value so the provider-scoped and
 * global forms cannot both be open and an edit target cannot exist without an
 * open form.
 */
type McpServerFormState =
  | { scope: 'provider'; editingServer: ProviderMcpServer | null }
  | { scope: 'global'; editingServer: null }
  | null;

/** Used by MCP and plugins settings to share provider-scoped loading, forms and mutations. */
export function useMcpServers({ selectedProvider, currentProjects }: UseMcpServersArgs) {
  const { t } = useTranslation('settings');
  const [servers, setServers] = useState<ProviderMcpServer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'success' | 'error' | null>(null);
  // One value rather than three: `isFormOpen`, `isGlobalFormOpen` and
  // `editingServer` made eight combinations representable, of which three were
  // legal, and both modals stayed mounted running a full form hook while closed.
  const [serverForm, setServerForm] = useState<McpServerFormState>(null);
  const activeLoadIdRef = useRef(0);

  // Compare project values, not the fresh array produced by each Settings render.
  const serializedTargets = JSON.stringify(createProjectTargets(currentProjects));
  const projectTargets = useMemo<ProjectTarget[]>(() => JSON.parse(serializedTargets), [serializedTargets]);
  const lastResult = useRef<{ key: string; servers: ProviderMcpServer[] } | null>(null);
  const cacheKey = useMemo(() => getCacheKey(selectedProvider, projectTargets), [projectTargets, selectedProvider]);

  const refreshServers = useCallback(async (options: { force?: boolean } = {}) => {
    const loadId = activeLoadIdRef.current + 1;
    activeLoadIdRef.current = loadId;

    const cachedEntry = mcpServersCache.get(cacheKey);
    const canUseCache = !options.force && cachedEntry && Date.now() - cachedEntry.updatedAt < MCP_CACHE_TTL_MS;
    if (canUseCache) {
      lastResult.current = { key: cacheKey, servers: cachedEntry.servers };
      setServers(cachedEntry.servers);
      setIsLoading(false);
      setLoadError(null);
      return;
    }

    const previous = cachedEntry?.servers ?? (lastResult.current?.key === cacheKey ? lastResult.current.servers : undefined);
    if (previous) setServers(previous);
    else setServers([]);
    setIsLoading(!previous);
    setLoadError(null);
    const requests: Array<{ scope: McpScope; project?: ProjectTarget }> = [];
    const supportedScopes = MCP_SUPPORTED_SCOPES[selectedProvider];
    if (supportedScopes.includes('user')) requests.push({ scope: 'user' });
    projectTargets.forEach(project => {
      if (supportedScopes.includes('project')) requests.push({ scope: 'project', project });
      if (supportedScopes.includes('local')) requests.push({ scope: 'local', project });
    });
    // Commit one snapshot after every scope settles; failed scopes retain their last contents.
    const results = await Promise.allSettled(requests.map(({ scope, project }) => fetchProviderScopeServers(selectedProvider, scope, project)));
    if (activeLoadIdRef.current !== loadId) return;
    let nextServers = previous ?? [];
    let firstError: string | null = null;
    results.forEach((result, index) => {
      const { scope, project } = requests[index];
      if (result.status === 'fulfilled') nextServers = replaceScopedServers(nextServers, result.value, scope, project?.path);
      else firstError ??= getErrorMessage(result.reason);
    });
    const finalServers = sortServers(nextServers);
    lastResult.current = { key: cacheKey, servers: finalServers };
    // Failed requests must be retried rather than cached as a successful scan.
    if (!firstError) mcpServersCache.set(cacheKey, { servers: finalServers, updatedAt: Date.now() });
    setServers(finalServers);
    setIsLoading(false);
    setLoadError(firstError);
  }, [cacheKey, projectTargets, selectedProvider]);

  const openForm = useCallback((server?: ProviderMcpServer) => {
    setServerForm({ scope: 'provider', editingServer: server || null });
  }, []);

  const openGlobalForm = useCallback(() => {
    setServerForm({ scope: 'global', editingServer: null });
  }, []);

  const closeForm = useCallback(() => {
    setServerForm(null);
  }, []);

  const submitForm = useCallback(
    async (formData: McpFormState, serverBeingEdited: ProviderMcpServer | null) => {
      const payload = createMcpPayloadFromForm(selectedProvider, formData);
      if (payload.scope !== 'user' && !payload.workspacePath) {
        throw new Error(t('mcpServersAddErrors.selectProjectRequired'));
      }

      await saveProviderServer(selectedProvider, payload);

      if (serverBeingEdited && didServerIdentityChange(serverBeingEdited, payload)) {
        await deleteProviderServer(selectedProvider, serverBeingEdited);
      }

      mcpServersCache.delete(cacheKey);
      await refreshServers({ force: true });
      setSaveStatus('success');
      closeForm();
    },
    [cacheKey, closeForm, refreshServers, selectedProvider, t],
  );

  const submitGlobalForm = useCallback(
    async (formData: McpFormState) => {
      const payload = createMcpPayloadFromForm(selectedProvider, formData, {
        supportedTransports: MCP_GLOBAL_SUPPORTED_TRANSPORTS,
        supportsWorkingDirectory: false,
        includeProviderSpecificFields: false,
        unsupportedTransportMessage: (transport) =>
          t('mcpForm.unsupportedTransport', { transport }),
      });

      if (payload.scope === 'local') {
        throw new Error(t('mcpServersAddErrors.globalScopeUnsupported'));
      }

      if (payload.scope !== 'user' && !payload.workspacePath) {
        throw new Error(t('mcpServersAddErrors.selectProjectRequired'));
      }

      // The global endpoint updates every provider, so clear every provider
      // cache entry instead of only the currently visible provider tab.
      const results = await saveGlobalServer(payload);
      mcpServersCache.clear();
      await refreshServers({ force: true });

      const failures = results.filter((result) => !result.created);
      if (failures.length > 0) {
        setSaveStatus('error');
        throw new Error(t('mcpServersAddErrors.globalAddFailed', { details: formatGlobalAddFailures(failures, t) }));
      }

      setSaveStatus('success');
      closeForm();
    },
    [closeForm, refreshServers, selectedProvider, t],
  );

  const deleteServer = useCallback(
    async (server: ProviderMcpServer, options: { confirm?: boolean } = {}) => {
      if (options.confirm !== false && !window.confirm(t('mcpServersAddErrors.deleteConfirm'))) {
        return;
      }

      setDeleteError(null);
      try {
        await deleteProviderServer(selectedProvider, server);
        mcpServersCache.delete(cacheKey);
        await refreshServers({ force: true });
        setSaveStatus('success');
      } catch (error) {
        setDeleteError(getErrorMessage(error));
        setSaveStatus('error');
        if (options.confirm === false) throw error;
      }
    },
    [cacheKey, refreshServers, selectedProvider, t],
  );

  useEffect(() => {
    void refreshServers();
    return () => { activeLoadIdRef.current += 1; };
  }, [refreshServers]);

  useEffect(() => {
    setServerForm(null);
    setDeleteError(null);
    setSaveStatus(null);
  }, [selectedProvider]);

  useEffect(() => {
    if (saveStatus === null) {
      return;
    }

    const timer = window.setTimeout(() => setSaveStatus(null), 2000);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  return {
    servers,
    /** Persists state before refetching, so grouping changes only after a successful write. */
    toggleServer: async (server: ProviderMcpServer, enabled: boolean) => {
      const response = await api.providers.setMcpEnabled(selectedProvider, server.name, { enabled, scope: server.scope, workspacePath: server.workspacePath });
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(getApiErrorMessage(result, 'Failed to change connector state'));
      mcpServersCache.delete(cacheKey);
      await refreshServers({ force: true });
    },
    isLoading,
    refreshServers,
    loadError,
    deleteError,
    saveStatus,
    serverForm,
    openForm,
    openGlobalForm,
    closeForm,
    submitForm,
    submitGlobalForm,
    deleteServer,
  };
}
