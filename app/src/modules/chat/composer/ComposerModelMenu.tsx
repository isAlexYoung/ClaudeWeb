import { memo, useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ProviderModelOption } from '@/shared/types';
import { useSurfacePresence } from '@/shared/hooks/useSurfacePresence';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';
import { catalogModelName, resolveModelEffort } from '@/shared/utils';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { ComposerMenuHeading, ComposerMenuItem, ComposerMenuSeparator } from '@/modules/chat/composer/ComposerMenuPrimitives';

type EffortOption = NonNullable<ProviderModelOption['effort']>['values'][number];

type ComposerModelMenuProps = {
  effort: string;
  /** Effort values the active model accepts; empty hides the effort row. */
  effortOptions: EffortOption[];
  onSelectEffort: (effort: string) => void;
  model: string;
  /** Model catalog for the active provider. */
  modelOptions: ProviderModelOption[];
  onSelectModel: (model: string) => void;
  modelsLoading: boolean;
  /** Prevent changes while the CLI login is missing or still being checked. */
  disabled?: boolean;
  fastMode?: boolean;
  onToggleFastMode?: () => void;
};

// The Agent SDK's ultracode setting: xhigh effort plus workflow orchestration.
const ULTRACODE_EFFORT = 'ultracode';
// Width of the model panel alone, and with the effort panel opened beside it.
const MODEL_PANEL_WIDTH = 300;
const MODEL_AND_EFFORT_WIDTH = 608;
// Claude Code's model aliases, shown by family name when several aliases report the same model.
const FAMILY_NAMES: Record<string, string> = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };


/**
 * Rendered by chat's ChatComposer: a model-first menu with the reasoning effort in a
 * second panel and the SDK's Fast mode and Ultracode settings where the model supports them.
 */
function ComposerModelMenu({
  effort,
  effortOptions,
  onSelectEffort,
  model,
  modelOptions,
  onSelectModel,
  modelsLoading,
  disabled = false,
  fastMode,
  onToggleFastMode,
}: ComposerModelMenuProps) {
  const { t } = useTranslation('chat');
  // Each opening starts at the model list; the effort panel is opened on request.
  const [isOpen, setIsOpen] = useState(false);
  // Both panels sit inside one outside-click boundary, so effort is local to this menu.
  const [effortOpen, setEffortOpen] = useState(false);
  // Older versions and custom models stay available in the secondary model list.
  const [moreOpen, setMoreOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  const { triggerRef, menuRef, anchor, updateAnchor, isPresent, presenceProps } = useComposerMenuAnchor(
    isOpen,
    close,
    effortOpen || moreOpen ? MODEL_AND_EFFORT_WIDTH : MODEL_PANEL_WIDTH,
  );

  const morePresence = useSurfacePresence(moreOpen);
  const effortPresence = useSurfacePresence(effortOpen);

  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!isPresent) { setEffortOpen(false); setMoreOpen(false); }
  }, [isPresent]);

  if (!modelOptions.length && !effortOptions.length && !modelsLoading) {
    return null;
  }

  const selected = modelOptions.find((option) => option.value === model);
  const modelLabel = (option: ProviderModelOption) => catalogModelName(option)
    || t(modelsLoading ? 'composer.loadingModels' : 'providerSelection.selectModel');
  const accountDefault = modelOptions.find(option => option.value === 'default');
  const concreteDefault = accountDefault && catalogModelName(accountDefault)
    && modelOptions.find(option => option.value !== 'default' && catalogModelName(option) === catalogModelName(accountDefault));
  // Show a resolved model once; retain the checked alias so opening the menu never changes routing.
  const hiddenDuplicate = concreteDefault ? model === 'default' ? concreteDefault : accountDefault : undefined;
  // Current models use the CLI's account/model context default; don't offer a duplicate 1M alias.
  const models = modelOptions.filter(option => !/\[1m\]/i.test(option.value) && option !== hiddenDuplicate);
  const primary = ['opus', 'sonnet', 'fable', 'haiku'].map(family => models.find(option => option.value === family)
    || models.find(option => option.label.toLowerCase().includes(family))).filter((option): option is ProviderModelOption => Boolean(option));
  // The account's current model leads a new chat's list.
  const defaultOption = models.find(option => option.value === 'default');
  const mainModels = [...new Set([defaultOption, ...(primary.length ? primary : models.slice(0, 4))])]
    .filter((option): option is ProviderModelOption => Boolean(option));
  // Keep routing-family details in the description when a custom endpoint shares one model name.
  const labelCounts = new Map<string, number>();
  for (const option of modelOptions) labelCounts.set(option.label, (labelCounts.get(option.label) ?? 0) + 1);
  const sharedName = (option: ProviderModelOption) => (labelCounts.get(option.label) ?? 0) > 1 ? FAMILY_NAMES[option.value] : undefined;
  const modelDescription = (option: ProviderModelOption) => {
    if (option.value === 'default') {
      // Reuse the concrete model's description instead of repeating the default instruction.
      return concreteDefault ? concreteDefault.description
        : option.description?.split(/\s*[·•]\s*/).slice(1).join(' · ') || undefined;
    }
    return sharedName(option) ? [sharedName(option), option.description].filter(Boolean).join(' · ') : option.description;
  };
  const otherModels = models.filter(option => !mainModels.includes(option));
  const resolvedEffort = resolveModelEffort(selected, effort);
  const levelLabel = (value: string) => t(`workspace.modelMenu.levels.${value}`, { defaultValue: value });
  const effortLabel = resolvedEffort === DEFAULT_EFFORT_VALUE
    ? t(modelsLoading ? 'composer.loadingModels' : 'workspace.modelMenu.effort')
    : resolvedEffort === ULTRACODE_EFFORT
      ? t('workspace.modelMenu.ultracodeTrigger')
      : levelLabel(resolvedEffort);
  const levels = effortOptions.filter((option) => option.value !== ULTRACODE_EFFORT);
  const supportsUltracode = effortOptions.some((option) => option.value === ULTRACODE_EFFORT);
  const label = t('composer.modelMenu', { defaultValue: 'Select model and reasoning effort' });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="workspace-composer-select"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          updateAnchor();
          setIsOpen((value) => !value);
        }}
      >
        <span>{selected ? modelLabel(selected)
          : model === 'default' ? t(modelsLoading ? 'composer.loadingModels' : 'providerSelection.selectModel') : model}</span>
        {effortOptions.length > 0 && <span className="capitalize">{effortLabel}</span>}
        {fastMode && selected?.supportsFastMode && <span>{t('workspace.modelMenu.fastBadge')}</span>}
      </button>

      {isPresent && !disabled && anchor && createPortal(
        <div
          ref={menuRef}
          className="workspace-model-panels motion-surface scrollbar-hide"
          data-stacked={Boolean(anchor && anchor.maxWidth < MODEL_AND_EFFORT_WIDTH)}
          {...presenceProps}
          role="menu"
          aria-label={label}
          style={{ right: anchor.right, bottom: anchor.bottom, maxHeight: anchor.maxHeight, maxWidth: anchor.maxWidth }}
        >
          <div className="workspace-model-panel scrollbar-hide">
            <ComposerMenuHeading>{t('workspace.modelMenu.modelHeading')}</ComposerMenuHeading>
            {modelsLoading && !modelOptions.length && (
              <p className="p-3 text-sm text-muted-foreground">{t('composer.loadingModels', { defaultValue: 'Loading models…' })}</p>
            )}
            {mainModels.map((option) => (
              <ComposerMenuItem
                key={option.value}
                label={modelLabel(option)}
                description={modelDescription(option)}
                isSelected={model === option.value}
                onSelect={() => {
                  onSelectModel(option.value);
                  setIsOpen(false);
                }}
              />
            ))}

            {effortOptions.length > 0 && (
              <>
                <ComposerMenuSeparator />
                <ComposerMenuItem
                  role="menuitem"
                  label={t('workspace.modelMenu.effort')}
                  isSelected={false}
                  trailing={<span className="flex shrink-0 items-center gap-2 whitespace-nowrap capitalize">{effortLabel}<ChevronRight size={15} className="shrink-0" /></span>}
                  onSelect={() => { setMoreOpen(false); setEffortOpen((value) => !value); }}
                />
              </>
            )}

            {otherModels.length > 0 && <><ComposerMenuSeparator /><ComposerMenuItem label={t('workspace.composer.moreModels')} role="menuitem" isSelected={false}
              trailing={<ChevronRight size={15} />} onSelect={() => { setEffortOpen(false); setMoreOpen(value => !value); }} /></>}
            {selected?.supportsFastMode && onToggleFastMode && (
              <>
                <ComposerMenuSeparator />
                <ComposerMenuHeading>{t('workspace.modelMenu.fastModeHeading')}</ComposerMenuHeading>
                <ComposerMenuItem
                  label={t('workspace.modelMenu.fastMode')}
                  description={t('workspace.modelMenu.fastModeDescription')}
                  isSelected={fastMode === true}
                  onSelect={onToggleFastMode}
                />
              </>
            )}
          </div>

          {morePresence.isPresent && !effortOpen && <div {...morePresence.presenceProps} className="workspace-model-panel scrollbar-hide motion-surface motion-submenu" role="menu" aria-label={t('workspace.composer.moreModels')}>
            {otherModels.map(option => <ComposerMenuItem key={option.value} label={modelLabel(option)} description={modelDescription(option)} isSelected={model === option.value}
              onSelect={() => { onSelectModel(option.value); setIsOpen(false); }} />)}
          </div>}
          {effortPresence.isPresent && !moreOpen && (
            <div {...effortPresence.presenceProps} className="workspace-model-panel scrollbar-hide workspace-effort-panel motion-surface motion-submenu" role="menu" aria-label={t('workspace.modelMenu.effort')}>
              <ComposerMenuHeading>{t('workspace.modelMenu.effortHint')}</ComposerMenuHeading>
              {levels.map((option) => (
                <ComposerMenuItem
                  key={option.value}
                  className="capitalize"
                  label={levelLabel(option.value)}
                  description={option.description}
                  isSelected={resolvedEffort === option.value}
                  onSelect={() => {
                    onSelectEffort(option.value);
                    setIsOpen(false);
                  }}
                />
              ))}
              {supportsUltracode && (
                <>
                  <ComposerMenuSeparator />
                  <ComposerMenuItem
                    label={t('workspace.modelMenu.ultracode')}
                    description={t('workspace.modelMenu.ultracodeDescription')}
                    isSelected={effort === ULTRACODE_EFFORT}
                    // Turning Ultracode off keeps the xhigh effort it implied.
                    onSelect={() => onSelectEffort(effort === ULTRACODE_EFFORT ? 'xhigh' : ULTRACODE_EFFORT)}
                  />
                </>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Memoized: the composer re-renders on every keystroke and none of this menu's props change while typing. */
export default memo(ComposerModelMenu);
