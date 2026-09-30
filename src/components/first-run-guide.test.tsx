// @vitest-environment happy-dom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FirstRunGuide } from './first-run-guide';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { window.localStorage.clear(); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('the first-run guide', () => {
  it('shows three steps and the tips to someone with no project', () => {
    act(() => root.render(<FirstRunGuide projectCount={0} loading={false} />));
    expect(container.querySelectorAll('.coden-firstrun-steps li')).toHaveLength(3);
    expect(container.querySelectorAll('.coden-firstrun-tips li').length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).toContain('2 à 4 minutes');
  });

  it('never shows to someone who has a project, nor while the list is still loading', () => {
    act(() => root.render(<FirstRunGuide projectCount={2} loading={false} />));
    expect(container.querySelector('.coden-firstrun')).toBeNull();
    act(() => root.render(<FirstRunGuide projectCount={0} loading />));
    expect(container.querySelector('.coden-firstrun')).toBeNull();
  });

  it('can be put away, and stays away', () => {
    act(() => root.render(<FirstRunGuide projectCount={0} loading={false} />));
    act(() => { container.querySelector<HTMLButtonElement>('.coden-firstrun-close')!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('.coden-firstrun')).toBeNull();
    act(() => root.render(<FirstRunGuide projectCount={0} loading={false} />));
    expect(container.querySelector('.coden-firstrun')).toBeNull();
  });
});
