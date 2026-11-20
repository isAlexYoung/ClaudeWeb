import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import ClaudeSettingsFileRules from '@/modules/settings/tabs/agents-settings/sections/content/ClaudeSettingsFileRules';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { Button, Input } from '@/shared/ui';

const COMMON_CLAUDE_TOOLS = ['Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Write', 'Read', 'Edit', 'Glob', 'Grep', 'MultiEdit', 'Task', 'TodoWrite', 'TodoRead', 'WebFetch', 'WebSearch'];

type PermissionsContentProps = {
  agent: 'claude';
  skipPermissions: boolean;
  onSkipPermissionsChange: (value: boolean) => void;
  allowedTools: string[];
  onAllowedToolsChange: (value: string[]) => void;
  disallowedTools: string[];
  onDisallowedToolsChange: (value: string[]) => void;
};

function ToolRules({ kind, tools, onChange }: { kind: 'allowedTools' | 'blockedTools'; tools: string[]; onChange: (tools: string[]) => void }) {
  const { t } = useTranslation('settings');
  // Keep an unfinished rule local; only a confirmed nonempty rule updates saved permissions.
  const [draft, setDraft] = useState('');
  const add = (rule: string) => {
    const value = rule.trim();
    if (!value || tools.includes(value)) return;
    onChange([...tools, value]);
    setDraft('');
  };
  const title = t(`permissions.${kind}.title`);
  return (
    <div className="space-y-3 px-4 py-4">
      <div><h4 className="text-sm font-medium">{title}</h4><p className="mt-0.5 text-xs text-muted-foreground">{t(`permissions.${kind}.description`)}</p></div>
      <div className="flex gap-2">
        <Input value={draft} onChange={event => setDraft(event.target.value)} aria-label={title}
          placeholder={t(`permissions.${kind}.placeholder`)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(draft); } }} className="h-9 min-w-0 flex-1" />
        <Button onClick={() => add(draft)} disabled={!draft.trim()} size="sm" variant="outline" aria-label={`${t('permissions.actions.add')} · ${title}`} className="h-9 w-9 shrink-0 p-0"><Plus className="h-4 w-4" /></Button>
      </div>
      {kind === 'allowedTools' && <div>
        <p className="mb-2 text-xs text-muted-foreground">{t('permissions.allowedTools.quickAdd')}</p>
        <div className="flex flex-wrap gap-1.5">{COMMON_CLAUDE_TOOLS.map(tool => <Button key={tool} size="sm" variant="outline" disabled={tools.includes(tool)} onClick={() => add(tool)} className="h-7 px-2 text-xs">{tool}</Button>)}</div>
      </div>}
      {tools.length ? <ul className="flex flex-wrap gap-2">{tools.map(tool => <li key={tool} className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/20 py-1 pl-2 pr-1 text-xs">
        <code className="break-all">{tool}</code><button type="button" onClick={() => onChange(tools.filter(value => value !== tool))} aria-label={`${t('common:buttons.delete')} ${tool}`} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"><X className="h-3 w-3" /></button>
      </li>)}</ul> : <p className="text-xs text-muted-foreground">{t(`permissions.${kind}.empty`)}</p>}
    </div>
  );
}

/** Used by General (and the legacy category panel) to edit Claude's saved tool permissions. */
export default function PermissionsContent(props: PermissionsContentProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-8">
      <SettingsSection title={t('tabs.permissions')}>
        <SettingsCard divided>
          <SettingsRow label={t('permissions.skipPermissions.label')} description={t('permissions.skipPermissions.claudeDescription')}>
            <SettingsToggle checked={props.skipPermissions} onChange={props.onSkipPermissionsChange} ariaLabel={t('permissions.skipPermissions.label')} />
          </SettingsRow>
          <ToolRules kind="allowedTools" tools={props.allowedTools} onChange={props.onAllowedToolsChange} />
          <ToolRules kind="blockedTools" tools={props.disallowedTools} onChange={props.onDisallowedToolsChange} />
        </SettingsCard>
        <div className="space-y-1 text-xs leading-relaxed text-muted-foreground">
          <p>{t('permissions.toolExamples.title')}</p>
          <p><code>Bash(git log:*)</code> {t('permissions.toolExamples.bashGitLog')}； <code>Bash(git diff:*)</code> {t('permissions.toolExamples.bashGitDiff')}</p>
          <p><code>Write</code> {t('permissions.toolExamples.write')}； <code>Bash(rm:*)</code> {t('permissions.toolExamples.bashRm')}</p>
        </div>
      </SettingsSection>
      <ClaudeSettingsFileRules />
    </div>
  );
}
