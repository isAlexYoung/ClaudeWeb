import { memo, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { PermissionMode } from '@/shared/types';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { ComposerMenuHeading, ComposerMenuItem, ComposerMenuSurface } from '@/modules/chat/composer/ComposerMenuPrimitives';

type ComposerPermissionMenuProps = {
  permissionMode: PermissionMode;
  /** Modes the active provider supports, in the order the backend reports them. */
  permissionModes: PermissionMode[];
  onSelectPermissionMode: (mode: PermissionMode) => void;
  providerLabel: string;
};

// Width of the permission popover; the descriptions wrap inside it.
const PERMISSION_MENU_WIDTH = 320;

/**
 * Rendered by chat's ChatComposer as the neutral permission selector of the approved
 * layout. Which modes exist still comes from the backend capability matrix.
 */
function ComposerPermissionMenu({
  permissionMode,
  permissionModes,
  onSelectPermissionMode,
  providerLabel,
}: ComposerPermissionMenuProps) {
  const { t } = useTranslation('chat');
  // Opens and closes independently of the model menu beside it.
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor, isPresent, presenceProps } = useComposerMenuAnchor(isOpen, close, PERMISSION_MENU_WIDTH);

  if (!permissionModes.length) {
    return null;
  }

  const modeLabel = (mode: PermissionMode) => t(`workspace.permissionModes.${mode}`, { defaultValue: mode });
  const heading = t('workspace.permissionHeading', { provider: providerLabel });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-composer-select"
        // The mode name leads, so a screen reader announces what the button shows.
        aria-label={`${modeLabel(permissionMode)}: ${heading}`}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          updateAnchor();
          setIsOpen((value) => !value);
        }}
      >
        {modeLabel(permissionMode)}
      </button>

      {isPresent && anchor && createPortal(
        <ComposerMenuSurface presenceProps={presenceProps} anchor={anchor} menuRef={menuRef} ariaLabel={heading}>
          <ComposerMenuHeading>{heading}</ComposerMenuHeading>
          {permissionModes.map((mode) => (
            <ComposerMenuItem
              key={mode}
              label={modeLabel(mode)}
              description={t(`codex.descriptions.${mode}`, { defaultValue: '' }) || undefined}
              isSelected={permissionMode === mode}
              onSelect={() => {
                onSelectPermissionMode(mode);
                setIsOpen(false);
              }}
            />
          ))}
          <ComposerMenuHeading>
            {t('composer.permissionCycleHint', { defaultValue: 'Press Tab in the message box to switch modes' })}
          </ComposerMenuHeading>
        </ComposerMenuSurface>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerPermissionMenu);
