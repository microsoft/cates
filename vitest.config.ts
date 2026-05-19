import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'service/**/*.ts'],
      exclude: ['src/cli/**', 'service/web/**'],
    },
  },
});
