// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
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
        // The optimizer CLI is thin argument-parsing/glue around optimize();
        // excluded for the same reason as src/cli/** (its logic is covered via
        // tests/optimizer.test.ts driving optimize() and the report renderer).
        'src/optimizer/cli.ts',
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
        // Vitest v4 reports branch coverage slightly lower than v3 for this
        // suite; keep the floor aligned with the current enforced baseline.
        branches: 82,
        functions: 92,
        lines: 88,
      },
    },
  },
});
