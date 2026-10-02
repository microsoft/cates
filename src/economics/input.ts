// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { open } from 'node:fs/promises';
import { ECONOMICS_LIMITS } from './schema.js';

export async function readEconomicsInput(path: string): Promise<unknown> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Economics input must be a regular JSON file');
    if (stat.size > ECONOMICS_LIMITS.maxBytes) throw new Error(`Economics input exceeds ${ECONOMICS_LIMITS.maxBytes} bytes`);
    const buffer = Buffer.alloc(ECONOMICS_LIMITS.maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > ECONOMICS_LIMITS.maxBytes) throw new Error(`Economics input exceeds ${ECONOMICS_LIMITS.maxBytes} bytes`);
    return JSON.parse(buffer.toString('utf8', 0, length));
  } finally {
    await handle.close();
  }
}
