import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

type PrdEditorFooterProps = {
  content: string;
};

type ContentStats = {
  lines: number;
  characters: number;
  words: number;
};

function getContentStats(content: string): ContentStats {
  return {
    lines: content.split('\n').length,
    characters: content.length,
    words: content.split(/\s+/).filter(Boolean).length,
  };
}

/** Rendered by PrdEditorWorkspace inside the prd-editor module to show PRD line, character and word counts plus the shortcut hint. */
export default function PrdEditorFooter({ content }: PrdEditorFooterProps) {
  const { t } = useTranslation('tasks');
  const stats = useMemo(() => getContentStats(content), [content]);

  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-4 border-t border-border bg-card p-3 text-sm text-muted-foreground">
      <span>{t('prdEditor.stats', stats)} · Markdown</span>
      <span className="hidden sm:inline">{t('prdEditor.shortcuts')}</span>
    </div>
  );
}
