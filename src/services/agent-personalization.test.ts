import { describe, expect, it } from 'vitest';
import {
  MAX_USER_INSTRUCTIONS,
  normalizeInstructions,
  renderUserInstructionsBlock,
  runWithPersonalization,
  withUserInstructions,
} from './agent-personalization';

describe('user instructions', () => {
  it('are bounded and cleaned', () => {
    expect(normalizeInstructions('  Utilise Tailwind\u0007  ')).toBe('Utilise Tailwind');
    expect(normalizeInstructions('x'.repeat(MAX_USER_INSTRUCTIONS + 50))).toHaveLength(MAX_USER_INSTRUCTIONS);
  });

  it('reach the system prompt of the request they belong to, and only that one', async () => {
    const base = 'You build applications.';
    expect(withUserInstructions(base)).toBe(base);
    const inside = await runWithPersonalization(
      { userId: 'u1', instructions: 'Réponds en français. Utilise toujours Tailwind.', shareImprovement: true },
      async () => {
        await Promise.resolve();
        return withUserInstructions(base);
      },
    );
    expect(inside.startsWith(base)).toBe(true);
    expect(inside).toContain('<user_instructions>\nRéponds en français. Utilise toujours Tailwind.\n</user_instructions>');
    expect(inside).toContain('highest priority after Coden\'s platform and security rules');
    expect(withUserInstructions(base)).toBe(base);
  });

  it('carries the private memory even without explicit instructions', () => {
    const block = renderUserInstructionsBlock('', '- Stack: React, Tailwind');
    expect(block).toContain('WHAT YOU KNOW ABOUT THIS USER');
    expect(block).not.toContain('<user_instructions>');
    expect(renderUserInstructionsBlock('', '')).toBe('');
  });
});
