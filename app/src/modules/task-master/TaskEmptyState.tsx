import { FileText, Settings, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import type { PrdFile } from '@/shared/types';

type TaskEmptyStateProps = {
  className?: string;
  hasTaskMasterDirectory: boolean;
  existingPrds: PrdFile[];
  onOpenSetupModal: () => void;
  onCreatePrd: () => void;
  onOpenPrd: (prd: PrdFile) => void;
};

/**
 * Rendered by TaskBoard when the project has no tasks, offering the TaskMaster
 * setup and PRD entry points. Drawn with the workspace theme's own colours
 * (workspace-theme.css: workspace-taskmaster-*), not fixed blues and purples.
 */
export default function TaskEmptyState({
  className = '',
  hasTaskMasterDirectory,
  existingPrds,
  onOpenSetupModal,
  onCreatePrd,
  onOpenPrd,
}: TaskEmptyStateProps) {
  const { t } = useTranslation('tasks');

  if (!hasTaskMasterDirectory) {
    return (
      <div className={cn('workspace-taskmaster-empty', className)}>
        <div className="workspace-taskmaster-card narrow">
          <div className="workspace-taskmaster-head centered">
            <span className="workspace-taskmaster-icon"><Settings size={20} /></span>
            <h2>{t('notConfigured.title')}</h2>
            <p>{t('notConfigured.description')}</p>
          </div>

          <div className="workspace-taskmaster-step">
            <h4>{t('notConfigured.whatIsTitle')}</h4>
            <ul>
              <li>{t('notConfigured.features.aiPowered')}</li>
              <li>{t('notConfigured.features.prdTemplates')}</li>
              <li>{t('notConfigured.features.dependencyTracking')}</li>
              <li>{t('notConfigured.features.progressVisualization')}</li>
              <li>{t('notConfigured.features.cliIntegration')}</li>
            </ul>
          </div>

          <button type="button" onClick={onOpenSetupModal} className="workspace-primary-button workspace-taskmaster-action">
            <Terminal size={16} />
            {t('notConfigured.initializeButton')}
          </button>
        </div>
      </div>
    );
  }

  const steps = [
    ['generateTasks', 2],
    ['analyzeTasks', 3],
    ['startBuilding', 4],
  ] as const;

  return (
    <div className={cn('workspace-taskmaster-empty', className)}>
      <div className="workspace-taskmaster-card">
        <div className="workspace-taskmaster-head">
          <span className="workspace-taskmaster-icon"><FileText size={20} /></span>
          <div>
            <h2>{t('gettingStarted.title')}</h2>
            <p>{t('gettingStarted.subtitle')}</p>
          </div>
        </div>

        <div className="workspace-taskmaster-steps">
          <div className="workspace-taskmaster-step">
            <h4>1. {t('gettingStarted.steps.createPRD.title')}</h4>
            <p>{t('gettingStarted.steps.createPRD.description')}</p>
            <button type="button" onClick={onCreatePrd} className="workspace-taskmaster-chip">
              <FileText size={13} />
              {t('gettingStarted.steps.createPRD.addButton')}
            </button>

            {existingPrds.length > 0 && (
              <div className="workspace-taskmaster-prds">
                <small>{t('gettingStarted.steps.createPRD.existingPRDs')}</small>
                <div>
                  {existingPrds.map((prd) => (
                    <button type="button" key={prd.name} onClick={() => onOpenPrd(prd)} className="workspace-taskmaster-chip">
                      <FileText size={13} />
                      {prd.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {steps.map(([key, number]) => (
            <div className="workspace-taskmaster-step" key={key}>
              <h4>{number}. {t(`gettingStarted.steps.${key}.title`)}</h4>
              <p>{t(`gettingStarted.steps.${key}.description`)}</p>
            </div>
          ))}
        </div>

        <button type="button" onClick={onCreatePrd} className="workspace-primary-button workspace-taskmaster-action">
          <FileText size={16} />
          {t('buttons.addPRD')}
        </button>
      </div>

      <p className="workspace-taskmaster-tip">{t('gettingStarted.tip')}</p>
    </div>
  );
}
