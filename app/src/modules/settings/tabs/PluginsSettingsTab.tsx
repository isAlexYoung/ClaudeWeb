import { useMemo } from 'react';

import { ExtensionsSettingsPage } from '@/modules/plugins';
import type { AgentSettingsProject } from '@/shared/types';

/** Used by Settings to provide registered projects to the unified extension manager. */
export default function PluginsSettingsTab({ projects }: { projects: AgentSettingsProject[] }) {
  const currentProjects = useMemo(() => projects.map(project => ({ projectId: project.name, displayName: project.displayName, fullPath: project.fullPath, path: project.path })), [projects]);
  return <ExtensionsSettingsPage currentProjects={currentProjects} />;
}
