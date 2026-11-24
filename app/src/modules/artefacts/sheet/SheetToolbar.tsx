import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  ChevronDown,
  Italic,
  MessageCircle,
  PaintBucket,
  Redo2,
  Snowflake,
  TableCellsMerge,
  Underline,
  Undo2,
} from 'lucide-react';

import { ScheduledTaskMenu, ScheduledTaskMenuItem } from '@/modules/scheduled-tasks';

/** A selected block of cells as FortuneSheet reports it: inclusive row and column bounds. */
export type GridSelection = { row: number[]; column: number[] };

/** The part of FortuneSheet's workbook API the toolbar calls. */
export type ToolbarWorkbook = {
  getSelection: () => GridSelection[] | undefined;
  getCellValue: (row: number, column: number, options?: { type?: string }) => unknown;
  setCellFormatByRange: (attr: string, value: unknown, range: GridSelection | GridSelection[]) => void;
  mergeCells: (ranges: GridSelection[], type: string) => void;
  cancelMerge: (ranges: GridSelection[]) => void;
  freeze: (type: 'row' | 'column' | 'both', range: { row: number; column: number }) => void;
  handleUndo: () => void;
  handleRedo: () => void;
  /** Computes every formula; FortuneSheet does not do it for loaded data. */
  calculateFormula: (id?: string, range?: { row: [number, number]; column: [number, number] }) => void;
};

type SheetToolbarProps = {
  /** Reads the live workbook; null before the grid has mounted. */
  getWorkbook: () => ToolbarWorkbook | null;
  /** Off while Claude is editing the spreadsheet. */
  disabled: boolean;
  composerOpen: boolean;
  onToggleComposer: () => void;
};

/** Number formats the Format menu offers, by FortuneSheet format code. */
const NUMBER_FORMATS = [
  { key: 'general', code: 'General' },
  { key: 'number', code: '#,##0.00' },
  { key: 'percent', code: '0.00%' },
  { key: 'currency', code: '¥#,##0.00' },
  { key: 'date', code: 'yyyy-MM-dd' },
] as const;

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className="sheet-tool"
      aria-label={label}
      title={label}
      disabled={disabled}
      // Keeps the grid's selection: a toolbar click must not take focus from it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Rendered by SpreadsheetEditor as the floating format bar under the
 * composer. Acts on the grid's current selection through FortuneSheet's API
 * (the grid's own toolbar is hidden), and toggles the composer.
 */
export default function SheetToolbar({ getWorkbook, disabled, composerOpen, onToggleComposer }: SheetToolbarProps) {
  const { t } = useTranslation('sidebar');
  const textColorRef = useRef<HTMLInputElement | null>(null);
  const fillColorRef = useRef<HTMLInputElement | null>(null);

  const withSelection = (action: (workbook: ToolbarWorkbook, selection: GridSelection[], anchor: { row: number; column: number }) => void) => {
    const workbook = getWorkbook();
    if (!workbook) return;
    const selection = workbook.getSelection()?.filter((range) => range.row?.length && range.column?.length) ?? [];
    const ranges = selection.length > 0 ? selection : [{ row: [0, 0], column: [0, 0] }];
    action(workbook, ranges, { row: ranges[0].row[0], column: ranges[0].column[0] });
  };

  // Bold, italic and underline turn off when the first selected cell already has them.
  const toggleFlag = (attr: 'bl' | 'it' | 'un') => withSelection((workbook, ranges, anchor) => {
    const on = Number(workbook.getCellValue(anchor.row, anchor.column, { type: attr })) === 1;
    workbook.setCellFormatByRange(attr, on ? 0 : 1, ranges);
  });

  const align = (value: number) => withSelection((workbook, ranges) => workbook.setCellFormatByRange('ht', value, ranges));

  const applyColor = (attr: 'fc' | 'bg', color: string) => withSelection((workbook, ranges) => workbook.setCellFormatByRange(attr, color, ranges));

  const toggleMerge = () => withSelection((workbook, ranges, anchor) => {
    if (workbook.getCellValue(anchor.row, anchor.column, { type: 'mc' })) workbook.cancelMerge(ranges);
    else workbook.mergeCells(ranges, 'merge-all');
  });

  const setFormat = (code: string) => withSelection((workbook, ranges) => {
    workbook.setCellFormatByRange('ct', { fa: code, t: code === 'General' ? 'g' : 'n' }, ranges);
  });

  return (
    <div className="sheet-toolbar" role="toolbar" aria-label={t('artefacts.editor.toolbar.label')}>
      <ToolButton label={t('artefacts.editor.toolbar.bold')} disabled={disabled} onClick={() => toggleFlag('bl')}><Bold size={17} /></ToolButton>
      <ToolButton label={t('artefacts.editor.toolbar.italic')} disabled={disabled} onClick={() => toggleFlag('it')}><Italic size={17} /></ToolButton>
      <ToolButton label={t('artefacts.editor.toolbar.underline')} disabled={disabled} onClick={() => toggleFlag('un')}><Underline size={17} /></ToolButton>
      <span className="sheet-toolbar-divider" aria-hidden="true" />
      <ToolButton label={t('artefacts.editor.toolbar.alignLeft')} disabled={disabled} onClick={() => align(1)}><AlignLeft size={17} /></ToolButton>
      <ToolButton label={t('artefacts.editor.toolbar.alignCenter')} disabled={disabled} onClick={() => align(0)}><AlignCenter size={17} /></ToolButton>
      <ToolButton label={t('artefacts.editor.toolbar.alignRight')} disabled={disabled} onClick={() => align(2)}><AlignRight size={17} /></ToolButton>
      <span className="sheet-toolbar-divider" aria-hidden="true" />
      <ToolButton label={t('artefacts.editor.toolbar.textColor')} disabled={disabled} onClick={() => textColorRef.current?.click()}><Baseline size={17} /></ToolButton>
      <input ref={textColorRef} type="color" className="sheet-color-input" tabIndex={-1} aria-hidden="true" defaultValue="#1f1f1f"
        onChange={(event) => applyColor('fc', event.target.value)} />
      <ToolButton label={t('artefacts.editor.toolbar.fillColor')} disabled={disabled} onClick={() => fillColorRef.current?.click()}><PaintBucket size={17} /></ToolButton>
      <input ref={fillColorRef} type="color" className="sheet-color-input" tabIndex={-1} aria-hidden="true" defaultValue="#fff2cc"
        onChange={(event) => applyColor('bg', event.target.value)} />
      <ToolButton label={t('artefacts.editor.toolbar.merge')} disabled={disabled} onClick={toggleMerge}><TableCellsMerge size={17} /></ToolButton>
      <ScheduledTaskMenu
        triggerClassName="sheet-tool sheet-tool-format"
        ariaLabel={t('artefacts.editor.toolbar.numberFormat')}
        title={t('artefacts.editor.toolbar.numberFormat')}
        trigger={<><span>123</span><ChevronDown size={13} /></>}
      >
        {(close) => NUMBER_FORMATS.map((format) => (
          <ScheduledTaskMenuItem
            key={format.key}
            label={t(`artefacts.editor.formats.${format.key}`)}
            description={format.code === 'General' ? undefined : format.code}
            onSelect={() => { close(); if (!disabled) setFormat(format.code); }}
          />
        ))}
      </ScheduledTaskMenu>
      <ToolButton label={t('artefacts.editor.toolbar.freeze')} disabled={disabled}
        onClick={() => getWorkbook()?.freeze('row', { row: 0, column: 0 })}><Snowflake size={17} /></ToolButton>
      <span className="sheet-toolbar-divider" aria-hidden="true" />
      <ToolButton label={t('artefacts.editor.toolbar.undo')} disabled={disabled} onClick={() => getWorkbook()?.handleUndo()}><Undo2 size={17} /></ToolButton>
      <ToolButton label={t('artefacts.editor.toolbar.redo')} disabled={disabled} onClick={() => getWorkbook()?.handleRedo()}><Redo2 size={17} /></ToolButton>
      <button
        type="button"
        className={`sheet-toolbar-chat ${composerOpen ? 'active' : ''}`}
        aria-pressed={composerOpen}
        onClick={onToggleComposer}
      >
        <MessageCircle size={15} />
        {t('artefacts.editor.toolbar.chat')}
      </button>
    </div>
  );
}
