// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
export type DemoCategory = string;

export interface DemoRepository {
  category: DemoCategory;
  owner: string;
  repo: string;
  url: string;
}

export const DEFAULT_DEMO_REPOSITORIES: DemoRepository[] = [];
