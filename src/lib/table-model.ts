/**
 * Search, sort, page and export for the admin tables — the rules only, so
 * they are tested once and every table behaves the same way.
 */

export type SortDirection = 'asc' | 'desc';

export type TableColumn<Row> = {
  key: string;
  label: string;
  /** The value sorted on and exported; defaults to `row[key]`. */
  value?: (row: Row) => unknown;
  sortable?: boolean;
  /** Left out of the CSV (action buttons). */
  exportable?: boolean;
};

export type TableQuery = {
  search: string;
  sortKey: string | null;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
};

export function columnValue<Row>(column: TableColumn<Row>, row: Row): unknown {
  return column.value ? column.value(row) : (row as any)?.[column.key];
}

function normalize(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Every word of the query must appear somewhere in the row's visible values. */
export function searchRows<Row>(rows: Row[], columns: TableColumn<Row>[], search: string): Row[] {
  const words = normalize(search).split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter(row => {
    const haystack = columns.map(column => normalize(columnValue(column, row))).join(' ') + ' ' + normalize((row as any)?.id);
    return words.every(word => haystack.includes(word));
  });
}

function comparable(value: unknown): { kind: 0 | 1 | 2; number: number; text: string } {
  if (value === null || value === undefined || value === '') return { kind: 2, number: 0, text: '' };
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 0, number: value, text: '' };
  if (typeof value === 'boolean') return { kind: 0, number: value ? 1 : 0, text: '' };
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const time = Date.parse(text);
    if (Number.isFinite(time)) return { kind: 0, number: time, text: '' };
  }
  const numeric = Number(text.replace(/\s/g, '').replace(',', '.'));
  if (text.trim() && Number.isFinite(numeric) && /^[\s\d.,-]+$/.test(text)) return { kind: 0, number: numeric, text: '' };
  return { kind: 1, number: 0, text: normalize(text) };
}

/** Stable, typed sort; empty values always last, whichever the direction. */
export function sortRows<Row>(rows: Row[], column: TableColumn<Row> | undefined, direction: SortDirection): Row[] {
  if (!column) return rows;
  const factor = direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, key: comparable(columnValue(column, row)) }))
    .sort((a, b) => {
      if (a.key.kind === 2 || b.key.kind === 2) return a.key.kind === b.key.kind ? a.index - b.index : a.key.kind === 2 ? 1 : -1;
      if (a.key.kind !== b.key.kind) return (a.key.kind - b.key.kind) * factor;
      const diff = a.key.kind === 0 ? a.key.number - b.key.number : a.key.text.localeCompare(b.key.text, 'fr');
      return diff ? diff * factor : a.index - b.index;
    })
    .map(entry => entry.row);
}

export function paginate<Row>(rows: Row[], page: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 25);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  const start = (current - 1) * size;
  return { rows: rows.slice(start, start + size), page: current, pages, from: rows.length ? start + 1 : 0, to: Math.min(rows.length, start + size), total: rows.length };
}

export function applyTableQuery<Row>(rows: Row[], columns: TableColumn<Row>[], query: TableQuery) {
  const searched = searchRows(rows, columns, query.search);
  const sorted = sortRows(searched, columns.find(column => column.key === query.sortKey), query.sortDirection);
  return { filtered: sorted, ...paginate(sorted, query.page, query.pageSize) };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A cell starting with = + - @ is a formula in a spreadsheet: neutralised, not executed.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r,]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** UTF-8 CSV with a BOM and `;` separators, which Excel in French opens as columns. */
export function toCsv<Row>(rows: Row[], columns: TableColumn<Row>[]): string {
  const exported = columns.filter(column => column.exportable !== false);
  const lines = [exported.map(column => csvCell(column.label)).join(';')];
  for (const row of rows) lines.push(exported.map(column => csvCell(columnValue(column, row))).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}
