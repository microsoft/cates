// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { ECONOMICS_LIMITS } from './schema.js';
import { readBoundedJson } from '../utils/read-json.js';

export async function readEconomicsInput(path: string): Promise<unknown> {
  return readBoundedJson(path, ECONOMICS_LIMITS.maxBytes, 'Economics input');
}
