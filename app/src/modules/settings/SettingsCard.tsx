import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingsCardProps = {
  children: ReactNode;
  className?: string;
};

/** Used by the settings module's account, appearance, tasks, notifications and backup tabs to group rows with subtle separators. */
export default function SettingsCard({ children, className }: SettingsCardProps) {
  return (
    <div
      className={cn(
        'settings-group divide-y divide-border/50',
        className,
      )}
    >
      {children}
    </div>
  );
}
