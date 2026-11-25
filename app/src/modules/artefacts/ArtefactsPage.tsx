import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Folder, LayoutGrid, List, ListFilter, MessageCircle, MoreHorizontal, Pin, Plus, Search, Upload, X } from 'lucide-react';

import {
  ScheduledTaskMenu,
  ScheduledTaskMenuDivider,
  ScheduledTaskMenuItem,
  ScheduledTaskSubmenu,
} from '@/modules/scheduled-tasks';
import { useNow } from '@/shared/hooks/useNow';
import { formatRelativeTime } from '@/shared/timeFormat';
import type { ArtefactKind, ArtefactSummary } from '@/shared/types';
import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { ARTEFACT_KINDS, CREATABLE_KINDS, artefactKind, isEditableKind } from '@/modules/artefacts/artefactKinds';
import { useArtefacts } from '@/modules/artefacts/useArtefacts';
import { ArtefactImportError, IMPORT_ACCEPT, readImportFile } from '@/modules/artefacts/transfer/artefactTransfer';

type ArtefactsPageProps = {
  /** The mobile menu button, shown before the title on small screens. */
  menuButton?: ReactNode;
  /** Opens one artefact's editor. */
  onOpenArtefact: (id: string) => void;
  /** Called right after creating an artefact (so the sidebar can show its new conversation). */
  onArtefactCreated?: (artefact: ArtefactSummary) => void;
  /** Opens the conversation an artefact is edited in. */
  onOpenSession: (sessionId: string) => void;
  /** "New → Chat": starts a new conversation. */
  onNewChat: () => void;
};

type SortKey = 'opened' | 'created' | 'name';
type OpenedWithin = 'any' | 'today' | 'week' | 'month';
type ViewMode = 'grid' | 'list';

const VIEW_STORAGE_KEY = 'claudeweb:artefacts-view';
const DAY = 24 * 60 * 60 * 1000;
const NOTICE_MS = 2600;

function readStoredView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

function storeView(view: ViewMode) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // A private window keeps the choice for this page only.
  }
}

function openedSince(within: OpenedWithin, now: number): number {
  if (within === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  if (within === 'week') return now - 7 * DAY;
  if (within === 'month') return now - 30 * DAY;
  return 0;
}

/** The faint hand-drawn texture on the create tiles. */
function TileTexture() {
  return (
    <svg className="artefacts-tile-texture" viewBox="0 0 150 104" preserveAspectRatio="none" aria-hidden="true">
      <path d="M8 70c18-30 30 22 46-6s26-40 44-10 22 30 44-2" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M14 24c20 6 36-10 58 0s40 8 64-4" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <rect x="96" y="58" width="40" height="30" rx="4" fill="none" stroke="currentColor" strokeWidth="4" />
    </svg>
  );
}

/** The empty state's line drawing: a triangle, a circle and a box. */
function EmptyIllustration() {
  return (
    <svg className="artefacts-empty-art" width="104" height="96" viewBox="0 0 104 96" fill="none" aria-hidden="true">
      <path d="M26 6 4 92h44L26 6Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" />
      <circle cx="74" cy="40" r="21" className="artefacts-empty-fill" stroke="currentColor" strokeWidth="2.4" />
      <rect x="50" y="58" width="48" height="34" className="artefacts-empty-fill" stroke="currentColor" strokeWidth="2.4" />
    </svg>
  );
}

/** A whiteboard's preview: a few hand-drawn boxes joined by arrows. */
function WhiteboardSketch() {
  return (
    <svg className="artefact-card-board" viewBox="0 0 160 92" fill="none" aria-hidden="true">
      <path d="M8 14.5c11-1 23-.6 34 .4.8 7 .6 14-.3 21-11 .8-22 .6-33-.3-.9-7-.9-14-.7-21.1Z" fill="var(--kind-soft)" stroke="var(--kind-fg)" strokeWidth="1.8" strokeLinejoin="round" />
      <ellipse cx="92" cy="25" rx="21" ry="13" fill="var(--kind-bg)" stroke="var(--kind-fg)" strokeWidth="1.8" />
      <path d="M118 58.5c10-.8 21-.5 32 .3.6 7 .4 14-.4 20-10.6.7-21 .5-31.4-.4-.6-6.6-.7-13.3-.2-19.9Z" fill="var(--kind-soft)" stroke="var(--kind-fg)" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M43 25.5c8-.4 16-.3 25-.2M64 21.5l5 3.8-5 4.1" stroke="var(--kind-fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M108 35c6 6 10 13 15 21M117.5 54l5.8 2.4.4-6.2" stroke="var(--kind-fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 64c9-4 16 5 24 0s14-5 22 1" stroke="var(--kind-fg)" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
    </svg>
  );
}

/** A spreadsheet, document or whiteboard sketched as the card's preview. */
function ArtefactPreview({ artefact }: { artefact: ArtefactSummary }) {
  if (artefact.kind === 'whiteboard') {
    return (
      <div className="artefact-card-preview" aria-hidden="true">
        <div className="artefact-card-paper artefact-card-paper-back" />
        <div className="artefact-card-paper artefact-card-paper-board"><WhiteboardSketch /></div>
      </div>
    );
  }
  const isSheet = artefact.kind === 'sheet';
  return (
    <div className="artefact-card-preview" aria-hidden="true">
      <div className="artefact-card-paper artefact-card-paper-back" />
      <div className="artefact-card-paper">
        {isSheet ? (
          <>
            <span className="artefact-card-paper-title">{artefact.title}</span>
            <div className="artefact-card-grid">
              {Array.from({ length: 16 }, (_, index) => <i key={index} />)}
            </div>
          </>
        ) : artefact.kind === 'doc' ? (
          <>
            <span className="artefact-card-paper-title">{artefact.title}</span>
            <div className="artefact-card-lines"><i /><i /><i /><i /><b /></div>
          </>
        ) : (
          <div className="artefact-card-lines"><i /><i /><i /><i /><i /><b /></div>
        )}
      </div>
    </div>
  );
}

/**
 * Rendered by WorkspaceMain when the sidebar's Artefacts entry is open. Lists
 * the user's artefacts with search, filters, a grid/list view and the New
 * menu; spreadsheets, documents and whiteboards can be created and opened so
 * far, the other kinds show their picture and say they are coming.
 */
export default function ArtefactsPage({ menuButton, onOpenArtefact, onArtefactCreated, onOpenSession, onNewChat }: ArtefactsPageProps) {
  const { t, i18n } = useTranslation('sidebar');
  const now = useNow();
  const { artefacts, error, createArtefact, update, remove } = useArtefacts();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [sort, setSort] = useState<SortKey>('opened');
  // Kinds ticked in the Type filter; empty means every kind.
  const [kinds, setKinds] = useState<Set<ArtefactKind>>(() => new Set());
  const [openedWithin, setOpenedWithin] = useState<OpenedWithin>('any');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [view, setView] = useState<ViewMode>(readStoredView);
  // A short line under the toolbar: "coming soon", or why creating failed.
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The artefact being renamed (with the text typed so far) or about to be deleted.
  const [renaming, setRenaming] = useState<{ artefact: ArtefactSummary; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ArtefactSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Files dragged over the page: the drop hint shows while any are; dragenter/leave fire per child element.
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const kindLabel = (kind: ArtefactKind) => t(`artefacts.kinds.${kind}`);
  const relative = (value: string) => formatRelativeTime(value, now, i18n.language) ?? t('artefacts.justNow');

  const counts = useMemo(() => {
    const result = new Map<ArtefactKind, number>();
    for (const artefact of artefacts ?? []) result.set(artefact.kind, (result.get(artefact.kind) ?? 0) + 1);
    return result;
  }, [artefacts]);

  const visible = useMemo(() => {
    const since = openedSince(openedWithin, now);
    const needle = query.trim().toLowerCase();
    const filtered = (artefacts ?? []).filter((artefact) => (
      (!needle || artefact.title.toLowerCase().includes(needle))
      && (kinds.size === 0 || kinds.has(artefact.kind))
      && (!pinnedOnly || artefact.pinned)
      && (!since || Date.parse(artefact.openedAt) >= since)
    ));
    const sorted = [...filtered].sort((a, b) => {
      if (sort === 'name') return a.title.localeCompare(b.title, i18n.language);
      const field = sort === 'created' ? 'createdAt' : 'openedAt';
      return Date.parse(b[field]) - Date.parse(a[field]);
    });
    // Pinned artefacts lead, in the chosen order among themselves.
    return [...sorted.filter((artefact) => artefact.pinned), ...sorted.filter((artefact) => !artefact.pinned)];
  }, [artefacts, query, kinds, pinnedOnly, openedWithin, sort, now, i18n.language]);

  const filtersActive = kinds.size > 0 || openedWithin !== 'any' || pinnedOnly || sort !== 'opened';

  const create = async (kind: ArtefactKind) => {
    if (!isEditableKind(kind)) {
      setNotice(t('artefacts.comingSoon', { name: kindLabel(kind) }));
      return;
    }
    if (creating) return;
    setCreating(true);
    try {
      const created = await createArtefact(kind, t('artefacts.untitled'));
      onArtefactCreated?.(created);
      onOpenArtefact(created.id);
    } catch (caught) {
      setNotice(t('artefacts.createFailed', { error: caught instanceof Error ? caught.message : String(caught) }));
    } finally {
      setCreating(false);
    }
  };

  const importErrorText = (caught: unknown) => {
    if (caught instanceof ArtefactImportError) {
      return caught.code === 'tooLarge'
        ? t('artefacts.import.errors.tooLarge', { limit: `${Math.round((caught.limitBytes ?? 0) / (1024 * 1024))} MB` })
        : t(`artefacts.import.errors.${caught.code}`);
    }
    return caught instanceof Error ? caught.message : String(caught);
  };

  /**
   * Turns each file into an artefact of its kind. One file that came in whole
   * is opened; otherwise the page stays and says what was imported, what was
   * left out of a file, and why any file failed.
   */
  const importFiles = async (files: File[]) => {
    if (importing || files.length === 0) return;
    setImporting(true);
    setNotice(t('artefacts.import.importing'));
    const created: ArtefactSummary[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        const imported = await readImportFile(file);
        const artefact = await createArtefact(imported.kind, imported.title, imported.content);
        onArtefactCreated?.(artefact);
        created.push(artefact);
        if (imported.warnings.length > 0) {
          const items = imported.warnings.map((warning) => t(`artefacts.import.warnings.${warning}`)).join(t('artefacts.import.listSeparator'));
          problems.push(t('artefacts.import.partial', { name: file.name, items }));
        }
      } catch (caught) {
        problems.push(t('artefacts.import.failed', { name: file.name, reason: importErrorText(caught) }));
      }
    }
    setImporting(false);
    if (files.length === 1 && created.length === 1 && problems.length === 0) {
      setNotice(null);
      onOpenArtefact(created[0].id);
      return;
    }
    setNotice([created.length > 0 ? t('artefacts.import.done', { count: created.length }) : '', ...problems].filter(Boolean).join(' '));
  };

  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const toggleKind = (kind: ArtefactKind) => {
    setKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const changeView = () => {
    const next = view === 'grid' ? 'list' : 'grid';
    setView(next);
    storeView(next);
  };

  const closeSearch = () => {
    setQuery('');
    setSearchOpen(false);
  };

  const renderActions = (artefact: ArtefactSummary) => (
    <>
      <ScheduledTaskMenu
        triggerClassName="artefact-icon-button"
        ariaLabel={t('artefacts.actions', { title: artefact.title })}
        title={t('artefacts.actions', { title: artefact.title })}
        align="end"
        trigger={<MoreHorizontal size={16} />}
      >
        {(close) => (
          <>
            <ScheduledTaskMenuItem label={t('artefacts.open')} onSelect={() => { close(); onOpenArtefact(artefact.id); }} />
            <ScheduledTaskMenuItem label={t('artefacts.rename')} onSelect={() => { close(); setRenaming({ artefact, title: artefact.title }); }} />
            {artefact.sessionId && (
              <ScheduledTaskMenuItem
                label={t('artefacts.viewConversation')}
                onSelect={() => { close(); onOpenSession(artefact.sessionId!); }}
              />
            )}
            <ScheduledTaskMenuDivider />
            <ScheduledTaskMenuItem label={t('artefacts.delete')} danger onSelect={() => { close(); setDeleting(artefact); }} />
          </>
        )}
      </ScheduledTaskMenu>
      <button
        type="button"
        className={`artefact-icon-button ${artefact.pinned ? 'active' : ''}`}
        aria-pressed={artefact.pinned}
        aria-label={artefact.pinned ? t('artefacts.unpin') : t('artefacts.pin')}
        title={artefact.pinned ? t('artefacts.unpin') : t('artefacts.pin')}
        onClick={(event) => { event.stopPropagation(); void update(artefact.id, { pinned: !artefact.pinned }); }}
      >
        <Pin size={15} />
      </button>
    </>
  );

  const renderCard = (artefact: ArtefactSummary) => {
    const definition = artefactKind(artefact.kind);
    return (
      <li key={artefact.id} className={`artefact-card artefact-kind-${definition.kind}`}>
        <button type="button" className="artefact-card-open" onClick={() => onOpenArtefact(artefact.id)} aria-label={artefact.title}>
          <ArtefactPreview artefact={artefact} />
          <span className="artefact-card-footer">
            <span className="artefact-card-title">{artefact.title}</span>
            <span className="artefact-card-meta">{kindLabel(artefact.kind)} · {relative(artefact.openedAt)}</span>
          </span>
        </button>
        <div className="artefact-card-actions">{renderActions(artefact)}</div>
      </li>
    );
  };

  const renderRow = (artefact: ArtefactSummary) => {
    const definition = artefactKind(artefact.kind);
    const Icon = definition.icon;
    return (
      <li key={artefact.id} className={`artefact-row artefact-kind-${definition.kind}`}>
        <button type="button" className="artefact-row-open" onClick={() => onOpenArtefact(artefact.id)}>
          <span className="artefact-row-icon"><Icon size={16} /></span>
          <span className="artefact-row-title">{artefact.title}</span>
          <span className="artefact-row-meta">{t('artefacts.openedAgo', { time: relative(artefact.openedAt) })}</span>
        </button>
        <div className="artefact-row-actions">{renderActions(artefact)}</div>
      </li>
    );
  };

  const sortLabels: Record<SortKey, string> = {
    opened: t('artefacts.sort.opened'),
    created: t('artefacts.sort.created'),
    name: t('artefacts.sort.name'),
  };
  const dateLabels: Record<OpenedWithin, string> = {
    any: t('artefacts.dates.any'),
    today: t('artefacts.dates.today'),
    week: t('artefacts.dates.week'),
    month: t('artefacts.dates.month'),
  };
  const typeSummary = kinds.size === 0
    ? t('artefacts.all')
    : kinds.size === 1 ? kindLabel([...kinds][0]) : t('artefacts.typesSelected', { count: kinds.size });

  const loading = artefacts === null;
  const hasAny = (artefacts?.length ?? 0) > 0;

  return (
    <div
      className="workspace-main artefacts-page flex h-full flex-col"
      onDragEnter={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDropActive(false);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        dragDepthRef.current = 0;
        setDropActive(false);
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        multiple
        hidden
        data-testid="artefacts-import-input"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Cleared so choosing the same file again still fires a change.
          event.target.value = '';
          void importFiles(files);
        }}
      />
      {dropActive && (
        <div className="artefacts-drop-overlay" aria-hidden="true">
          <Upload size={28} />
          <span>{t('artefacts.import.drop')}</span>
        </div>
      )}
      <div className="artefacts-scroll">
        <div className="artefacts-inner">
          <header className="artefacts-header">
            {menuButton}
            <h1>{t('artefacts.title')}</h1>
            <div className="artefacts-actions">
              {searchOpen ? (
                <div className="artefacts-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={query}
                    placeholder={t('artefacts.searchPlaceholder')}
                    aria-label={t('artefacts.search')}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Escape') closeSearch(); }}
                  />
                  <button type="button" aria-label={t('artefacts.clearSearch')} title={t('artefacts.clearSearch')} onClick={closeSearch}>
                    <X size={15} />
                  </button>
                </div>
              ) : (
                <button type="button" className="artefacts-icon" aria-label={t('artefacts.search')} title={t('artefacts.search')} onClick={() => setSearchOpen(true)}>
                  <Search size={18} />
                </button>
              )}
              <ScheduledTaskMenu
                triggerClassName={`artefacts-icon ${filtersActive ? 'active' : ''}`}
                ariaLabel={t('artefacts.filter')}
                title={t('artefacts.filter')}
                align="end"
                panelClassName="artefacts-filter-menu"
                trigger={<ListFilter size={18} />}
              >
                {() => (
                  <>
                    <ScheduledTaskSubmenu label={<span className="artefacts-menu-row">{t('artefacts.sortBy')}<small>{sortLabels[sort]}</small></span>}>
                      {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                        <ScheduledTaskMenuItem key={key} label={sortLabels[key]} selected={sort === key} onSelect={() => setSort(key)} />
                      ))}
                    </ScheduledTaskSubmenu>
                    <ScheduledTaskMenuDivider />
                    <ScheduledTaskSubmenu label={<span className="artefacts-menu-row">{t('artefacts.type')}<small>{typeSummary}</small></span>}>
                      {ARTEFACT_KINDS.map((definition, index) => (
                        <div key={definition.kind}>
                          {index === ARTEFACT_KINDS.length - 1 && <ScheduledTaskMenuDivider />}
                          <button
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={kinds.has(definition.kind)}
                            className="scheduled-task-menu-item artefacts-check-item"
                            onClick={() => toggleKind(definition.kind)}
                          >
                            <span className="artefacts-checkbox" aria-hidden="true">{kinds.has(definition.kind) && <Check size={12} strokeWidth={3} />}</span>
                            <span className="scheduled-task-menu-text"><span>{kindLabel(definition.kind)}</span></span>
                            <span className="artefacts-count">{counts.get(definition.kind) ?? 0}</span>
                          </button>
                        </div>
                      ))}
                    </ScheduledTaskSubmenu>
                    <ScheduledTaskSubmenu label={<span className="artefacts-menu-row">{t('artefacts.openedDate')}<small>{dateLabels[openedWithin]}</small></span>}>
                      {(Object.keys(dateLabels) as OpenedWithin[]).map((key) => (
                        <ScheduledTaskMenuItem key={key} label={dateLabels[key]} selected={openedWithin === key} onSelect={() => setOpenedWithin(key)} />
                      ))}
                    </ScheduledTaskSubmenu>
                    <ScheduledTaskMenuDivider />
                    <ScheduledTaskMenuItem label={t('artefacts.pinnedOnly')} selected={pinnedOnly} onSelect={() => setPinnedOnly((value) => !value)} />
                  </>
                )}
              </ScheduledTaskMenu>
              <button
                type="button"
                className="artefacts-icon"
                aria-label={view === 'grid' ? t('artefacts.listView') : t('artefacts.gridView')}
                title={view === 'grid' ? t('artefacts.listView') : t('artefacts.gridView')}
                onClick={changeView}
              >
                {view === 'grid' ? <List size={18} /> : <LayoutGrid size={18} />}
              </button>
              <ScheduledTaskMenu
                triggerClassName="artefacts-icon"
                ariaLabel={t('artefacts.new')}
                title={t('artefacts.new')}
                align="end"
                panelClassName="artefacts-new-menu"
                trigger={<Plus size={19} />}
              >
                {(close) => (
                  <>
                    <ScheduledTaskMenuItem icon={<MessageCircle size={16} />} label={t('artefacts.newChat')} onSelect={() => { close(); onNewChat(); }} />
                    <ScheduledTaskMenuItem
                      icon={<Folder size={16} />}
                      label={t('artefacts.newFolder')}
                      onSelect={() => { close(); setNotice(t('artefacts.comingSoon', { name: t('artefacts.newFolder') })); }}
                    />
                    <ScheduledTaskMenuItem
                      icon={<Upload size={16} />}
                      label={t('artefacts.import.action')}
                      onSelect={() => { close(); fileInputRef.current?.click(); }}
                    />
                    <ScheduledTaskMenuDivider />
                    {CREATABLE_KINDS.map((definition) => {
                      const Icon = definition.icon;
                      return (
                        <ScheduledTaskMenuItem
                          key={definition.kind}
                          icon={<span className={`artefacts-menu-icon artefact-kind-${definition.kind}`}><Icon size={16} /></span>}
                          label={(
                            <span className="artefacts-menu-row">
                              {kindLabel(definition.kind)}
                              {definition.beta && <em className="artefacts-beta">{t('artefacts.beta')}</em>}
                            </span>
                          )}
                          onSelect={() => { close(); void create(definition.kind); }}
                        />
                      );
                    })}
                  </>
                )}
              </ScheduledTaskMenu>
            </div>
          </header>

          {notice && <p role="status" className="artefacts-notice">{notice}</p>}
          {error && <p role="alert" className="artefacts-notice error">{error}</p>}

          <section aria-labelledby="artefacts-create-heading">
            <h2 id="artefacts-create-heading" className="artefacts-section-label">{t('artefacts.createNew')}</h2>
            <ul className="artefacts-tiles">
              {CREATABLE_KINDS.map((definition) => {
                const Icon = definition.icon;
                return (
                  <li key={definition.kind} className={`artefacts-tile artefact-kind-${definition.kind}`}>
                    <button
                      type="button"
                      className="artefacts-tile-face"
                      disabled={creating && isEditableKind(definition.kind)}
                      onClick={() => void create(definition.kind)}
                    >
                      <TileTexture />
                      {definition.beta && <em className="artefacts-beta artefacts-tile-beta">{t('artefacts.beta')}</em>}
                      <Icon size={40} strokeWidth={1.9} className="artefacts-tile-icon" />
                    </button>
                    <ScheduledTaskMenu
                      triggerClassName="artefacts-tile-more"
                      ariaLabel={t('artefacts.tileActions', { name: kindLabel(definition.kind) })}
                      title={t('artefacts.tileActions', { name: kindLabel(definition.kind) })}
                      trigger={<MoreHorizontal size={16} />}
                    >
                      {(close) => (
                        <ScheduledTaskMenuItem label={t('artefacts.newBlank')} onSelect={() => { close(); void create(definition.kind); }} />
                      )}
                    </ScheduledTaskMenu>
                    <span className="artefacts-tile-label">{kindLabel(definition.kind)}</span>
                  </li>
                );
              })}
              <li className="artefacts-tile artefacts-tile-more-types">
                <button
                  type="button"
                  className="artefacts-tile-face"
                  aria-label={t('artefacts.moreTypes')}
                  title={t('artefacts.moreTypes')}
                  onClick={() => setNotice(t('artefacts.comingSoon', { name: t('artefacts.moreTypes') }))}
                >
                  <Plus size={20} />
                </button>
              </li>
            </ul>
          </section>

          {loading && <p role="status" className="artefacts-status">{t('artefacts.loading')}</p>}
          {!loading && !hasAny && (
            <div className="artefacts-empty">
              <EmptyIllustration />
              <p className="artefacts-empty-title">{t('artefacts.emptyTitle')}</p>
              <p>{t('artefacts.emptyHint')}</p>
            </div>
          )}
          {!loading && hasAny && visible.length === 0 && <p className="artefacts-status">{t('artefacts.noMatches')}</p>}
          {visible.length > 0 && (
            view === 'grid'
              ? <ul className="artefacts-grid" aria-label={t('artefacts.title')}>{visible.map(renderCard)}</ul>
              : <ul className="artefacts-list" aria-label={t('artefacts.title')}>{visible.map(renderRow)}</ul>
          )}
        </div>
      </div>

      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent className="artefacts-dialog" aria-labelledby="artefacts-rename-title">
          <DialogTitle id="artefacts-rename-title" className="artefacts-dialog-title not-sr-only">{t('artefacts.renameTitle')}</DialogTitle>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!renaming || !renaming.title.trim()) return;
              void update(renaming.artefact.id, { title: renaming.title.trim() });
              setRenaming(null);
            }}
          >
            <input
              className="artefacts-dialog-input"
              value={renaming?.title ?? ''}
              maxLength={120}
              aria-label={t('artefacts.renameTitle')}
              autoFocus
              onChange={(event) => setRenaming((current) => current && { ...current, title: event.target.value })}
            />
            <div className="artefacts-dialog-actions">
              <button type="button" onClick={() => setRenaming(null)}>{t('artefacts.cancel')}</button>
              <button type="submit" className="primary" disabled={!renaming?.title.trim()}>{t('artefacts.save')}</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent className="artefacts-dialog" aria-labelledby="artefacts-delete-title">
          <DialogTitle id="artefacts-delete-title" className="artefacts-dialog-title not-sr-only">{t('artefacts.deleteTitle')}</DialogTitle>
          <p className="artefacts-dialog-text">{t('artefacts.deleteConfirm', { title: deleting?.title ?? '' })}</p>
          <div className="artefacts-dialog-actions">
            <button type="button" onClick={() => setDeleting(null)}>{t('artefacts.cancel')}</button>
            <button
              type="button"
              className="danger"
              onClick={() => { if (deleting) void remove(deleting.id); setDeleting(null); }}
            >
              {t('artefacts.delete')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
