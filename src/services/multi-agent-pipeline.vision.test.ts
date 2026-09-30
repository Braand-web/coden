import { describe, expect, it } from 'vitest';
import { withoutVisualParts } from './multi-agent-pipeline';

describe('images carried between rounds', () => {
  it('drops the pictures of an earlier round but keeps its text, and says so', () => {
    const parts = withoutVisualParts([
      { type: 'text', text: 'Reproduis la maquette' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,BBBB' } },
    ]);
    expect(parts.some(part => part.type === 'image_url')).toBe(false);
    expect(parts[0]).toEqual({ type: 'text', text: 'Reproduis la maquette' });
    expect(JSON.stringify(parts)).toContain('2 image(s)');
  });

  it('leaves a message with no picture untouched', () => {
    const parts = [{ type: 'text' as const, text: 'rien à voir' }];
    expect(withoutVisualParts(parts)).toEqual(parts);
  });
});
