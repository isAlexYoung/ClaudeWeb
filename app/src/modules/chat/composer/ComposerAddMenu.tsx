import { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock, FilePlus, FileText, ListTodo, Play, Plus, SquareKanban, Terminal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ComposerTaskMenu, SlashCommand } from '@/shared/types';
import { useComposerMenuAnchor } from '@/modules/chat/hooks/useComposerMenuAnchor';
import { ScheduleMessageOptions } from '@/modules/chat/composer/ScheduleMessagePopover';
import { useViewMotion } from '@/shared/hooks/useViewMotion';
import { useExitSnapshot } from '@/shared/hooks/useExitSnapshot';

type ComposerAddMenuProps = {
  commands: SlashCommand[];
  onSelectCommand: (command: SlashCommand, index: number, hover: boolean) => void;
  onAttach: () => void;
  onSchedule: (date: Date) => void;
  canSchedule: boolean;
  onClear?: () => void;
  /** TaskMaster actions; the Tasks section is hidden when this is null. */
  tasks?: ComposerTaskMenu | null;
};

/** ChatComposer's single add menu for attachments, scheduled sending, TaskMaster tasks, commands and skills. */
export default function ComposerAddMenu({ commands, onSelectCommand, onAttach, onSchedule, canSchedule, onClear, tasks = null }: ComposerAddMenuProps) {
  const { t } = useTranslation('chat');
  // Sub-panels replace the menu body without creating overlapping portal menus.
  const [panel, setPanel] = useState<'add' | 'schedule' | 'prd' | null>(null);
  const close = useCallback(() => setPanel(null), []);
  const { triggerRef, menuRef, anchor, updateAnchor, isPresent, presenceProps } = useComposerMenuAnchor(panel !== null, close, 620, 'start');
  const displayedPanel = useExitSnapshot(panel, panel !== null);
  const panelRef = useViewMotion(displayedPanel || 'add');
  const choose = (action: () => void) => { close(); action(); };
  const backButton = <button type="button" className="workspace-add-back" onClick={() => setPanel('add')}>{'←'} {t('workspace.composer.add')}</button>;
  const showBoard = tasks?.onShowBoard;
  return <>
    <button ref={triggerRef} type="button" className="workspace-add-trigger" aria-label={t('workspace.composer.add')} aria-haspopup="menu" aria-expanded={panel !== null}
      onClick={() => { updateAnchor(); setPanel(value => value ? null : 'add'); }}><Plus size={21} /></button>
    {isPresent && anchor && createPortal(<div ref={menuRef} {...presenceProps} role="menu" aria-label={t('workspace.composer.add')} className="workspace-add-menu motion-surface"
      onPointerMove={event => { event.currentTarget.dataset.scrollbarVisible = String(event.currentTarget.getBoundingClientRect().right - event.clientX <= 18); }}
      onPointerLeave={event => { delete event.currentTarget.dataset.scrollbarVisible; }}
      style={{ right: anchor.right, bottom: anchor.bottom, maxHeight: anchor.maxHeight, maxWidth: anchor.maxWidth }}>
      <div className="workspace-add-panel" ref={panelRef}>
      {displayedPanel === 'schedule' ? <>{backButton}<ScheduleMessageOptions onSchedule={date => choose(() => onSchedule(date))} /></>
        : displayedPanel === 'prd' && tasks ? <>{backButton}
          <p>{t('workspace.composer.tasksFromPrd')}</p>
          {tasks.prdFiles === null ? <small className="workspace-add-empty">{t('workspace.composer.loadingPrds')}</small>
            : tasks.prdFiles.length ? tasks.prdFiles.map(fileName => <button role="menuitem" type="button" key={fileName}
              onClick={() => choose(() => tasks.onGenerateFromPrd(fileName))}><FileText size={17} /><span>{fileName}</span></button>)
              : <small className="workspace-add-empty">{t('workspace.composer.noPrds')}</small>}
        </> : <>
          <p>{t('workspace.composer.add')}</p>
          <button role="menuitem" type="button" onClick={() => choose(onAttach)}><FilePlus size={18} /><span>{t('input.attachFiles')}</span></button>
          <button role="menuitem" type="button" disabled={!canSchedule} onClick={() => setPanel('schedule')}><Clock size={18} /><span>{t('schedule.trigger')}</span></button>
          {onClear && <button role="menuitem" type="button" onClick={() => choose(onClear)}><X size={18} /><span>{t('input.clearInput')}</span></button>}
          {tasks && <>
            <p>{t('workspace.composer.tasks')}</p>
            {tasks.isReady ? <>
              {showBoard && <button role="menuitem" type="button" onClick={() => choose(showBoard)}><SquareKanban size={18} /><span>{t('workspace.composer.taskBoard')}</span></button>}
              <button role="menuitem" type="button" disabled={!tasks.nextTask} onClick={() => choose(tasks.onStartNextTask)}><Play size={18} />
                <span>{t('workspace.composer.nextTask')}<small>{tasks.nextTask ? `#${tasks.nextTask.id} ${tasks.nextTask.title}` : t('workspace.composer.noNextTask')}</small></span></button>
              <button role="menuitem" type="button" onClick={() => { tasks.onLoadPrdFiles(); setPanel('prd'); }}><FileText size={18} /><span>{t('workspace.composer.tasksFromPrd')}</span></button>
            </> : <button role="menuitem" type="button" onClick={() => choose(tasks.onInitialize)}><ListTodo size={18} />
              <span>{t('workspace.composer.initTaskMaster')}<small>{t('workspace.composer.initTaskMasterHint')}</small></span></button>}
          </>}
          <p>{t('workspace.composer.commands')}</p>
          {commands.length ? commands.map((command, index) => <button role="menuitem" type="button" key={`${command.name}-${command.path || index}`}
            onClick={() => choose(() => onSelectCommand(command, index, false))}><Terminal size={17} /><span>{command.name}<small>{command.description}</small></span></button>)
            : <small className="workspace-add-empty">{t('workspace.composer.noCommands')}</small>}
        </>}
      </div>
    </div>, document.body)}
  </>;
}
