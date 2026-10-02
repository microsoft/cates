// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const version = manifest.version;

assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  'The stable publishing workflows require a stable MAJOR.MINOR.PATCH version');
assert.equal(lock.version, version, 'The lockfile version must match package.json');
assert.equal(lock.packages?.['']?.version, version,
  'The lockfile root package version must match package.json');
assert.ok(
  [`refs/tags/v${version}`, `refs/tags/cates-analyzer-v${version}`].includes(process.env.GITHUB_REF),
  `Publishing requires a v${version} or cates-analyzer-v${version} tag matching package.json`,
);

console.log(`Verified release ${version} from ${process.env.GITHUB_REF}`);
