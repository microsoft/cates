// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { open } from 'node:fs/promises';

export async function readBoundedJson(path: string, maxBytes: number, label: string): Promise<unknown> {
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`${label} must be a regular JSON file`);
    if (stat.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
    return JSON.parse(buffer.toString('utf8', 0, length));
  } finally {
    await handle.close();
  }
}
