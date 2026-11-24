import os from 'node:os';
import path from 'node:path';

import { McpProvider } from '@/modules/providers/shared/mcp/mcp.provider.js';
import type { McpScope, ProviderMcpServer, UpsertProviderMcpServerInput } from '@/shared/types.js';
import {
  AppError,
  readJsonConfig,
  readObjectRecord,
  readOptionalString,
  readStringArray,
  readStringRecord,
  writeJsonConfig,
} from '@/shared/utils.js';

// Parked definitions never appear in the CLI's active mcpServers map.
function readManagedServers(config: Record<string, unknown>): Record<string, unknown> {
  const active = readObjectRecord(config.mcpServers) ?? {};
  const disabled = readObjectRecord(config.claudewebDisabledMcpServers) ?? {};
  return { ...Object.fromEntries(Object.entries(disabled).map(([name, value]) => [name, { ...(readObjectRecord(value) ?? {}), __claudewebDisabled: true }])), ...active };
}

function writeManagedServers(config: Record<string, unknown>, servers: Record<string, unknown>): void {
  const active: Record<string, unknown> = {};
  const disabled: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(servers)) {
    const { __claudewebDisabled, ...definition } = readObjectRecord(value) ?? {};
    (__claudewebDisabled === true ? disabled : active)[name] = definition;
  }
  config.mcpServers = active;
  config.claudewebDisabledMcpServers = disabled;
}

export class ClaudeMcpProvider extends McpProvider {
  constructor() {
    super('claude', ['user', 'local', 'project'], ['stdio', 'http', 'sse']);
  }

  protected async readScopedServers(scope: McpScope, workspacePath: string): Promise<Record<string, unknown>> {
    if (scope === 'project') {
      const filePath = path.join(workspacePath, '.mcp.json');
      const config = await readJsonConfig(filePath);
      return readManagedServers(config);
    }

    const filePath = path.join(os.homedir(), '.claude.json');
    const config = await readJsonConfig(filePath);
    if (scope === 'user') {
      return readManagedServers(config);
    }

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    return readManagedServers(projectConfig);
  }

  protected async writeScopedServers(
    scope: McpScope,
    workspacePath: string,
    servers: Record<string, unknown>,
  ): Promise<void> {
    if (scope === 'project') {
      const filePath = path.join(workspacePath, '.mcp.json');
      const config = await readJsonConfig(filePath);
      writeManagedServers(config, servers);
      await writeJsonConfig(filePath, config);
      return;
    }

    const filePath = path.join(os.homedir(), '.claude.json');
    const config = await readJsonConfig(filePath);
    if (scope === 'user') {
      writeManagedServers(config, servers);
      await writeJsonConfig(filePath, config);
      return;
    }

    const projects = readObjectRecord(config.projects) ?? {};
    const projectConfig = readObjectRecord(projects[workspacePath]) ?? {};
    writeManagedServers(projectConfig, servers);
    projects[workspacePath] = projectConfig;
    config.projects = projects;
    await writeJsonConfig(filePath, config);
  }

  protected buildServerConfig(input: UpsertProviderMcpServerInput): Record<string, unknown> {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) {
        throw new AppError('command is required for stdio MCP servers.', {
          code: 'MCP_COMMAND_REQUIRED',
          statusCode: 400,
        });
      }

      return {
        type: 'stdio',
        command: input.command,
        args: input.args ?? [],
        env: input.env ?? {},
      };
    }

    if (!input.url?.trim()) {
      throw new AppError('url is required for http/sse MCP servers.', {
        code: 'MCP_URL_REQUIRED',
        statusCode: 400,
      });
    }

    return {
      type: input.transport,
      url: input.url,
      headers: input.headers ?? {},
    };
  }

  protected normalizeServerConfig(
    scope: McpScope,
    name: string,
    rawConfig: unknown,
  ): ProviderMcpServer | null {
    if (!rawConfig || typeof rawConfig !== 'object') {
      return null;
    }

    const config = rawConfig as Record<string, unknown>;
    if (typeof config.command === 'string') {
      return {
        provider: 'claude',
        name,
        scope,
        transport: 'stdio',
        command: config.command,
        ...(config.__claudewebDisabled === true ? { enabled: false } : {}),
        args: readStringArray(config.args),
        env: readStringRecord(config.env),
      };
    }

    if (typeof config.url === 'string') {
      const transport = readOptionalString(config.type) === 'sse' ? 'sse' : 'http';
      return {
        provider: 'claude',
        name,
        scope,
        transport,
        url: config.url,
        ...(config.__claudewebDisabled === true ? { enabled: false } : {}),
        headers: readStringRecord(config.headers),
      };
    }

    return null;
  }
}
