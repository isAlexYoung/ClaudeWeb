import { lazy, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { ArtefactDetail, ArtefactKind } from '@/shared/types';
import type { ArtefactEditorProps } from '@/modules/artefacts/editor/useArtefactFileSync';
import { getCachedArtefact, readArtefactResponse } from '@/modules/artefacts/useArtefacts';

// Each editor is loaded on demand, so FortuneSheet, Tiptap and Excalidraw only
// download when an artefact of their kind opens.
const SpreadsheetEditor = lazy(() => import('@/modules/artefacts/sheet/SpreadsheetEditor'));
const DocumentEditor = lazy(() => import('@/modules/artefacts/doc/DocumentEditor'));
const WhiteboardEditor = lazy(() => import('@/modules/artefacts/whiteboard/WhiteboardEditor'));

type ArtefactEditorDispatchProps = ArtefactEditorProps & {
  /** The artefact's kind when the caller already knows it. */
  kind?: ArtefactKind | null;
};

/**
 * Rendered by WorkspaceMain in the split view's left pane: the editor for the
 * open artefact's kind. The kind comes from the caller or the cached list;
 * an artefact opened before the list has loaded is looked up once.
 */
export default function ArtefactEditor({ kind: knownKind, ...props }: ArtefactEditorDispatchProps) {
  const { t } = useTranslation('sidebar');
  const cachedKind = knownKind ?? getCachedArtefact(props.artefactId)?.kind ?? null;
  // The kind read from the server when neither the caller nor the cache knew it.
  const [fetched, setFetched] = useState<{ id: string; kind: ArtefactKind | null; error: string | null } | null>(null);

  useEffect(() => {
    if (cachedKind) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const detail = await readArtefactResponse<ArtefactDetail>(await api.artefacts.open(props.artefactId));
        if (!cancelled) setFetched({ id: props.artefactId, kind: detail.kind, error: null });
      } catch (caught) {
        if (!cancelled) setFetched({ id: props.artefactId, kind: null, error: caught instanceof Error ? caught.message : String(caught) });
      }
    })();
    return () => { cancelled = true; };
  }, [cachedKind, props.artefactId]);

  const kind = cachedKind ?? (fetched?.id === props.artefactId ? fetched.kind : null);
  if (kind === 'doc') return <DocumentEditor {...props} />;
  if (kind === 'whiteboard') return <WhiteboardEditor {...props} />;
  if (kind === 'sheet') return <SpreadsheetEditor {...props} />;
  if (fetched?.id === props.artefactId && fetched.error) {
    return <p role="alert" className="artefacts-status">{t('artefacts.editor.loadFailed', { error: fetched.error })}</p>;
  }
  if (kind) {
    return <p role="alert" className="artefacts-status">{t('artefacts.comingSoon', { name: t(`artefacts.kinds.${kind}`) })}</p>;
  }
  return <p role="status" className="artefacts-status">{t('artefacts.loading')}</p>;
}
