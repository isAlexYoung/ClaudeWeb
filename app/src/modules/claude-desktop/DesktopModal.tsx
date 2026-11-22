import { useEffect, useRef, useState } from 'react';
import { Asterisk, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { GraphicalPanel } from '@/modules/graphical-panel';

/** WorkspaceToolsProvider keeps this fixed window mounted when minimized, so the app stays alive. */
export function DesktopModal({ minimized, onMinimize, onClose }: { minimized: boolean; onMinimize: () => void; onClose: () => void }) {
  const { t } = useTranslation('common');
  const panel = useRef<HTMLDivElement>(null);
  const maximizeButton = useRef<HTMLButtonElement>(null);
  // Retains the expanded layout and follows native Fullscreen API exits, including Escape.
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const changed = () => { if (!document.fullscreenElement) setMaximized(false); };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    if (!minimized) maximizeButton.current?.focus();
  }, [minimized]);

  const leaveFullscreen = async () => {
    if (document.fullscreenElement === panel.current) await document.exitFullscreen().catch(() => {});
    setMaximized(false);
  };
  const maximize = async () => {
    if (maximized) { await leaveFullscreen(); return; }
    setMaximized(true);
    // CSS provides the same viewport-sized fallback on browsers without native fullscreen.
    await panel.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="claude-desktop-backdrop" style={{ display: minimized ? 'none' : undefined }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label="ClaudeDesktop"
        className={`claude-desktop-window${maximized ? ' is-maximized' : ''}`}>
        <div className="claude-desktop-heading">
          <Asterisk size={19} /><h2>ClaudeDesktop</h2>
          <div className="claude-desktop-controls">
            <button ref={maximizeButton} className="workspace-icon-button" type="button" aria-label={t(`workspace.desktop.${maximized ? 'restore' : 'maximize'}`)}
              title={t(`workspace.desktop.${maximized ? 'restore' : 'maximize'}`)} onClick={() => void maximize()}>
              {maximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button className="workspace-icon-button" type="button" aria-label={t('workspace.desktop.minimize')} title={t('workspace.desktop.minimize')}
              onClick={() => { void leaveFullscreen(); onMinimize(); }}><Minus size={18} /></button>
            <button className="workspace-icon-button" type="button" aria-label={t('workspace.desktop.close')} title={t('workspace.desktop.close')}
              onClick={() => { void leaveFullscreen(); onClose(); }}><X size={18} /></button>
          </div>
        </div>
        <GraphicalPanel application="desktop" visible={!minimized} />
      </div>
    </div>
  );
}
