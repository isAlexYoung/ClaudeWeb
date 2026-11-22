import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api, readApiJson } from '@/shared/api';
import SettingsRow from '@/modules/settings/SettingsRow';

/** Used by Account's profile section to edit the name Claude uses without changing the interface name. */
export default function ClaudeNameField() {
  const { t } = useTranslation('settings');
  // Save on blur or Enter rather than writing the Claude settings file on every keystroke.
  const [name, setName] = useState('');
  // The last server value distinguishes an unchanged field from an intentional empty name.
  const [savedName, setSavedName] = useState<string | null>(null);
  // Report pending and failed saves beside this field, independently of other account controls.
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    void api.providers.yourClaude()
      .then(response => readApiJson<{ data: { name: string } }>(response))
      .then(({ data }) => {
        if (cancelled) return;
        setName(data.name); setSavedName(data.name); setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('error'); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    if (savedName === null || name.trim() === savedName || status === 'saving') return;
    setStatus('saving');
    try {
      const { data } = await readApiJson<{ data: { name: string } }>(await api.providers.updateYourClaude({ name }));
      setName(data.name); setSavedName(data.name); setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <SettingsRow label={t('yourClaude.nameLabel')}>
      <div className="w-64 max-w-full">
        <input
          aria-label={t('yourClaude.nameLabel')}
          value={name}
          maxLength={60}
          placeholder={t('yourClaude.namePlaceholder')}
          disabled={savedName === null || status === 'saving'}
          onChange={event => { setName(event.target.value); setStatus('ready'); }}
          onBlur={() => void save()}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
          className="w-full rounded-lg border-0 bg-muted/40 px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
        {(status === 'error' || status === 'saving' || status === 'saved') && <p aria-live="polite" className={`mt-1 text-xs ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {status === 'error' ? t(savedName === null ? 'yourClaude.loadFailed' : 'profile.saveFailed') : t(status === 'saving' ? 'yourClaude.saving' : 'yourClaude.saved')}
        </p>}
      </div>
    </SettingsRow>
  );
}
