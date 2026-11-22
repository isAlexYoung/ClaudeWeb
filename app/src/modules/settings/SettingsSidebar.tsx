import { Fragment } from 'react';
import { ArchiveRestore, Bell, Gauge, Info, MessageCircle, Palette, Plug, User, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import { PillBar, Pill } from '@/shared/ui';
import type { SettingsMainTab } from '@/shared/types';

type SettingsSidebarProps = {
  activeTab: SettingsMainTab;
  onChange: (tab: SettingsMainTab) => void;
};

type NavItem = {
  id: SettingsMainTab;
  labelKey: string;
  icon: typeof User;
  startsGroup?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { id: 'agents', labelKey: 'mainTabs.agents', icon: User },
  { id: 'usage', labelKey: 'mainTabs.usage', icon: Gauge },
  { id: 'appearance', labelKey: 'mainTabs.appearance', icon: Palette, startsGroup: true },
  { id: 'claude', labelKey: 'mainTabs.yourClaude', icon: Sparkles },
  { id: 'notifications', labelKey: 'mainTabs.notifications', icon: Bell },
  { id: 'plugins', labelKey: 'mainTabs.plugins', icon: Plug, startsGroup: true },
  { id: 'tasks', labelKey: 'mainTabs.tasks', icon: MessageCircle },
  { id: 'backup', labelKey: 'mainTabs.backup', icon: ArchiveRestore, startsGroup: true },
  { id: 'about', labelKey: 'mainTabs.about', icon: Info },
];

/** Rendered by Settings to switch between the settings dialog's main sections. */
export default function SettingsSidebar({ activeTab, onChange }: SettingsSidebarProps) {
  const { t } = useTranslation('settings');

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 flex-shrink-0 overflow-y-auto border-r border-border bg-muted/30 md:flex md:flex-col">
        <nav className="flex flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <Fragment key={item.id}>
              {item.startsGroup && <hr className="mx-3 my-2 border-0 border-t border-border/50" />}
              <button
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onChange(item.id)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground active:bg-accent/50',
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {t(item.labelKey)}
              </button>
              </Fragment>
            );
          })}
        </nav>
      </aside>

      {/* Mobile horizontal nav — pill bar */}
      <div className="flex-shrink-0 border-b border-border px-3 py-2 md:hidden">
        <PillBar className="scrollbar-hide w-full overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;

            return (
              <Fragment key={item.id}>
              {item.startsGroup && <span aria-hidden="true" className="mx-1 h-5 shrink-0 border-l border-border/50" />}
              <Pill
                isActive={activeTab === item.id}
                onClick={() => onChange(item.id)}
                className="flex-shrink-0"
              >
                <Icon className="h-3.5 w-3.5" />
                {t(item.labelKey)}
              </Pill>
              </Fragment>
            );
          })}
        </PillBar>
      </div>
    </>
  );
}
