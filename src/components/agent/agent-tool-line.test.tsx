// @vitest-environment happy-dom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentToolLine } from './agent-tool-line';
import { toolPart } from './agent-parts';

/**
 * A step that wrote six files used to show two names and an ellipsis: the
 * information was on screen and unreadable at once. A count is honest, and the
 * list is a click away.
 */
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * happy-dom implements just enough of the Web Animations API for Motion to
 * pick its native path and then throw cancelling those animations on unmount.
 * Removing `animate` entirely makes Motion take its JavaScript loop, which the
 * DOM here supports — the component under test is unchanged either way.
 */
// @ts-expect-error - deliberately removing a partial implementation
delete window.Element.prototype.animate;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const render = (files: string[], action: 'read' | 'edit' = 'edit') =>
  act(() => { root.render(<AgentToolLine part={toolPart('t1', action, files)} />); });

describe('AgentToolLine', () => {
  it('counts the files instead of truncating their names', async () => {
    await render(['src/App.tsx', 'src/main.tsx', 'src/index.css']);
    expect(container.textContent).toContain('3 fichiers');
    expect(container.textContent).not.toContain('src/App.tsx');
  });

  it('names a single file, and offers nothing to unfold', async () => {
    await render(['src/App.tsx']);
    expect(container.textContent).toContain('src/App.tsx');
    // A disclosure that reveals the line you are already reading is noise, and
    // a focus stop that leads nowhere.
    expect(container.querySelector('button')).toBeNull();
  });

  it('opens on click, one file per line, and closes again', async () => {
    const files = ['src/App.tsx', 'src/main.tsx', 'src/index.css'];
    await render(files);
    const toggle = container.querySelector('button') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    await act(async () => { toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = [...container.querySelectorAll('li')].map(node => node.textContent);
    expect(items).toEqual(files);
    // The list it controls is the list it reveals.
    expect(container.querySelector('ul')?.id).toBe(toggle.getAttribute('aria-controls'));

    await act(async () => { toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('stays collapsed until asked', async () => {
    await render(['a.ts', 'b.ts']);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('says what it did even with nothing to name', async () => {
    await render([], 'read');
    expect(container.textContent).toContain('A lu');
    expect(container.querySelector('button')).toBeNull();
  });
});
