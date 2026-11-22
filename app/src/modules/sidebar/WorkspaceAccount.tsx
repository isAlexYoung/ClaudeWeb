import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronUp, Gauge, Globe, LogOut, Settings as SettingsIcon } from 'lucide-react';

import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { useAuth } from '@/modules/auth';
import { LanguageSelector } from '@/modules/i18n';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import type { SettingsMainTab } from '@/shared/types';
import { useWorkspaceProfile } from '@/shared/workspacePreferences';
import { DEFAULT_WORKSPACE_DISPLAY_NAME } from '@/shared/constants';

type AccountDialog = 'language' | 'logout';

/** Used by IntegratedSidebar for the approved four-action account menu: settings, usage (Settings > Usage), language and sign-out. */
export default function WorkspaceAccount({ onSettings }: { onSettings: (tab?: SettingsMainTab) => void }) {
  const { t } = useTranslation('sidebar');
  const { logout } = useAuth();
  // The name and photo set in Settings > General; a label for this interface only.
  const profile = useWorkspaceProfile();
  // The popover closes before any of its dialogs opens.
  const [open, setOpen] = useState(false);
  // Only one account dialog is open at a time.
  const [dialog, setDialog] = useState<AccountDialog | null>(null);
  const { isPresent, presenceProps } = useSurfacePresence(open);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const name = profile.displayName.trim() || DEFAULT_WORKSPACE_DISPLAY_NAME;
  const openDialog = (next: AccountDialog) => {
    setOpen(false);
    setDialog(next);
  };

  return (
    <div className="workspace-account" ref={root}>
      <button className="workspace-account-trigger" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="workspace-account-avatar">
          {profile.avatar ? <img src={profile.avatar} alt="" /> : name.slice(0, 1).toUpperCase()}
        </span>
        <span>{name}</span>
        <ChevronUp size={13} />
      </button>
      <button className="workspace-icon-button" type="button" aria-label={t('workspace.settings')} onClick={() => onSettings()}>
        <SettingsIcon size={19} />
      </button>
      {isPresent && (
        <div {...presenceProps} className="workspace-account-menu motion-surface" role="menu">
          <small>{name}</small>
          <button role="menuitem" onClick={() => { setOpen(false); onSettings(); }}>
            <SettingsIcon />
            {t('workspace.settings')}
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); onSettings('usage'); }}>
            <Gauge />
            {t('workspace.account.usage')}
          </button>
          <button role="menuitem" onClick={() => openDialog('language')}>
            <Globe />
            {t('workspace.account.language')}
          </button>
          <button role="menuitem" onClick={() => openDialog('logout')}>
            <LogOut />
            {t('workspace.account.logout')}
          </button>
        </div>
      )}
      <Dialog open={dialog !== null} onOpenChange={(value) => { if (!value) setDialog(null); }}>
        <DialogContent className="workspace-account-dialog">
          <DialogTitle>
            {dialog === 'language' && t('workspace.account.language')}
            {dialog === 'logout' && t('workspace.account.logout')}
          </DialogTitle>
          {dialog === 'language' && <LanguageSelector />}
          {dialog === 'logout' && (
            <>
              <p>{t('workspace.account.logoutConfirm')}</p>
              <button className="workspace-primary-button" onClick={logout}>{t('workspace.account.logout')}</button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
