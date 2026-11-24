import { useLayoutEffect, useRef } from 'react';
import { Clock } from 'lucide-react';

import { ScheduledTaskMenu } from '@/modules/scheduled-tasks/ScheduledTaskMenu';

const pad = (value: number) => String(value).padStart(2, '0');
const HOURS = Array.from({ length: 24 }, (_, index) => pad(index));
const MINUTES = Array.from({ length: 60 }, (_, index) => pad(index));

type TimeColumnProps = {
  label: string;
  values: string[];
  selected: string;
  onSelect: (value: string) => void;
};

/** One scrolling column of the picker (hours or minutes), opened on its current value. */
function TimeColumn({ label, values, selected, onSelect }: TimeColumnProps) {
  const columnRef = useRef<HTMLDivElement | null>(null);

  // Centre the chosen value when the panel opens, as the native picker did.
  useLayoutEffect(() => {
    const column = columnRef.current;
    const option = column?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!column || !option) return;
    column.scrollTop = option.offsetTop - column.clientHeight / 2 + option.offsetHeight / 2;
  }, []);

  return (
    <div ref={columnRef} className="scheduled-task-time-column" role="group" aria-label={label}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          role="menuitemradio"
          aria-checked={value === selected}
          className="scheduled-task-time-option"
          onClick={() => onSelect(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

type ScheduledTaskTimePickerProps = {
  /** "HH:mm", 24-hour. */
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  hourLabel: string;
  minuteLabel: string;
};

/**
 * Used by ScheduledTaskEditor in place of the browser's time input, whose
 * pop-up ignores the theme: the same floating panel as the other trigger menus,
 * with an hour column and a minute column. Picking a minute closes it.
 */
export default function ScheduledTaskTimePicker({ value, onChange, ariaLabel, hourLabel, minuteLabel }: ScheduledTaskTimePickerProps) {
  const [hour = '09', minute = '00'] = value.split(':');
  return (
    <ScheduledTaskMenu
      triggerClassName="scheduled-task-chip scheduled-task-time"
      panelClassName="scheduled-task-time-menu"
      ariaLabel={ariaLabel}
      trigger={<><span>{`${hour}:${minute}`}</span><Clock size={15} aria-hidden="true" /></>}
    >
      {(close) => (
        <div className="scheduled-task-time-columns">
          <TimeColumn label={hourLabel} values={HOURS} selected={hour} onSelect={(next) => onChange(`${next}:${minute}`)} />
          <TimeColumn label={minuteLabel} values={MINUTES} selected={minute} onSelect={(next) => { onChange(`${hour}:${next}`); close(); }} />
        </div>
      )}
    </ScheduledTaskMenu>
  );
}
