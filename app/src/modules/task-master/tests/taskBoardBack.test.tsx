import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';

import { i18n } from '@/modules/i18n';
import TaskMasterPanel from '@/modules/task-master/TaskMasterPanel';

vi.mock('@/modules/task-master/context/TaskMasterContext', () => ({ useTaskMaster: () => ({ tasks: [], currentProject: null, refreshTasks: vi.fn(), isLoadingTasks: false, error: null }) }));
vi.mock('@/modules/task-master/hooks/useProjectPrdFiles', () => ({ useProjectPrdFiles: () => ({ prdFiles: [], refreshPrdFiles: vi.fn() }) }));
vi.mock('@/modules/task-master/TaskBoard', () => ({ default: () => <div>Task board</div> }));
vi.mock('@/modules/task-master/modals/TaskDetailModal', () => ({ default: () => null }));
vi.mock('@/modules/prd-editor', () => ({ PRDEditor: () => null }));
beforeAll(async () => { await i18n.changeLanguage('en'); });

it('offers a back action even before a project has any tasks', () => {
  const back = vi.fn();
  render(<TaskMasterPanel isVisible onBack={back} />);
  fireEvent.click(screen.getByRole('button', { name: /back/i }));
  expect(back).toHaveBeenCalledOnce();
  expect(screen.getByText('Task board')).toBeTruthy();
});
