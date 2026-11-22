import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { api, readApiJson } from '@/shared/api';
import { Button, Input } from '@/shared/ui';

type OutputStyleOption = { name: string; description: string; builtIn: boolean };

type YourClaude = {
  name: string;
  outputStyle: string | null;
  outputStyles: OutputStyleOption[];
  autoMemoryEnabled: boolean | null;
  autoMemoryDirectory: string | null;
  autoDreamEnabled: boolean | null;
  settingsStatus: 'ok' | 'missing' | 'invalid';
  settingsPath: string;
  claudeMdPath: string;
};

type Update = Partial<Pick<YourClaude, 'name' | 'outputStyle' | 'autoMemoryEnabled' | 'autoMemoryDirectory' | 'autoDreamEnabled'>>;
type Field = keyof Update;

const SELECT_CLASS = 'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-48';
const BUILT_IN_STYLE_KEYS = new Set(['Explanatory', 'Learning', 'Proactive']);

/**
 * Rendered by Settings for the "claude" tab (Your Claude): the CLI's output style
 * and memory switches in the user settings.json. Text fields save on their button or Enter;
 * switches save at once.
 */
export default function YourClaudeSettingsTab() {
  const { t } = useTranslation('settings');
  const [current, setCurrent] = useState<YourClaude | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [directory, setDirectory] = useState('');
  const [saving, setSaving] = useState<Field | null>(null);
  const [saved, setSaved] = useState<Field | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((value: YourClaude) => {
    setCurrent(value);
    setDirectory(value.autoMemoryDirectory ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void api.providers.yourClaude()
      .then((response) => readApiJson<{ data: YourClaude }>(response))
      .then((payload) => { if (!cancelled) apply(payload.data); })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [apply]);

  const save = async (field: Field, update: Update) => {
    setSaving(field); setSaved(null); setError(null);
    try {
      const payload = await readApiJson<{ data: YourClaude }>(await api.providers.updateYourClaude(update));
      apply(payload.data);
      setSaved(field);
    } catch (failure) {
      setError(t('yourClaude.saveFailed', { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setSaving(null);
    }
  };

  if (loadFailed) return <p className="text-sm text-destructive">{t('yourClaude.loadFailed')}</p>;
  if (!current) return <p className="text-sm text-muted-foreground">{t('yourClaude.loading')}</p>;

  const settingsLocked = current.settingsStatus === 'invalid';
  const directoryChanged = directory.trim() !== (current.autoMemoryDirectory ?? '');
  const busy = saving !== null;
  const status = (field: Field) => (saving === field ? t('yourClaude.saving') : saved === field ? t('yourClaude.saved') : null);
  // Built-in styles use the UI language; a style file shows its own name and description.
  const styleLabel = (style: OutputStyleOption) => (style.builtIn && BUILT_IN_STYLE_KEYS.has(style.name) ? t(`yourClaude.styles.${style.name}.label`) : style.name);
  const selectedStyle = current.outputStyles.find((style) => style.name === current.outputStyle);
  const styleDescription = current.outputStyle === null
    ? t('yourClaude.styles.default.description')
    : selectedStyle
      ? (selectedStyle.builtIn && BUILT_IN_STYLE_KEYS.has(selectedStyle.name) ? t(`yourClaude.styles.${selectedStyle.name}.description`) : selectedStyle.description)
      : t('yourClaude.styleMissing');

  return (
    <div className="space-y-8" data-testid="your-claude-settings">
      <SettingsSection title={t('yourClaude.responsesTitle')}>
        <SettingsCard>
          <SettingsRow label={t('yourClaude.outputStyleLabel')} description={status('outputStyle') ?? styleDescription}>
            <select
              className={SELECT_CLASS}
              aria-label={t('yourClaude.outputStyleLabel')}
              value={current.outputStyle ?? ''}
              disabled={settingsLocked || busy}
              onChange={(event) => void save('outputStyle', { outputStyle: event.target.value || null })}
            >
              <option value="">{t('yourClaude.styles.default.label')}</option>
              {current.outputStyles.map((style) => <option key={style.name} value={style.name}>{styleLabel(style)}</option>)}
              {current.outputStyle !== null && !selectedStyle && <option value={current.outputStyle}>{current.outputStyle}</option>}
            </select>
          </SettingsRow>
        </SettingsCard>
        <p className="text-xs text-muted-foreground">{t('yourClaude.outputStyleNote')}</p>
      </SettingsSection>

      <SettingsSection title={t('yourClaude.memoryTitle')}>
        {settingsLocked && (
          <p className="text-sm text-destructive">{t('yourClaude.settingsInvalid', { path: current.settingsPath })}</p>
        )}
        <SettingsCard>
          <SettingsRow label={t('yourClaude.autoMemoryLabel')} description={status('autoMemoryEnabled') ?? t('yourClaude.autoMemoryDescription')}>
            <SettingsToggle
              // Unset means on: the CLI only turns auto memory off for an explicit false.
              checked={current.autoMemoryEnabled !== false}
              disabled={settingsLocked || busy}
              onChange={(value) => void save('autoMemoryEnabled', { autoMemoryEnabled: value })}
              ariaLabel={t('yourClaude.autoMemoryLabel')}
            />
          </SettingsRow>
          <div className="space-y-2 px-4 py-4">
            <label htmlFor="settings-your-claude-directory" className="block text-sm font-medium text-foreground">{t('yourClaude.directoryLabel')}</label>
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (directoryChanged) void save('autoMemoryDirectory', { autoMemoryDirectory: directory.trim() || null });
              }}
            >
              <Input
                id="settings-your-claude-directory"
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder={t('yourClaude.directoryPlaceholder')}
                disabled={settingsLocked}
                className="w-full font-mono text-xs"
              />
              <Button type="submit" disabled={settingsLocked || busy || !directoryChanged}>{t('yourClaude.save')}</Button>
            </form>
            <p className="text-xs text-muted-foreground">{status('autoMemoryDirectory') ?? t('yourClaude.directoryDescription')}</p>
          </div>
          <SettingsRow
            label={t('yourClaude.autoDreamLabel')}
            description={status('autoDreamEnabled') ?? `${t('yourClaude.autoDreamDescription')}${current.autoDreamEnabled === null ? ` ${t('yourClaude.autoDreamDefault')}` : ''}`}
          >
            <div className="flex items-center gap-3">
              {current.autoDreamEnabled !== null && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
                  disabled={settingsLocked || busy}
                  onClick={() => void save('autoDreamEnabled', { autoDreamEnabled: null })}
                >
                  {t('yourClaude.useDefault')}
                </button>
              )}
              <SettingsToggle
                checked={current.autoDreamEnabled === true}
                disabled={settingsLocked || busy}
                onChange={(value) => void save('autoDreamEnabled', { autoDreamEnabled: value })}
                ariaLabel={t('yourClaude.autoDreamLabel')}
              />
            </div>
          </SettingsRow>
        </SettingsCard>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <p className="text-xs text-muted-foreground">{t('yourClaude.footnote', { path: current.settingsPath })}</p>
      </SettingsSection>
    </div>
  );
}
