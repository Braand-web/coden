import { describe, expect, it } from 'vitest';
import { applyTableQuery, paginate, searchRows, sortRows, toCsv, type TableColumn } from './table-model';

type Row = { id: string; email: string | null; projects: number; last: string | null };
const rows: Row[] = [
  { id: 'u1', email: 'élodie@exemple.fr', projects: 3, last: '2026-09-20T10:00:00Z' },
  { id: 'u2', email: 'bob@exemple.fr', projects: 12, last: null },
  { id: 'u3', email: null, projects: 1, last: '2026-09-24T10:00:00Z' },
];
const columns: TableColumn<Row>[] = [
  { key: 'email', label: 'E-mail', sortable: true },
  { key: 'projects', label: 'Projets', sortable: true },
  { key: 'last', label: 'Dernière connexion', sortable: true },
  { key: 'actions', label: '', exportable: false, value: () => '<button>' },
];

describe('admin tables', () => {
  it('searches every word, without accents, including the id', () => {
    expect(searchRows(rows, columns, 'elodie').map(row => row.id)).toEqual(['u1']);
    expect(searchRows(rows, columns, 'exemple bob').map(row => row.id)).toEqual(['u2']);
    expect(searchRows(rows, columns, 'u3').map(row => row.id)).toEqual(['u3']);
  });

  it('sorts numbers as numbers and dates as dates, empty values last', () => {
    expect(sortRows(rows, columns[1], 'desc').map(row => row.id)).toEqual(['u2', 'u1', 'u3']);
    expect(sortRows(rows, columns[2], 'desc').map(row => row.id)).toEqual(['u3', 'u1', 'u2']);
    expect(sortRows(rows, columns[2], 'asc').map(row => row.id)).toEqual(['u1', 'u3', 'u2']);
    expect(sortRows(rows, columns[0], 'asc').map(row => row.id)).toEqual(['u2', 'u1', 'u3']);
  });

  it('pages and clamps', () => {
    const many = Array.from({ length: 53 }, (_, index) => index);
    expect(paginate(many, 3, 25)).toMatchObject({ page: 3, pages: 3, from: 51, to: 53, total: 53 });
    expect(paginate(many, 99, 25).page).toBe(3);
    expect(paginate([], 1, 25)).toMatchObject({ page: 1, pages: 1, from: 0, to: 0 });
    expect(applyTableQuery(rows, columns, { search: '', sortKey: 'projects', sortDirection: 'asc', page: 1, pageSize: 2 }).rows.map(row => row.id)).toEqual(['u3', 'u1']);
  });

  it('exports a CSV Excel opens, without formulas or action columns', () => {
    const csv = toCsv([{ id: 'x', email: '=HYPERLINK("http://evil")', projects: 2, last: 'a;b' }], columns);
    expect(csv.startsWith('﻿E-mail;Projets;Dernière connexion\r\n')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"a;b"');
    expect(csv).not.toContain('<button>');
  });
});
