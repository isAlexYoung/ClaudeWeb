import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '@/shared/api';
import type { ComposerTaskMenu, PrdFile } from '@/shared/types';
import { useTaskMaster } from '@/modules/task-master/context/TaskMasterContext';
import { useTasksSettings } from '@/modules/task-master/context/TasksSettingsContext';
import TaskMasterSetupModal from '@/modules/task-master/modals/TaskMasterSetupModal';

type UseComposerTaskMenuArgs = {
  /** Puts a prepared prompt into the composer; the user reviews it and sends it. */
  onInsertPrompt: (prompt: string) => void;
  /** Opens the task board, or null where no board can be shown. */
  onShowBoard?: (() => void) | null;
};

type PrdListResponse = {
  prdFiles?: PrdFile[];
  prds?: PrdFile[];
};

/**
 * Used by the chat module to list TaskMaster actions in the composer's add
 * menu. `menu` is null while tasks are switched off, TaskMaster is missing or
 * no project is open; `setupDialog` must be rendered so "initialise" can open it.
 */
export function useComposerTaskMenu({ onInsertPrompt, onShowBoard = null }: UseComposerTaskMenuArgs): {
  menu: ComposerTaskMenu | null;
  setupDialog: ReactNode;
} {
  const { t } = useTranslation('tasks');
  const { tasksEnabled, isTaskMasterInstalled } = useTasksSettings();
  const { currentProject, projectTaskMaster, tasks, nextTask, setCurrentProject, refreshTasks } = useTaskMaster();
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  // PRDs are only fetched when the menu asks for them. The list is tagged with its project, so a
  // list loaded for another project (or a late reply for one the user has left) reads as "loading".
  const [prdList, setPrdList] = useState<{ projectId: string; names: string[] } | null>(null);
  const projectId = currentProject?.projectId ?? null;
  const prdFiles = prdList && prdList.projectId === projectId ? prdList.names : null;

  const loadPrdFiles = useCallback(async () => {
    if (!projectId) {
      return;
    }
    setPrdList(null);
    let names: string[] = [];
    try {
      const response = await api.taskmaster.prdFiles(projectId);
      if (response.ok) {
        const data = (await response.json()) as PrdListResponse;
        names = (data.prdFiles || data.prds || []).map((file) => file.name);
      }
    } catch (error) {
      console.error('Failed to load PRD files:', error);
    }
    setPrdList({ projectId, names });
  }, [projectId]);

  const hasTaskMaster = Boolean(
    projectTaskMaster?.hasTaskmaster || currentProject?.taskmaster?.hasTaskmaster || tasks.length > 0,
  );

  const menu = useMemo<ComposerTaskMenu | null>(() => {
    if (!tasksEnabled || !isTaskMasterInstalled || !currentProject) {
      return null;
    }
    return {
      isReady: hasTaskMaster,
      nextTask: nextTask ? { id: String(nextTask.id), title: nextTask.title } : null,
      prdFiles,
      onInitialize: () => setIsSetupOpen(true),
      onShowBoard,
      onStartNextTask: () => {
        if (nextTask) {
          onInsertPrompt(t('composerMenu.nextTaskPrompt', { id: nextTask.id, title: nextTask.title }));
        }
      },
      onLoadPrdFiles: () => {
        void loadPrdFiles();
      },
      onGenerateFromPrd: (fileName) => onInsertPrompt(t('composerMenu.parsePrdPrompt', { fileName })),
    };
  }, [currentProject, hasTaskMaster, isTaskMasterInstalled, loadPrdFiles, nextTask, onInsertPrompt, onShowBoard, prdFiles, t, tasksEnabled]);

  const handleSetupClosed = useCallback(() => {
    if (!currentProject) {
      return;
    }
    // Same refresh as the next-task banner: re-read the project's TaskMaster state, then its tasks.
    setCurrentProject(currentProject);
    void refreshTasks();
  }, [currentProject, refreshTasks, setCurrentProject]);

  const setupDialog = (
    <TaskMasterSetupModal
      isOpen={isSetupOpen}
      project={currentProject}
      onClose={() => setIsSetupOpen(false)}
      onAfterClose={handleSetupClosed}
    />
  );

  return { menu, setupDialog };
}
