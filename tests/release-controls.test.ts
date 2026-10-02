// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseYamlConfig } from '../src/utils/config-parser.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflowSchema = z.object({
  on: z.record(z.string(), z.unknown()),
  jobs: z.record(z.string(), z.object({
    environment: z.string().optional(),
    if: z.string().optional(),
    permissions: z.record(z.string(), z.string()).optional(),
    steps: z.array(z.object({
      name: z.string().optional(),
      run: z.string().optional(),
      if: z.string().optional(),
      env: z.record(z.string(), z.string()).optional(),
    })),
  })),
});

function workflow(name: string) {
  return workflowSchema.parse(parseYamlConfig(readFileSync(join(root, '.github/workflows', name), 'utf8')));
}

describe('release tag preflight', () => {
  let directory: string;

  async function manifests(version = '1.2.0', lockVersion = version, rootVersion = version) {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ version }));
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify({
      version: lockVersion, packages: { '': { version: rootVersion } },
    }));
  }

  function verify(ref: string) {
    const result = spawnSync(process.execPath, [join(root, 'scripts/verify-release.mjs')], {
      cwd: directory,
      env: { ...process.env, GITHUB_REF: ref },
      encoding: 'utf8',
      timeout: 5_000,
    });
    expect(result.error).toBeUndefined();
    return result;
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cates-release-test-'));
    await manifests();
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it.each(['refs/tags/v1.2.0', 'refs/tags/cates-analyzer-v1.2.0'])('accepts matching tag %s', ref => {
    expect(verify(ref).status).toBe(0);
  });

  it.each(['', 'refs/heads/main', 'refs/tags/v1.2.1', 'refs/tags/cates-analyzer-v1.2.1',
    'refs/tags/v1.2.0-rc.1', 'refs/tags/v1.2.0/extra'])('rejects an unbound publish from %s', ref => {
    const result = verify(ref);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Publishing requires');
  });

  it.each(['1.2.0-rc.1', '01.2.0', '1.2', 'latest'])('does not move stable tags for %s', async version => {
    await manifests(version);
    const result = verify(`refs/tags/v${version}`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('stable MAJOR.MINOR.PATCH');
  });

  it.each([['1.1.0', '1.2.0'], ['1.2.0', '1.1.0']])('rejects inconsistent lockfile versions', async (lock, pkg) => {
    await manifests('1.2.0', lock, pkg);
    const result = verify('refs/tags/v1.2.0');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must match package.json');
  });
});

describe('release workflow controls', () => {
  it.each(['npm-publish.yml', 'container-publish.yml'])('validates tags before installation or publishing in %s', name => {
    const config = workflow(name);
    expect(config.on).toHaveProperty('workflow_dispatch');
    const steps = config.jobs['publish']!.steps;
    const preflight = steps.findIndex(step => step.run === 'node scripts/verify-release.mjs');
    expect(preflight).toBeGreaterThanOrEqual(0);
    for (const [index, step] of steps.entries()) {
      if (step.run?.includes('npm ci') || /publish|Log in/.test(step.name ?? '')) {
        expect(index).toBeGreaterThan(preflight);
      }
    }
  });

  it('uses OIDC by default and confines the bootstrap token to an explicit manual publish', () => {
    const config = workflow('npm-publish.yml');
    expect(config.on['workflow_dispatch']).toMatchObject({
      inputs: { bootstrap: { type: 'boolean', required: true, default: false } },
    });
    const job = config.jobs['publish']!;
    expect(job.environment).toBe('npm-publish');
    expect(job.permissions).toMatchObject({ contents: 'read', 'id-token': 'write' });
    const publish = job.steps.filter(step => step.run?.includes('npm publish'));
    expect(publish).toHaveLength(2);
    expect(publish[0]).toMatchObject({
      if: "github.event_name != 'workflow_dispatch' || !inputs.bootstrap",
      env: { NODE_AUTH_TOKEN: '' },
    });
    expect(publish[1]).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.bootstrap",
      env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' },
    });
    expect(publish[1]!.run).toContain('exit 1');
    expect(readFileSync(join(root, '.github/workflows/npm-publish.yml'), 'utf8')
      .match(/secrets\.NPM_TOKEN/g)).toHaveLength(1);
  });

  it('supports manual release-please recovery only from main and reports missing credentials', () => {
    const config = workflow('release-please.yml');
    expect(config.on).toHaveProperty('workflow_dispatch');
    const job = config.jobs['release-please']!;
    expect(job.if).toBe("github.ref == 'refs/heads/main'");
    const disabled = job.steps.find(step => step.name === 'Report disabled release automation');
    expect(disabled?.run).toContain('GITHUB_STEP_SUMMARY');
    expect(disabled?.run).toContain('exit 1');
  });

  it('prepares all requested main-branch controls without claiming they are installed', () => {
    const protection = JSON.parse(readFileSync(join(root, '.github/main-branch-protection.json'), 'utf8'));
    expect(protection).toEqual({
      required_status_checks: {
        strict: true,
        checks: [
          { context: 'Validate (Node 22.12.0)', app_id: 15368 },
          { context: 'Validate (Node 24)', app_id: 15368 },
          { context: 'Analyze (javascript-typescript)', app_id: 15368 },
        ],
      },
      enforce_admins: true,
      required_pull_request_reviews: {
        dismiss_stale_reviews: true, require_code_owner_reviews: true,
        required_approving_review_count: 1, require_last_push_approval: true,
      },
      restrictions: null, required_linear_history: true,
      allow_force_pushes: false, allow_deletions: false,
      required_conversation_resolution: true,
    });
    const ci = parseYamlConfig(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'));
    expect(ci).toMatchObject({ jobs: { validate: {
      name: 'Validate (Node ${{ matrix.node-version }})',
      strategy: { matrix: { 'node-version': ['22.12.0', 24] } },
    } } });
    expect(parseYamlConfig(readFileSync(join(root, '.github/workflows/codeql.yml'), 'utf8')))
      .toMatchObject({ jobs: { analyze: {
        name: 'Analyze (${{ matrix.language }})',
        strategy: { matrix: { language: ['javascript-typescript'] } },
      } } });
  });
});
