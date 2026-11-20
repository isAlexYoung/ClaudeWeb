import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, FileDiff } from 'lucide-react';

import type { TurnChanges } from '@/shared/types';
import { splitChangePath } from '@/modules/chat/utils/turnChanges';

// Files listed before "Show N more files".
const COLLAPSED_FILES = 3;

type ChangeSummaryCardProps = {
  changes: TurnChanges;
  projectRoot?: string;
  /** Opens the Changes panel on a file; rows are plain text without it. */
  onOpenFile?: (changes: TurnChanges, path: string) => void;
};

/** Rendered by ChatMessagesPane after a turn that edited files: what changed, file by file. */
export default function ChangeSummaryCard({ changes, projectRoot, onOpenFile }: ChangeSummaryCardProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const files = expanded ? changes.files : changes.files.slice(0, COLLAPSED_FILES);
  const hidden = changes.files.length - files.length;
  const title = t('changes.edited', { count: changes.files.length });

  return (
    <section className="workspace-change-card" aria-label={title}>
      <header>
        <span className="workspace-change-card-icon"><FileDiff size={17} /></span>
        <div>
          <strong>{title}</strong>
          <span className="workspace-change-stat"><ins>+{changes.added}</ins> <del>-{changes.removed}</del></span>
        </div>
      </header>
      <ul>
        {files.map((file) => {
          const { directory, name } = splitChangePath(file.path, projectRoot);
          const content = <>
            <span className="workspace-change-path"><small>{directory}</small>{name}</span>
            <span className="workspace-change-stat"><ins>+{file.added}</ins> <del>-{file.removed}</del></span>
          </>;
          return (
            <li key={file.path}>
              {onOpenFile
                ? <button type="button" title={file.path} onClick={() => onOpenFile(changes, file.path)}>{content}</button>
                : <div title={file.path}>{content}</div>}
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button type="button" className="workspace-change-more" onClick={() => setExpanded(true)}>
          {t('changes.showMore', { count: hidden })} <ChevronDown size={14} />
        </button>
      )}
      {expanded && changes.files.length > COLLAPSED_FILES && (
        <button type="button" className="workspace-change-more" onClick={() => setExpanded(false)}>{t('changes.showLess')}</button>
      )}
    </section>
  );
}
