// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseYamlConfig } from '../src/utils/config-parser.js';

describe('SDLC verification contract', () => {
  it('preserves runtime audit, coverage, builds and artifact checks', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(manifest.scripts['audit:runtime']).toBe('npm audit --omit=dev --audit-level=high');
    expect(manifest.scripts.verify.split(' && ')).toEqual([
      'npm run audit:runtime', 'npm run typecheck:all', 'npm run test:coverage',
      'npm run build', 'npm run build:service', 'npm run smoke:package',
    ]);
  });
  it('runs the same complete gate in CI', () => {
    const config = parseYamlConfig(readFileSync('.github/workflows/ci.yml', 'utf8'));
    expect(config).toMatchObject({
      jobs: { validate: { steps: expect.arrayContaining([
        expect.objectContaining({ run: 'npm run verify' }),
      ]) } },
    });
  });
});
