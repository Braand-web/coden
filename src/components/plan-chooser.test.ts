// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { planComparisonRows } from '../config/billing-v2';
import { renderPlanChooser } from './plan-chooser';

/**
 * The Upgrade modal carries the pricing page's comparison table, row for row;
 * the onboarding keeps its two cards only.
 */
const flat = (value: string) => value.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const tableRows = (root: ParentNode) => Array.from(root.querySelectorAll('tbody tr')).map(row =>
  Array.from(row.children).map(cell => flat(cell.textContent || '')));
const expected = planComparisonRows().map(row => [row.label, row.free, row.pro, row.business].map(flat));

afterEach(() => { document.body.innerHTML = ''; });

describe('plan chooser comparison table', () => {
  it('shows the full comparison in the Upgrade modal, the recommended column highlighted', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const cleanup = renderPlanChooser(host, { source: 'upgrade_modal', recommended: 'pro', currentPlan: 'free' });
    const table = host.querySelector('.cpc-compare table');
    expect(table).not.toBeNull();
    expect(Array.from(table!.querySelectorAll('thead th')).map(cell => flat(cell.querySelector('span')?.textContent || cell.textContent || ''))).toEqual(['Capacité', 'Free', 'Pro', 'Business']);
    expect(tableRows(table!)).toEqual(expected);
    expect(table!.querySelector('thead .is-featured')?.textContent).toBe('Pro');
    expect(table!.querySelectorAll('tbody td.is-featured')).toHaveLength(expected.length);
    expect(Array.from(table!.querySelectorAll('thead small')).map(node => node.closest('th')?.querySelector('span')?.textContent)).toEqual(['Free']);
    cleanup();
  });

  it('keeps the onboarding to the two plan cards', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const cleanup = renderPlanChooser(host, { source: 'onboarding', recommended: 'business' });
    expect(host.querySelector('.cpc-compare')).toBeNull();
    expect(host.querySelectorAll('.cpc-plan')).toHaveLength(2);
    cleanup();
  });

});
