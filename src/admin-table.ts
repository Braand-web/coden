/**
 * One table for every admin list: search, filter chips, sort, pagination and
 * CSV export of what is filtered (every page, not just the visible one).
 *
 * The toolbar is rendered once and never replaced, so typing in the search
 * field keeps its focus; only the body and the pager are redrawn.
 */
import { applyTableQuery, toCsv, type SortDirection, type TableColumn, type TableQuery } from './lib/table-model';
import { toast } from './lib/ui-feedback';

export type DataTableColumn<Row> = TableColumn<Row> & {
  /** HTML for the cell; already escaped by the caller. Defaults to the escaped value. */
  render?: (row: Row) => string;
  align?: 'start' | 'end';
};

export type DataTableFilter<Row> = { value: string; label: string; test: (row: Row) => boolean };

export type DataTableOptions<Row> = {
  columns: DataTableColumn<Row>[];
  rows?: Row[];
  pageSize?: number;
  searchPlaceholder?: string;
  exportName?: string;
  emptyMessage?: string;
  filters?: DataTableFilter<Row>[];
  initialSort?: { key: string; direction: SortDirection };
  label: string;
};

export type DataTable<Row> = {
  setRows: (rows: Row[]) => void;
  setExternalQuery: (query: string) => void;
  setLoading: (message?: string) => void;
  setError: (message: string) => void;
};

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let tableCount = 0;

export function mountDataTable<Row>(root: HTMLElement, options: DataTableOptions<Row>): DataTable<Row> {
  const id = `admin-dt-${++tableCount}`;
  let rows: Row[] = options.rows || [];
  let externalQuery = '';
  let filter = 'all';
  let status: { kind: 'ready' } | { kind: 'loading'; message: string } | { kind: 'error'; message: string } = options.rows ? { kind: 'ready' } : { kind: 'loading', message: 'Chargement…' };
  const query: TableQuery = {
    search: '',
    sortKey: options.initialSort?.key || null,
    sortDirection: options.initialSort?.direction || 'desc',
    page: 1,
    pageSize: options.pageSize || 25,
  };

  root.classList.add('admin-dt');
  root.innerHTML = `
    <div class="admin-dt-toolbar">
      <input class="admin-search admin-dt-search" type="search" placeholder="${escapeHtml(options.searchPlaceholder || 'Rechercher')}" aria-label="Rechercher dans ${escapeHtml(options.label)}" aria-controls="${id}">
      ${options.filters?.length ? `<div class="admin-filter-row admin-dt-filters" role="group" aria-label="Filtres">${[{ value: 'all', label: 'Tous' }, ...options.filters].map(item => `<button class="admin-filter-chip${item.value === 'all' ? ' active' : ''}" data-dt-filter="${escapeHtml(item.value)}" type="button" aria-pressed="${item.value === 'all'}">${escapeHtml(item.label)}</button>`).join('')}</div>` : ''}
      <span class="admin-dt-count" aria-live="polite"></span>
      ${options.exportName ? '<button class="admin-button subtle admin-dt-export" type="button">Exporter en CSV</button>' : ''}
    </div>
    <div class="admin-dt-body" id="${id}"></div>
    <div class="admin-dt-pager"></div>`;

  const body = root.querySelector<HTMLElement>('.admin-dt-body')!;
  const pager = root.querySelector<HTMLElement>('.admin-dt-pager')!;
  const count = root.querySelector<HTMLElement>('.admin-dt-count')!;

  const visibleRows = () => {
    const active = options.filters?.find(item => item.value === filter);
    const filtered = active ? rows.filter(active.test) : rows;
    return externalQuery ? applyTableQuery(filtered, options.columns, { ...query, search: externalQuery, page: 1, pageSize: Number.MAX_SAFE_INTEGER }).filtered : filtered;
  };

  const draw = () => {
    if (status.kind === 'loading') {
      body.innerHTML = `<div class="admin-skeleton" role="status" aria-label="${escapeHtml(status.message)}">${'<div class="admin-skeleton-line"></div>'.repeat(5)}</div>`;
      pager.innerHTML = '';
      count.textContent = '';
      return;
    }
    if (status.kind === 'error') {
      body.innerHTML = `<div class="admin-error" role="alert">${escapeHtml(status.message)}</div>`;
      pager.innerHTML = '';
      count.textContent = '';
      return;
    }
    const result = applyTableQuery(visibleRows(), options.columns, query);
    query.page = result.page;
    count.textContent = `${result.total.toLocaleString('fr-FR')} résultat${result.total > 1 ? 's' : ''}`;
    if (!result.total) {
      body.innerHTML = `<div class="admin-empty">${escapeHtml(query.search || externalQuery || filter !== 'all' ? 'Aucun résultat pour ces critères.' : options.emptyMessage || 'Aucune donnée pour le moment.')}</div>`;
      pager.innerHTML = '';
      return;
    }
    body.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <caption class="admin-sr-only">${escapeHtml(options.label)}</caption>
          <thead><tr>${options.columns.map(column => {
            const sorted = query.sortKey === column.key;
            const aria = sorted ? (query.sortDirection === 'asc' ? 'ascending' : 'descending') : 'none';
            const label = escapeHtml(column.label);
            return `<th scope="col"${column.align === 'end' ? ' class="is-end"' : ''}${column.sortable ? ` aria-sort="${aria}"` : ''}>${column.sortable ? `<button type="button" class="admin-dt-sort" data-dt-sort="${escapeHtml(column.key)}">${label}<span aria-hidden="true">${sorted ? (query.sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span></button>` : label}</th>`;
          }).join('')}</tr></thead>
          <tbody>${result.rows.map(row => `<tr>${options.columns.map(column => `<td${column.align === 'end' ? ' class="is-end"' : ''} data-label="${escapeHtml(column.label)}">${column.render ? column.render(row) : escapeHtml((column.value ? column.value(row) : (row as any)?.[column.key]) ?? '--')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>`;
    pager.innerHTML = result.pages > 1 || result.total > 25 ? `
      <span>${result.from.toLocaleString('fr-FR')}–${result.to.toLocaleString('fr-FR')} sur ${result.total.toLocaleString('fr-FR')}</span>
      <label class="admin-dt-size">Lignes <select data-dt-size aria-label="Lignes par page">${[25, 50, 100].map(size => `<option value="${size}"${size === query.pageSize ? ' selected' : ''}>${size}</option>`).join('')}</select></label>
      <div class="admin-dt-pages">
        <button class="admin-button subtle" type="button" data-dt-page="prev"${result.page <= 1 ? ' disabled' : ''}>Précédent</button>
        <span>Page ${result.page} / ${result.pages}</span>
        <button class="admin-button subtle" type="button" data-dt-page="next"${result.page >= result.pages ? ' disabled' : ''}>Suivant</button>
      </div>` : '';
  };

  root.querySelector<HTMLInputElement>('.admin-dt-search')?.addEventListener('input', event => {
    query.search = (event.target as HTMLInputElement).value;
    query.page = 1;
    draw();
  });
  root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    const sort = target?.closest<HTMLElement>('[data-dt-sort]');
    if (sort) {
      const key = sort.dataset.dtSort || '';
      query.sortDirection = query.sortKey === key && query.sortDirection === 'desc' ? 'asc' : 'desc';
      query.sortKey = key;
      draw();
      root.querySelector<HTMLElement>(`[data-dt-sort="${CSS.escape(key)}"]`)?.focus();
      return;
    }
    const page = target?.closest<HTMLElement>('[data-dt-page]');
    if (page) {
      query.page += page.dataset.dtPage === 'next' ? 1 : -1;
      draw();
      root.scrollIntoView({ block: 'nearest' });
      return;
    }
    const chip = target?.closest<HTMLElement>('[data-dt-filter]');
    if (chip) {
      filter = chip.dataset.dtFilter || 'all';
      root.querySelectorAll<HTMLElement>('[data-dt-filter]').forEach(item => {
        const active = item === chip;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      query.page = 1;
      draw();
      return;
    }
    if (target?.closest('.admin-dt-export')) {
      const all = applyTableQuery(visibleRows(), options.columns, { ...query, page: 1, pageSize: Number.MAX_SAFE_INTEGER }).filtered;
      if (!all.length) { toast('Rien à exporter avec ces filtres.', 'info'); return; }
      const blob = new Blob([toCsv(all, options.columns)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `coden-${options.exportName}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`${all.length.toLocaleString('fr-FR')} ligne${all.length > 1 ? 's' : ''} exportée${all.length > 1 ? 's' : ''}.`, 'success');
    }
  });
  root.addEventListener('change', event => {
    const select = event.target instanceof HTMLSelectElement && event.target.matches('[data-dt-size]') ? event.target : null;
    if (!select) return;
    query.pageSize = Number(select.value) || 25;
    query.page = 1;
    draw();
  });

  draw();
  return {
    setRows(next) { rows = next; status = { kind: 'ready' }; draw(); },
    setExternalQuery(next) { externalQuery = next.trim(); query.page = 1; draw(); },
    setLoading(message = 'Chargement…') { status = { kind: 'loading', message }; draw(); },
    setError(message) { status = { kind: 'error', message }; draw(); },
  };
}
