import { ArrowUpRight, FileText, Image, FileArchive } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usePaletteOps } from '@/modules/command-palette';
import { WorkspaceVisualPreview } from '@/modules/interactive-preview';
import { useMarkdownWorkspace } from '@/modules/chat/context/MarkdownWorkspaceContext';
import { useIsExportingTranscript } from '@/modules/chat/context/TranscriptRenderContext';

/** Chat's compact file card opens the authenticated workspace preview. */
export default function GeneratedFileCard({ path, label }: { path: string; label?: string }) {
  const { t } = useTranslation('chat');
  const { openFileInEditor, insertComposerText } = usePaletteOps();
  const workspace = useMarkdownWorkspace();
  const exporting = useIsExportingTranscript();
  const name = path.split(/[\\/]/).pop() || path;
  const extension = name.split('.').pop()?.toUpperCase();
  const Icon = /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(path) ? Image : /\.zip$/i.test(path) ? FileArchive : FileText;
  return (
    <><a href={path} onClick={event => { event.preventDefault(); openFileInEditor(path, null); }} title={path}
      className="not-prose my-3 flex w-full max-w-md items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon size={23} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{label || name}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{extension} · {t('generatedFiles.preview')}</span></span>
      <ArrowUpRight size={17} className="shrink-0 text-muted-foreground" />
    </a>
      {!exporting && workspace.active !== false && workspace.projectId && /\.(html?|svg)$/i.test(path) && <WorkspaceVisualPreview projectId={workspace.projectId} path={path} revision={workspace.fileRevision} onFollowUp={insertComposerText} />}
    </>
  );
}
