// Must come first: points Excalidraw's fonts at ClaudeWeb before Excalidraw loads.
import '@/modules/artefacts/whiteboard/assetPath';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  WelcomeScreen,
  convertToExcalidrawElements,
  getSceneVersion,
  restoreElements,
} from '@excalidraw/excalidraw';
// The package exports its stylesheet only under the "development" and "production"
// conditions, which Vite uses and oxlint's resolver does not.
// oxlint-disable-next-line importx/no-unresolved
import '@excalidraw/excalidraw/index.css';
import type { BinaryFiles, ExcalidrawImperativeAPI, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import { useTranslation } from 'react-i18next';
import { Shapes } from 'lucide-react';

import { useTheme } from '@/shared/context/ThemeContext';
import type { ArtefactDetail, WhiteboardDocument } from '@/shared/types';
import ArtefactEditorFrame from '@/modules/artefacts/editor/ArtefactEditorFrame';
import { ArtefactDownloadSubmenu } from '@/modules/artefacts/transfer/ArtefactDownloadMenu';
import { useArtefactFileSync } from '@/modules/artefacts/editor/useArtefactFileSync';
import type { ArtefactEditorProps } from '@/modules/artefacts/editor/useArtefactFileSync';
import { prepareScene, toSceneFile, whiteboardLanguage } from '@/modules/artefacts/whiteboard/whiteboardScene';
import type { PreparedScene, SceneConverters } from '@/modules/artefacts/whiteboard/whiteboardScene';

type OnChange = NonNullable<ExcalidrawProps['onChange']>;
type SceneElements = Parameters<OnChange>[0];
type SceneElement = SceneElements[number];

const converters: SceneConverters<SceneElement> = {
  convert: (skeletons, options) => convertToExcalidrawElements(skeletons as never, options) as SceneElement[],
  restore: (elements) => restoreElements(elements as never, null, { refreshDimensions: false, repairBindings: true }) as SceneElement[],
};

/** Changes when what would be saved changes; Excalidraw also reports selection, scrolling and pointer moves. */
function sceneKey(elements: readonly SceneElement[], background: string | undefined, fileCount: number): string {
  return `${getSceneVersion(elements)}|${elements.length}|${background ?? ''}|${fileCount}`;
}

const FIT_OPTIONS = { fitToViewport: true, viewportZoomFactor: 0.85 } as const;

/**
 * Rendered by ArtefactEditor (lazily, with Excalidraw) for a whiteboard. The
 * file is an Excalidraw scene; Claude may add simplified elements that are
 * converted here when the file loads. Claude's edits replace the scene in
 * place, keeping the user's viewport. Everything around the canvas is shared
 * with the other artefact editors.
 */
export default function WhiteboardEditor({
  artefactId,
  menuButton,
  onClose,
  onMinimize,
  onOpenSession,
  embeddedSplit = false,
  chatOpen,
  onToggleChat,
  splitAnimating = false,
  externalRunning = false,
  onSendChatMessage,
  registerFillComposer,
  onSessionResolved,
}: ArtefactEditorProps) {
  const { t, i18n } = useTranslation('sidebar');
  const { isDarkMode } = useTheme();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  // The first scene, handed to Excalidraw when it mounts; later files update it in place.
  const [initialScene, setInitialScene] = useState<PreparedScene<SceneElement> | null>(null);
  // The scene as last loaded or saved, so Excalidraw's own reports of it are not taken for edits.
  const lastKeyRef = useRef<string | null>(null);

  const sync = useArtefactFileSync<WhiteboardDocument>({
    artefactId,
    kind: 'whiteboard',
    onClose,
    onMinimize,
    embeddedSplit,
    chatOpen,
    onToggleChat,
    externalRunning,
    onSendChatMessage,
    registerFillComposer,
    onSessionResolved,
    toText: (scene) => JSON.stringify(scene),
    fromText: (text) => JSON.parse(text) as WhiteboardDocument,
    readContent: (detail: ArtefactDetail) => (
      detail.content && typeof detail.content === 'object' && (detail.content as WhiteboardDocument).type === 'excalidraw'
        ? detail.content as WhiteboardDocument
        : null
    ),
    onLoaded: (scene) => {
      const prepared = prepareScene(scene, converters);
      lastKeyRef.current = sceneKey(prepared.elements, prepared.appState.viewBackgroundColor, Object.keys(prepared.files).length);
      const api = apiRef.current;
      if (!api) {
        setInitialScene(prepared);
        return;
      }
      const wasEmpty = api.getSceneElements().length === 0;
      api.addFiles(Object.values(prepared.files) as never);
      api.updateScene({
        elements: prepared.elements,
        appState: { viewBackgroundColor: prepared.appState.viewBackgroundColor },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      // Claude's first drawing on an empty board is brought into view; later edits keep the viewport.
      if (wasEmpty && prepared.elements.length > 0) api.scrollToContent(undefined, { ...FIT_OPTIONS, animate: true });
    },
  });
  const { markChanged, running } = sync;

  const handleChange = useCallback<OnChange>((elements, appState, files) => {
    const key = sceneKey(elements, appState.viewBackgroundColor, Object.keys(files).length);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    markChanged(toSceneFile(elements as never, appState, files as Record<string, unknown>));
  }, [markChanged]);

  const handleApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
  }, []);

  // The first scene is fitted into view once Excalidraw has measured itself.
  useEffect(() => {
    if (!initialScene || initialScene.elements.length === 0) return undefined;
    const timer = setTimeout(() => apiRef.current?.scrollToContent(undefined, FIT_OPTIONS), 60);
    return () => clearTimeout(timer);
  }, [initialScene]);

  // The split pane animates its width; Excalidraw re-measures once it settles.
  const splitAnimatingRef = useRef(splitAnimating);
  useEffect(() => {
    const wasAnimating = splitAnimatingRef.current;
    splitAnimatingRef.current = splitAnimating;
    if (wasAnimating && !splitAnimating) {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    }
  }, [splitAnimating]);

  /** What the board shows now, as its file; the last loaded file before Excalidraw has mounted. */
  const currentScene = (): WhiteboardDocument | null => {
    const api = apiRef.current;
    if (api) return toSceneFile(api.getSceneElements() as never, api.getAppState(), api.getFiles() as Record<string, unknown>);
    const text = sync.currentText();
    return text ? JSON.parse(text) as WhiteboardDocument : null;
  };

  const uiOptions = useMemo<ExcalidrawProps['UIOptions']>(() => ({
    canvasActions: {
      loadScene: false,
      saveToActiveFile: false,
      export: false,
      toggleTheme: null,
      saveAsImage: true,
      clearCanvas: true,
      changeViewBackgroundColor: true,
    },
    tools: { image: true },
  }), []);

  return (
    <ArtefactEditorFrame
      sync={sync as never}
      icon={Shapes}
      menuButton={menuButton}
      embeddedSplit={embeddedSplit}
      onOpenSession={onOpenSession}
      surfaceClassName="whiteboard-editor-surface"
      titleMenuItems={(closeMenu) => (
        <ArtefactDownloadSubmenu
          kind="whiteboard"
          title={sync.detail?.title ?? ''}
          getContent={currentScene}
          onError={sync.showNotice}
          close={closeMenu}
        />
      )}
    >
      <div className="whiteboard-editor-canvas">
        {initialScene ? (
          <Excalidraw
            excalidrawAPI={handleApi}
            initialData={{ ...initialScene, files: initialScene.files as BinaryFiles, scrollToContent: true }}
            onChange={handleChange}
            viewModeEnabled={running}
            theme={isDarkMode ? 'dark' : 'light'}
            langCode={whiteboardLanguage(i18n.language)}
            name={sync.detail?.title}
            UIOptions={uiOptions}
            aiEnabled={false}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.SearchMenu />
              <MainMenu.DefaultItems.Help />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
            </MainMenu>
            <WelcomeScreen>
              <WelcomeScreen.Hints.MenuHint />
              <WelcomeScreen.Hints.ToolbarHint />
              <WelcomeScreen.Hints.HelpHint />
            </WelcomeScreen>
          </Excalidraw>
        ) : (
          <p role="status" className="artefacts-status">{t('artefacts.loading')}</p>
        )}
      </div>
    </ArtefactEditorFrame>
  );
}
