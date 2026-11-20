import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TurnChanges } from '@/shared/types';
import { layoutFileHunks, splitChangePath } from '@/modules/chat/utils/turnChanges';

type ChangeDiffPanelProps = {
  changes: TurnChanges;
  path: string;
  projectRoot?: string;
  onSelect: (path: string) => void;
};

/**
 * Rendered by the workspace's right panel (Changes view), opened from a
 * change summary card: the turn's files on top, the chosen file's diff below
 * with its own line numbers and unchanged stretches folded.
 */
export default function ChangeDiffPanel({ changes, path, projectRoot, onSelect }: ChangeDiffPanelProps) {
  const { t } = useTranslation('chat');
  const file = changes.files.find((entry) => entry.path === path) ?? changes.files[0];
  const rows = useMemo(() => layoutFileHunks(file?.hunks ?? []), [file]);

  return (
    <div className="workspace-change-panel">
      <div className="workspace-change-panel-summary">
        <span>{t('changes.edited', { count: changes.files.length })}</span>
        <span className="workspace-change-stat"><ins>+{changes.added}</ins> <del>-{changes.removed}</del></span>
      </div>
      <ul className="workspace-change-files">
        {changes.files.map((entry) => {
          const { directory, name } = splitChangePath(entry.path, projectRoot);
          return (
            <li key={entry.path}>
              <button type="button" title={entry.path} aria-current={entry.path === file?.path ? 'true' : undefined} onClick={() => onSelect(entry.path)}>
                <span className="workspace-change-path"><small>{directory}</small>{name}</span>
                <span className="workspace-change-stat"><ins>+{entry.added}</ins> <del>-{entry.removed}</del></span>
              </button>
            </li>
          );
        })}
      </ul>
      {file && (
        <div className="workspace-change-diff" aria-label={file.path}>
          <div className="workspace-change-diff-title">
            {file.path}{file.created && <em>{t('changes.created')}</em>}
          </div>
          <div className="workspace-change-diff-body">
            {rows.map((row, index) => {
              if (row.kind === 'gap') return <div key={index} className="workspace-change-gap">{t('changes.unmodified', { count: row.count })}</div>;
              if (row.kind === 'edit-break') return <div key={index} className="workspace-change-gap">{t('changes.laterEdit')}</div>;
              const number = row.sign === '-' ? row.oldNumber : row.newNumber;
              const tone = row.sign === '+' ? 'added' : row.sign === '-' ? 'removed' : 'context';
              return (
                <div key={index} className={`workspace-change-line ${tone}`}>
                  <span className="workspace-change-number">{number ?? ''}</span>
                  <code>{row.text || ' '}</code>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
