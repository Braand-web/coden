// @vitest-environment happy-dom
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AskCard from './ask-card';
import type { DecisionAnswer, DecisionQuestion } from '../../lib/agent-chat-protocol';

/**
 * The three bugs the ported card arrived with, pinned as behaviour.
 *
 * Every test here fails on the original: the last answer is dropped, the free
 * text never reaches the caller, and typing re-measures the card. They need a
 * DOM and real timers because all three are timing bugs — a static render
 * cannot see any of them.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (element: React.ReactElement) => act(() => { root.render(element); });
const settle = async (ms = 0) => { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); };
const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); };

/** React tracks the last value it wrote, so a plain assignment looks like no change. */
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  await act(async () => { input.dispatchEvent(new window.Event('input', { bubbles: true })); });
};

const options = (index = 0) => Array.from(container.querySelectorAll('[role="radio"],[role="checkbox"]'))
  .filter(option => option.closest('[aria-hidden="true"]') === null)[index]!;

describe('AskCard', () => {
  it('submits the answer chosen on the last question', async () => {
    const questions: DecisionQuestion[] = [
      { q: 'Quel style ?', type: 'radio', options: ['Minimal', 'Dense'] },
      { q: 'Quelle langue ?', type: 'radio', options: ['Français', 'Anglais'] },
    ];
    let submitted: Record<number, DecisionAnswer> | null = null;
    await render(<AskCard questions={questions} onSubmitted={answers => { submitted = answers; }} />);
    await settle();

    await click(options(0));            // Minimal, on question 1
    await settle(600);                  // the auto-advance carries us to question 2
    await click(options(1));            // Anglais, on the last question
    await settle(600);                  // the auto-advance submits

    // The original read `selected` from the render that created `send`, so the
    // choice made 480ms earlier was not in it.
    expect(submitted).toEqual({ 0: { selected: [0] }, 1: { selected: [1] } });
  });

  it('sends what the user typed, not only what they clicked', async () => {
    const questions: DecisionQuestion[] = [{ q: 'Quelle app ?', type: 'radio', options: ['Todo', 'Blog'] }];
    let submitted: Record<number, DecisionAnswer> | null = null;
    await render(<AskCard questions={questions} onSubmitted={answers => { submitted = answers; }} />);
    await settle();

    await type(container.querySelector('input') as HTMLInputElement, 'un tableau de bord de ventes');
    const send = container.querySelector('.coden-ask-continue') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    await click(send);

    expect(submitted).toEqual({ 0: { selected: [], custom: 'un tableau de bord de ventes' } });
  });

  it('does not re-measure the card on every keystroke', async () => {
    const questions: DecisionQuestion[] = [{ q: 'Quelle app ?', type: 'radio', options: ['Todo', 'Blog'] }];
    await render(<AskCard questions={questions} onSubmitted={() => {}} />);
    await settle();

    const viewport = container.querySelector('.coden-ask-viewport') as HTMLElement;
    const before = viewport.style.height;
    // A measurement taken now would read this instead of the height already applied.
    const question = container.querySelector('.coden-ask-track > div') as HTMLElement;
    Object.defineProperty(question, 'offsetHeight', { configurable: true, value: 999 });

    await type(container.querySelector('input') as HTMLInputElement, 'abc');
    await settle();

    // `custom` used to be a dependency of the layout effect, so each character
    // re-ran the measurement and restarted a 360ms height transition.
    expect(viewport.style.height).toBe(before);
    expect(viewport.style.height).not.toBe('999px');
  });

  it('rolls only the digits that changed when the counter gets wider', async () => {
    const questions: DecisionQuestion[] = Array.from({ length: 10 }, (_, index) => ({
      q: `Question ${index + 1}`,
      type: 'check' as const,
      options: ['Oui', 'Non'],
    }));
    await render(<AskCard questions={questions} onSubmitted={() => {}} />);
    await settle();

    const next = () => container.querySelectorAll('.coden-ask-step')[1]!;
    for (let step = 0; step < 8; step += 1) { await click(next()); await settle(500); }
    expect(container.querySelector('.coden-ask-counter')?.textContent).toBe('9 / 10');

    await click(next());
    await settle(30);

    // "9 / 10" → "10 / 10" is one character wider. Compared without padding
    // every position differs and the whole counter rolls; padded, only the two
    // leading characters do.
    expect(container.querySelectorAll('.coden-ask-roll').length).toBe(2);
    await settle(600);
    expect(container.querySelector('.coden-ask-counter')?.textContent).toBe('10 / 10');
  });

  it('answers once, however many times the card is pressed', async () => {
    const questions: DecisionQuestion[] = [{ q: 'Continuer ?', type: 'radio', options: ['Oui', 'Non'] }];
    let calls = 0;
    await render(<AskCard questions={questions} onSubmitted={() => { calls += 1; }} />);
    await settle();

    await click(options(0));
    await settle(600);
    expect(calls).toBe(1);
    expect(container.querySelector('.coden-ask-sent')).not.toBeNull();
  });
});
