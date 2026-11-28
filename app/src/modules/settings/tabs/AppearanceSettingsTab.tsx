import { useTranslation } from 'react-i18next';

import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useTranscriptAppearance } from '@/shared/hooks/useTranscriptAppearance';
import { writeTranscriptAppearance } from '@/shared/utils';
import type { TranscriptAppearance, CodeEditorSettingsState, ProjectSortOrder } from '@/shared/types';
import ThemeCards from '@/modules/settings/ThemeCards';
import { LanguageSelector } from '@/modules/i18n';
import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsRow from '@/modules/settings/SettingsRow';
import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import {
  CHAT_FONTS,
  UI_FONTS,
  useWorkspaceFonts,
  writeWorkspaceFonts,
} from '@/shared/workspacePreferences';
import type { ChatFont, UiFont } from '@/shared/workspacePreferences';

// Like Claude Code's default transcript view, mapped onto the two transcript preferences.
const TRANSCRIPT_VIEWS = ['normal', 'thinking', 'verbose'] as const;
type TranscriptView = (typeof TRANSCRIPT_VIEWS)[number];

const FONT_SELECT_CLASS = 'w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-48';

// Clawd's switches, in the order they are shown; their text is under appearanceSettings.clawd.<key>.
const CLAWD_TOGGLES = [
  { key: 'onHome', preference: 'clawdOnHome' },
  { key: 'aboveComposer', preference: 'clawdAboveComposer' },
  { key: 'doubleClick', preference: 'clawdDoubleClick' },
  { key: 'festivals', preference: 'clawdFestivals' },
  { key: 'still', preference: 'clawdStill' },
] as const;

type AppearanceSettingsTabProps = {
  projectSortOrder: ProjectSortOrder;
  onProjectSortOrderChange: (value: ProjectSortOrder) => void;
  codeEditorSettings: CodeEditorSettingsState;
  onCodeEditorWordWrapChange: (value: boolean) => void;
  onCodeEditorShowMinimapChange: (value: boolean) => void;
  onCodeEditorLineNumbersChange: (value: boolean) => void;
  onCodeEditorFontSizeChange: (value: string) => void;
};

/** Rendered by Settings for the "appearance" tab, covering theme, language, fonts, project sorting and code editor preferences. */
export default function AppearanceSettingsTab({
  projectSortOrder,
  onProjectSortOrderChange,
  codeEditorSettings,
  onCodeEditorWordWrapChange,
  onCodeEditorShowMinimapChange,
  onCodeEditorLineNumbersChange,
  onCodeEditorFontSizeChange,
}: AppearanceSettingsTabProps) {
  const { t } = useTranslation('settings');
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const fonts = useWorkspaceFonts();
  const reading = useTranscriptAppearance();
  const transcriptView: TranscriptView = !preferences.showThinking ? 'normal' : preferences.showRawParameters ? 'verbose' : 'thinking';
  const setTranscriptView = (view: TranscriptView) => {
    setPreference('showThinking', view !== 'normal');
    setPreference('showRawParameters', view === 'verbose');
  };

  return (
    <div className="space-y-6">
      <SettingsSection title={t('appearanceSettings.theme.label')}>
        <ThemeCards />
      </SettingsSection>

      <SettingsSection title={t('mainTabs.appearance')}>
        <SettingsCard>
          <LanguageSelector />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.fonts.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.fonts.ui.label')}
            description={t('appearanceSettings.fonts.ui.description')}
          >
            <select
              value={fonts.uiFont}
              onChange={(event) => writeWorkspaceFonts({ uiFont: event.target.value as UiFont })}
              className={FONT_SELECT_CLASS}
              aria-label={t('appearanceSettings.fonts.ui.label')}
            >
              {UI_FONTS.map((font) => (
                <option key={font} value={font}>{t(`appearanceSettings.fonts.ui.${font}`)}</option>
              ))}
            </select>
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.fonts.chat.label')}
            description={t('appearanceSettings.fonts.chat.description')}
          >
            <select
              value={fonts.chatFont}
              onChange={(event) => writeWorkspaceFonts({ chatFont: event.target.value as ChatFont })}
              className={FONT_SELECT_CLASS}
              aria-label={t('appearanceSettings.fonts.chat.label')}
            >
              {CHAT_FONTS.map((font) => (
                <option key={font} value={font}>{t(`appearanceSettings.fonts.chat.${font}`)}</option>
              ))}
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.reading.title')}>
        <SettingsCard>
          {([
            ['textSize', ['small', 'medium', 'large']],
            ['sideChatTextSize', ['auto', 'small', 'medium', 'large']],
            ['lineSpacing', ['compact', 'standard', 'relaxed']],
            ['width', ['narrow', 'standard', 'wide']],
          ] as const).map(([key, options]) => (
            <SettingsRow key={key} label={t('appearanceSettings.reading.' + key)}>
              <select className={FONT_SELECT_CLASS} aria-label={t('appearanceSettings.reading.' + key)}
                value={reading[key]} onChange={event => writeTranscriptAppearance({ [key]: event.target.value } as Partial<TranscriptAppearance>)}>
                {options.map(value => <option key={value} value={value}>{t('appearanceSettings.reading.options.' + value)}</option>)}
              </select>
            </SettingsRow>
          ))}
          <SettingsRow label={t('appearanceSettings.transcriptView.label')} description={t(`appearanceSettings.transcriptView.${transcriptView}Description`)}>
            <select className={FONT_SELECT_CLASS} aria-label={t('appearanceSettings.transcriptView.label')}
              value={transcriptView} onChange={event => setTranscriptView(event.target.value as TranscriptView)}>
              {TRANSCRIPT_VIEWS.map(view => <option key={view} value={view}>{t(`appearanceSettings.transcriptView.${view}`)}</option>)}
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.clawd.title')}>
        <SettingsCard>
          {CLAWD_TOGGLES.map(({ key, preference }) => (
            <SettingsRow key={key} label={t(`appearanceSettings.clawd.${key}.label`)} description={t(`appearanceSettings.clawd.${key}.description`)}>
              <SettingsToggle checked={preferences[preference] ?? preference !== 'clawdStill'} onChange={value => setPreference(preference, value)} ariaLabel={t(`appearanceSettings.clawd.${key}.label`)} />
            </SettingsRow>
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.projectSorting.label')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.projectSorting.label')}
            description={t('appearanceSettings.projectSorting.description')}
          >
            <select
              value={projectSortOrder}
              onChange={(event) => onProjectSortOrderChange(event.target.value as ProjectSortOrder)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-36"
            >
              <option value="name">{t('appearanceSettings.projectSorting.alphabetical')}</option>
              <option value="date">{t('appearanceSettings.projectSorting.recentActivity')}</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('appearanceSettings.codeEditor.title')}>
        <SettingsCard>
          <SettingsRow
            label={t('appearanceSettings.codeEditor.wordWrap.label')}
            description={t('appearanceSettings.codeEditor.wordWrap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.wordWrap}
              onChange={onCodeEditorWordWrapChange}
              ariaLabel={t('appearanceSettings.codeEditor.wordWrap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.showMinimap.label')}
            description={t('appearanceSettings.codeEditor.showMinimap.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.showMinimap}
              onChange={onCodeEditorShowMinimapChange}
              ariaLabel={t('appearanceSettings.codeEditor.showMinimap.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.lineNumbers.label')}
            description={t('appearanceSettings.codeEditor.lineNumbers.description')}
          >
            <SettingsToggle
              checked={codeEditorSettings.lineNumbers}
              onChange={onCodeEditorLineNumbersChange}
              ariaLabel={t('appearanceSettings.codeEditor.lineNumbers.label')}
            />
          </SettingsRow>

          <SettingsRow
            label={t('appearanceSettings.codeEditor.fontSize.label')}
            description={t('appearanceSettings.codeEditor.fontSize.description')}
          >
            <select
              value={codeEditorSettings.fontSize}
              onChange={(event) => onCodeEditorFontSizeChange(event.target.value)}
              className="w-full touch-manipulation rounded-lg border border-input bg-card p-2.5 text-sm text-foreground focus:border-primary focus:ring-1 focus:ring-primary sm:w-28"
            >
              <option value="10">10px</option>
              <option value="11">11px</option>
              <option value="12">12px</option>
              <option value="13">13px</option>
              <option value="14">14px</option>
              <option value="15">15px</option>
              <option value="16">16px</option>
              <option value="18">18px</option>
              <option value="20">20px</option>
            </select>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}
