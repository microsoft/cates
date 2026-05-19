import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'service/**/*.ts'],
      exclude: [
        'src/cli/**',
        // demo.ts is CLI orchestration that drives real GitHub clones
        // through analyze(); only its pure helpers are testable without
        // network. The exercised paths still get coverage via
        // tests/demo-helpers.test.ts.
        'src/demo.ts',
        'service/web/**',
      ],
      // Floor that future PRs must not regress past. Adjust upward as the
      // suite grows; never reduce silently.
      thresholds: {
        statements: 88,
        branches: 85,
        functions: 92,
        lines: 88,
      },
    },
  },
});
