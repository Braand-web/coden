import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .tsx too: a component test that renders JSX cannot be a .ts file, and
    // the existing UI tests only got away with it by calling createElement.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
  },
});
