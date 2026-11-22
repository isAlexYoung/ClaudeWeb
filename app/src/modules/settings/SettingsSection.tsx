import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsSectionProps = {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

/** Used by the settings module's account, appearance, tasks, notifications and backup tabs to title a block of settings. */
export default function SettingsSection({ title, description, children, className }: SettingsSectionProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </div>
  );
}
