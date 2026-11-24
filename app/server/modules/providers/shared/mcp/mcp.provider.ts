import path from 'node:path';

import type { IProviderMcp } from '@/shared/interfaces.js';
import type { LLMProvider, McpScope, McpTransport, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

const resolveWorkspacePath = (workspacePath?: string): string =>
  path.resolve(workspacePath ?? process.cwd());

const normalizeServerName = (name: string): string => {
  const normalized = name.trim();
  if (!normalized) {
    throw new AppError('MCP server name is required.', {
      code: 'MCP_SERVER_NAME_REQUIRED',
      statusCode: 400,
    });
  }

  return normalized;
};

/**
 * Shared MCP provider for provider-specific config readers/writers.
 */
export abstract class McpProvider implements IProviderMcp {
  // User/local/project edits can share a JSON file; serialize the read-modify-write cycle.
  private configWrites: Promise<void> = Promise.resolve();
  protected readonly provider: LLMProvider;
  protected readonly supportedScopes: McpScope[];
  protected readonly supportedTransports: McpTransport[];

  protected constructor(
    provider: LLMProvider,
    supportedScopes: McpScope[],
    supportedTransports: McpTransport[],
  ) {
    this.provider = provider;
    this.supportedScopes = supportedScopes;
    this.supportedTransports = supportedTransports;
  }

  private changeConfig<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.configWrites.then(operation);
    this.configWrites = next.then(() => {}, () => {});
    return next;
  }

  async listServers(options?: { workspacePath?: string }): Promise<Record<McpScope, ProviderMcpServer[]>> {
    const grouped: Record<McpScope, ProviderMcpServer[]> = {
      user: [],
      local: [],
      project: [],
    };

    for (const scope of this.supportedScopes) {
      grouped[scope] = await this.listServersForScope(scope, options);
    }

    return grouped;
  }

  async listServersForScope(
    scope: McpScope,
    options?: { workspacePath?: string },
  ): Promise<ProviderMcpServer[]> {
    if (!this.supportedScopes.includes(scope)) {
      return [];
    }

    const workspacePath = resolveWorkspacePath(options?.workspacePath);
    const scopedServers = await this.readScopedServers(scope, workspacePath);
    return Object.entries(scopedServers)
      .map(([name, rawConfig]) => this.normalizeServerConfig(scope, name, rawConfig))
      .filter((entry): entry is ProviderMcpServer => entry !== null);
  }

  async upsertServer(input: UpsertProviderMcpServerInput): Promise<ProviderMcpServer> {
    return this.changeConfig(async () => {
      const scope = input.scope ?? 'project';
      this.assertScopeAndTransport(scope, input.transport);

      const workspacePath = resolveWorkspacePath(input.workspacePath);
      const normalizedName = normalizeServerName(input.name);
      const scopedServers = await this.readScopedServers(scope, workspacePath);
      const wasDisabled = (scopedServers[normalizedName] as Record<string, unknown> | undefined)?.__claudewebDisabled === true;
      scopedServers[normalizedName] = { ...this.buildServerConfig(input), ...(wasDisabled ? { __claudewebDisabled: true } : {}) };
      await this.writeScopedServers(scope, workspacePath, scopedServers);

      return {
        provider: this.provider,
        name: normalizedName,
        scope,
        transport: input.transport,
        ...(wasDisabled ? { enabled: false } : {}),
        command: input.command,
        args: input.args,
        env: input.env,
        cwd: input.cwd,
        url: input.url,
        headers: input.headers,
        envVars: input.envVars,
        bearerTokenEnvVar: input.bearerTokenEnvVar,
        envHttpHeaders: input.envHttpHeaders,
      };
    });
  }

  /** Used by provider extension management to preserve a connector while removing it from runtime config. */
  async setServerEnabled(input: { name: string; scope?: McpScope; workspacePath?: string; enabled: boolean }): Promise<void> {
    return this.changeConfig(async () => {
      const scope = input.scope ?? 'user';
      this.assertScope(scope);
      const workspacePath = resolveWorkspacePath(input.workspacePath);
      const name = normalizeServerName(input.name);
      const servers = await this.readScopedServers(scope, workspacePath);
      const config = servers[name];
      if (!config || typeof config !== 'object') throw new AppError('MCP server not found.', { code: 'MCP_NOT_FOUND', statusCode: 404 });
      servers[name] = { ...config, __claudewebDisabled: !input.enabled };
      await this.writeScopedServers(scope, workspacePath, servers);
    });
  }

  async removeServer(
    input: { name: string; scope?: McpScope; workspacePath?: string },
  ): Promise<{ removed: boolean; provider: LLMProvider; name: string; scope: McpScope }> {
    return this.changeConfig(async () => {
      const scope = input.scope ?? 'project';
      this.assertScope(scope);

      const workspacePath = resolveWorkspacePath(input.workspacePath);
      const normalizedName = normalizeServerName(input.name);
      const scopedServers = await this.readScopedServers(scope, workspacePath);
      const removed = Object.prototype.hasOwnProperty.call(scopedServers, normalizedName);
      if (removed) {
        delete scopedServers[normalizedName];
        await this.writeScopedServers(scope, workspacePath, scopedServers);
      }

      return { removed, provider: this.provider, name: normalizedName, scope };
    });
  }

  protected abstract readScopedServers(
    scope: McpScope,
    workspacePath: string,
  ): Promise<Record<string, unknown>>;

  protected abstract writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void>;

  protected abstract buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown>;

  protected abstract normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null;

  protected assertScope(scope: McpScope): void {
    if (!this.supportedScopes.includes(scope)) {
      throw new AppError(`Provider "${this.provider}" does not support "${scope}" MCP scope.`, {
        code: 'MCP_SCOPE_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
  }

  protected assertScopeAndTransport(scope: McpScope, transport: McpTransport): void {
    this.assertScope(scope);
    if (!this.supportedTransports.includes(transport)) {
      throw new AppError(`Provider "${this.provider}" does not support "${transport}" MCP transport.`, {
        code: 'MCP_TRANSPORT_NOT_SUPPORTED',
        statusCode: 400,
      });
    }
  }
}
