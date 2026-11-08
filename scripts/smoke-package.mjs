// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.');
const temporary = mkdtempSync(join(tmpdir(), 'cates-package-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check through npm run smoke:package');
const runNpm = (args, options) => execFileSync(process.execPath, [npmCli, ...args], options);
try {
  const packed = JSON.parse(runNpm([
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
  ], { cwd: root, encoding: 'utf8' }));
  assert.equal(packed.length, 1, 'Expected one package artifact');
  const files = packed[0].files.map(file => file.path);
  for (const required of ['dist/index.js', 'dist/cli/index.js', 'README.md', 'LICENSE.TXT']) {
    assert.ok(files.includes(required), `Package missing ${required}`);
  }
  assert.ok(!files.some(file => /^(tests|fixtures|coverage)\//.test(file)),
    'Package contains test or coverage assets');
  // Install only from the packed artifact, not the source checkout.
  runNpm(['install', '--prefix', temporary, '--ignore-scripts',
    '--no-audit', '--no-fund', join(temporary, packed[0].filename)], { stdio: 'inherit' });
  const cli = join(temporary, 'node_modules', 'cates-analyzer', 'dist', 'cli', 'index.js');
  const output = execFileSync(process.execPath, [
    cli, join(root, 'fixtures', 'good'), '--format', 'json', '--min-score', '70',
  ], { cwd: temporary, encoding: 'utf8' });
  const report = JSON.parse(output);
  assert.ok(Number.isFinite(report.score?.overall) && report.score.overall >= 70,
    'Packaged CLI must report a passing fixture score');
  const failing = spawnSync(process.execPath, [
    cli, join(root, 'fixtures', 'bad'), '--format', 'json', '--min-score', '100',
  ], { cwd: temporary, encoding: 'utf8' });
  if (failing.error) throw failing.error;
  assert.equal(failing.status, 1, `Packaged CLI must reject a failing score: ${failing.stderr}`);
  assert.ok(JSON.parse(failing.stdout).score.overall < 100,
    'Failing CLI response must retain its JSON report');
  console.log('Packaged CLI smoke test passed.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
