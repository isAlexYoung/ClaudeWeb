import { useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DEFAULT_WORKSPACE_DISPLAY_NAME } from '@/shared/constants';
import {
  MAX_DISPLAY_NAME_LENGTH,
  useWorkspaceProfile,
  writeWorkspaceProfile,
} from '@/shared/workspacePreferences';

const ACCEPTED_AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;
/** The account button draws the avatar at 27px; 160px stays sharp on high-density screens. */
const AVATAR_SIZE = 160;

/** Crops the upload to a centred square and shrinks it to a small data URL worth storing. */
async function toAvatarDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas is unavailable');
    }
    const scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (AVATAR_SIZE - width) / 2, (AVATAR_SIZE - height) / 2, width, height);
    const webp = canvas.toDataURL('image/webp', 0.86);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  } finally {
    bitmap.close();
  }
}

/**
 * Rendered at the top of the Account settings tab: the name and photo the
 * bottom-left account button shows. Local to this interface — not the Claude
 * account's profile and not synced with Claude Desktop.
 */
export default function ProfileSection({ children }: { children?: ReactNode }) {
  const { t } = useTranslation('settings');
  const profile = useWorkspaceProfile();
  // Upload errors belong beside the avatar and clear after the next successful upload.
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const shownName = profile.displayName.trim() || DEFAULT_WORKSPACE_DISPLAY_NAME;

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError(t('profile.avatar.invalidType'));
      return;
    }
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setAvatarError(t('profile.avatar.tooLarge'));
      return;
    }
    try {
      writeWorkspaceProfile({ avatar: await toAvatarDataUrl(file) });
      setAvatarError(null);
    } catch {
      setAvatarError(t('profile.avatar.failed'));
    }
  };

  return (
      <div className="settings-group divide-y divide-border/50">
        <div className="flex items-center justify-between gap-4 py-5">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{t('profile.avatar.label')}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{t('profile.avatar.hint')}</div>
            {avatarError && <div role="alert" className="mt-1 text-xs text-destructive">{avatarError}</div>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-3">
            {profile.avatar && (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => writeWorkspaceProfile({ avatar: null })}
              >
                {t('profile.avatar.remove')}
              </button>
            )}
            <button
              type="button"
              aria-label={t('profile.avatar.change')}
              title={t('profile.avatar.change')}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-primary text-lg font-medium text-primary-foreground"
            >
              {profile.avatar
                ? <img src={profile.avatar} alt="" className="h-full w-full object-cover" />
                : (shownName.slice(0, 1).toUpperCase() || '?')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_AVATAR_TYPES.join(',')}
              className="hidden"
              onChange={(event) => void handleAvatarChange(event)}
            />
          </div>
        </div>

        <label className="flex items-center justify-between gap-4 py-5">
          <span className="text-sm font-medium text-foreground">{t('profile.name.label')}</span>
          <input
            type="text"
            value={profile.displayName}
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            placeholder={DEFAULT_WORKSPACE_DISPLAY_NAME}
            onChange={(event) => writeWorkspaceProfile({ displayName: event.target.value })}
            className="w-full max-w-64 rounded-lg border-0 bg-muted/40 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        {children}
      </div>
  );
}
