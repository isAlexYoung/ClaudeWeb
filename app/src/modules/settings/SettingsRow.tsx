import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsRowProps = {
  label: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/** Used by the settings module's general, appearance, tasks, notifications and backup tabs to lay out one labelled setting and its control. */
export default function SettingsRow({ label, description, children, className }: SettingsRowProps) {
  return (
    <div className={cn('settings-row flex flex-col items-start justify-between gap-2 py-3 sm:flex-row sm:items-center sm:gap-4', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && (
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="w-full min-w-0 sm:w-auto sm:flex-shrink-0">{children}</div>
    </div>
  );
}
