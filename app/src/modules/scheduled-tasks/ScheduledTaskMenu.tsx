import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight } from 'lucide-react';

/** Marks every open panel, so a click inside any of them (or a submenu) does not count as outside. */
const MENU_PANEL_ATTRIBUTE = 'data-scheduled-task-menu';
const VIEWPORT_MARGIN = 8;

type MenuPanelContextValue = {
  /** The single submenu open inside this panel, or null when none is open. */
  activeSubmenuId: string | null;
  setActiveSubmenuId: (id: string | null) => void;
};

const MenuPanelContext = createContext<MenuPanelContextValue | null>(null);

type PanelPosition = { top: number; left: number; maxHeight: number };

/**
 * Where a panel goes next to an anchor rectangle: below it (or beside it for a
 * submenu), flipped to the other side when it would leave the viewport, and
 * never wider or taller than the window.
 */
function placePanel(anchor: DOMRect, panel: { width: number; height: number }, placement: 'below-start' | 'below-end' | 'side'): PanelPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left: number;
  let top: number;
  if (placement === 'side') {
    left = anchor.right + 4;
    if (left + panel.width > viewportWidth - VIEWPORT_MARGIN) left = anchor.left - panel.width - 4;
    top = anchor.top - 6;
  } else {
    left = placement === 'below-end' ? anchor.right - panel.width : anchor.left;
    top = anchor.bottom + 6;
    const roomBelow = viewportHeight - VIEWPORT_MARGIN - top;
    const roomAbove = anchor.top - 6 - VIEWPORT_MARGIN;
    if (panel.height > roomBelow && roomAbove > roomBelow) top = Math.max(VIEWPORT_MARGIN, anchor.top - 6 - panel.height);
  }
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, viewportWidth - panel.width - VIEWPORT_MARGIN));
  top = Math.max(VIEWPORT_MARGIN, Math.min(top, viewportHeight - VIEWPORT_MARGIN - Math.min(panel.height, viewportHeight - 2 * VIEWPORT_MARGIN)));
  return { top, left, maxHeight: viewportHeight - top - VIEWPORT_MARGIN };
}

/** A floating panel rendered on document.body, measured once mounted and then placed beside its anchor. */
function FloatingPanel({ anchor, placement, className, label, children }: {
  anchor: HTMLElement;
  placement: 'below-start' | 'below-end' | 'side';
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Null until the panel has been measured; it renders invisibly for that first frame.
  const [position, setPosition] = useState<PanelPosition | null>(null);
  // Coordinates sibling submenus in this panel so at most one side panel is open at a time.
  const [activeSubmenuId, setActiveSubmenuId] = useState<string | null>(null);
  const panelContext = useMemo(() => ({ activeSubmenuId, setActiveSubmenuId }), [activeSubmenuId]);

  useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      if (!panel) return;
      setPosition(placePanel(anchor.getBoundingClientRect(), { width: panel.offsetWidth, height: panel.scrollHeight }, placement));
    };
    place();
    // A resize (rotating a phone, the on-screen keyboard opening) moves the anchor; follow it rather than closing.
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, placement]);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      {...{ [MENU_PANEL_ATTRIBUTE]: '' }}
      className={`scheduled-task-menu ${className ?? ''}`}
      style={position
        ? { top: position.top, left: position.left, maxHeight: position.maxHeight }
        : { top: 0, left: 0, visibility: 'hidden' }}
    >
      <MenuPanelContext.Provider value={panelContext}>
        {children}
      </MenuPanelContext.Provider>
    </div>,
    document.body,
  );
}

type ScheduledTaskMenuProps = {
  /** What the trigger button shows (an icon, a label with a chevron, ...). */
  trigger: ReactNode;
  /** Accessible name of the trigger, needed when it shows only an icon. */
  ariaLabel?: string;
  title?: string;
  triggerClassName?: string;
  panelClassName?: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end';
  /** Receives `close` so an item can shut the menu after acting. */
  children: (close: () => void) => ReactNode;
};

/**
 * Used by ScheduledTasksPage (filter, sort, new task) and ScheduledTaskEditor
 * (permission, model, trigger). The panel is portaled to document.body with a
 * fixed position so the editor dialog's scroll area cannot clip it, and Escape
 * closes only the menu, not the dialog around it.
 */
export function ScheduledTaskMenu({ trigger, ariaLabel, title, triggerClassName, panelClassName, align = 'start', children }: ScheduledTaskMenuProps) {
  // The trigger the open panel hangs from, or null while closed. Kept as state (not a ref)
  // because rendering the panel needs it.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = anchor !== null;
  const close = useCallback(() => setAnchor(null), []);

  useEffect(() => {
    if (!anchor) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target && anchor.contains(target)) return;
      if (target?.closest?.(`[${MENU_PANEL_ATTRIBUTE}]`)) return;
      setAnchor(null);
    };
    // Window capture runs before the dialog's document-level Escape handler.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setAnchor(null);
      anchor.focus();
    };
    const closeOnScroll = (event: Event) => {
      const target = event.target as Element | null;
      if (target?.closest?.(`[${MENU_PANEL_ATTRIBUTE}]`)) return;
      setAnchor(null);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [anchor]);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open ? 'true' : undefined}
        onClick={(event) => {
          const button = event.currentTarget;
          setAnchor((current) => (current ? null : button));
        }}
      >
        {trigger}
      </button>
      {anchor && (
        <FloatingPanel anchor={anchor} placement={align === 'end' ? 'below-end' : 'below-start'} className={panelClassName} label={ariaLabel}>
          {children(close)}
        </FloatingPanel>
      )}
    </>
  );
}

/** A small grey heading inside a menu, such as "Source" or "Permissions". */
export function ScheduledTaskMenuLabel({ children }: { children: ReactNode }) {
  return <p className="scheduled-task-menu-label">{children}</p>;
}

/** A thin rule between menu groups. */
export function ScheduledTaskMenuDivider() {
  return <div className="scheduled-task-menu-divider" role="separator" />;
}

type ScheduledTaskMenuItemProps = {
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Shows the check mark; leave undefined for an action that is never "selected". */
  selected?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

/** One choice in a ScheduledTaskMenu: optional icon, label, description and a check mark when selected. */
export function ScheduledTaskMenuItem({ label, description, icon, selected, danger, onSelect }: ScheduledTaskMenuItemProps) {
  const panel = useContext(MenuPanelContext);
  return (
    <button
      type="button"
      role={selected === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={selected === undefined ? undefined : selected}
      className={`scheduled-task-menu-item ${danger ? 'danger' : ''}`}
      onMouseEnter={() => {
        if (panel?.activeSubmenuId !== null) panel?.setActiveSubmenuId(null);
      }}
      onClick={onSelect}
    >
      {icon && <span className="scheduled-task-menu-icon">{icon}</span>}
      <span className="scheduled-task-menu-text">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      {selected && <Check size={16} className="scheduled-task-menu-check" aria-hidden="true" />}
    </button>
  );
}

/** A menu row that opens a second panel beside it on hover or click, e.g. "More models". */
export function ScheduledTaskSubmenu({ label, children }: { label: ReactNode; children: ReactNode }) {
  const id = useId();
  const panel = useContext(MenuPanelContext);
  // The row the side panel opens beside, or null while closed; hovering the row or clicking it opens it.
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const open = anchor !== null && (panel ? panel.activeSubmenuId === id : true);
  return (
    <>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`scheduled-task-menu-item ${open ? 'active' : ''}`}
        onMouseEnter={(event) => {
          setAnchor(event.currentTarget);
          panel?.setActiveSubmenuId(id);
        }}
        onClick={(event) => {
          const row = event.currentTarget;
          if (open) {
            setAnchor(null);
            panel?.setActiveSubmenuId(null);
          } else {
            setAnchor(row);
            panel?.setActiveSubmenuId(id);
          }
        }}
      >
        <span className="scheduled-task-menu-text"><span>{label}</span></span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      {open && anchor && (
        <FloatingPanel anchor={anchor} placement="side" className="scheduled-task-submenu">
          {children}
        </FloatingPanel>
      )}
    </>
  );
}
