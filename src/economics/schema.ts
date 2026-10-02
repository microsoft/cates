// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { z } from 'zod';

export const ECONOMICS_LIMITS = {
  maxRecords: 10_000,
  maxRateCards: 1_000,
  maxBytes: 1_000_000,
} as const;

const id = z.string().trim().min(1).max(128).regex(/^[^\u0000-\u001f\u007f]+$/, 'IDs must not contain control characters');
const reference = z.string().trim().min(1).max(1_024);
const timestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative().max(1_000_000_000).nullable();
const amount = z.number().nonnegative().max(1_000_000_000);

export const COST_CATEGORIES = [
  'tools', 'compute', 'storage', 'network', 'human-review', 'other', 'adjustments',
] as const;
export type CostCategory = typeof COST_CATEGORIES[number];

const UsageSchema = z.object({
  // Input includes both cache subsets; output includes reasoning. Never add
  // these subsets a second time, even when a provider exposes separate fields.
  input: count,
  cacheRead: count,
  cacheWrite: count,
  output: count,
  reasoning: count.optional(),
}).strict().superRefine((usage, ctx) => {
  if (usage.input !== null && (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) > usage.input) {
    ctx.addIssue({ code: 'custom', path: ['input'], message: 'Cache reads and writes must be disjoint subsets of input' });
  }
  if (usage.output !== null && usage.reasoning != null && usage.reasoning > usage.output) {
    ctx.addIssue({ code: 'custom', path: ['reasoning'], message: 'Reasoning must be a subset of output' });
  }
});

const RateCardSchema = z.object({
  id,
  provider: id,
  model: id,
  // Distinguish region, tier, TTL, context-length tier, discounts, and modality
  // in the caller's selected card. CATES does not guess commercial terms.
  context: reference,
  source: reference,
  retrievedAt: timestamp,
  effectiveFrom: timestamp,
  effectiveTo: timestamp.optional(),
  perMillion: z.object({
    input: amount,
    cacheRead: amount.optional(),
    cacheWrite: amount.optional(),
    output: amount,
  }).strict(),
}).strict();

const TaskSchema = z.object({
  id,
  startedAt: timestamp,
  endedAt: timestamp,
  outcome: z.enum(['accepted', 'rejected', 'abandoned', 'pending', 'unknown']),
  outcomeEvidence: reference.optional(),
}).strict();

const RequestSchema = z.object({
  id,
  taskId: id,
  parentRequestId: id.optional(),
  retryOf: id.optional(),
  provider: id,
  model: id,
  purpose: z.enum(['planning', 'generation', 'retrieval', 'compaction', 'verification', 'repair', 'other']),
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  startedAt: timestamp,
  endedAt: timestamp,
  usage: UsageSchema,
  rateCardId: id.optional(),
  // An authoritative model-request charge replaces, rather than adds to, the
  // rate-card estimate. Tool/hosting/human charges belong in additionalCosts.
  billing: z.object({ amount, source: reference }).strict().optional(),
}).strict();

const AdditionalCostSchema = z.object({
  id,
  taskId: id.optional(),
  category: z.enum(COST_CATEGORIES),
  amount: z.number().min(-1_000_000_000).max(1_000_000_000).nullable(),
  source: reference,
}).strict().superRefine((cost, ctx) => {
  if (cost.amount !== null && cost.amount < 0 && cost.category !== 'adjustments') {
    ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Only adjustments may be negative' });
  }
});

export const EconomicsInputSchema = z.object({
  schemaVersion: z.literal(1),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use one ISO-style currency code; no implicit FX or credit conversion'),
  source: z.object({
    kind: z.enum(['observed', 'scenario']),
    reference,
  }).strict(),
  window: z.object({ startedAt: timestamp, endedAt: timestamp }).strict(),
  requestCoverage: z.enum(['complete', 'partial', 'unknown']),
  costCoverage: z.record(
    z.enum(COST_CATEGORIES),
    z.enum(['complete', 'partial', 'unknown', 'not-applicable']),
  ),
  rateCards: z.array(RateCardSchema).max(ECONOMICS_LIMITS.maxRateCards),
  tasks: z.array(TaskSchema).min(1).max(ECONOMICS_LIMITS.maxRecords),
  requests: z.array(RequestSchema).max(ECONOMICS_LIMITS.maxRecords),
  additionalCosts: z.array(AdditionalCostSchema).max(ECONOMICS_LIMITS.maxRecords),
}).strict().superRefine((input, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const start = Date.parse(input.window.startedAt);
  const end = Date.parse(input.window.endedAt);
  if (end < start) issue(['window', 'endedAt'], 'Window ends before it starts');

  for (const collection of ['tasks', 'requests', 'rateCards', 'additionalCosts'] as const) {
    const seen = new Set<string>();
    input[collection].forEach((entry, i) => {
      if (seen.has(entry.id)) issue([collection, i, 'id'], `Duplicate ${collection} ID: ${entry.id}`);
      seen.add(entry.id);
    });
  }
  const tasks = new Map(input.tasks.map(task => [task.id, task]));
  const requests = new Map(input.requests.map(request => [request.id, request]));
  const cards = new Map(input.rateCards.map(card => [card.id, card]));

  const checkTimes = (entry: { startedAt: string; endedAt: string }, path: (string | number)[]) => {
    if (Date.parse(entry.endedAt) < Date.parse(entry.startedAt)) issue(path, 'End precedes start');
    if (Date.parse(entry.startedAt) < start || Date.parse(entry.endedAt) > end) issue(path, 'Outside capture window');
  };
  input.tasks.forEach((task, i) => {
    checkTimes(task, ['tasks', i]);
    if ((task.outcome === 'accepted' || task.outcome === 'rejected') && !task.outcomeEvidence) {
      issue(['tasks', i, 'outcomeEvidence'], 'Accepted/rejected outcomes require an explicit evaluation reference');
    }
  });
  input.rateCards.forEach((card, i) => {
    if (card.effectiveTo && Date.parse(card.effectiveTo) <= Date.parse(card.effectiveFrom)) {
      issue(['rateCards', i, 'effectiveTo'], 'Rate validity must be a non-empty interval');
    }
  });
  input.requests.forEach((request, i) => {
    checkTimes(request, ['requests', i]);
    const task = tasks.get(request.taskId);
    if (!task) issue(['requests', i, 'taskId'], 'Unknown task');
    else if (Date.parse(request.startedAt) < Date.parse(task.startedAt) || Date.parse(request.endedAt) > Date.parse(task.endedAt)) {
      issue(['requests', i], 'Request must be within its task interval');
    }
    for (const field of ['parentRequestId', 'retryOf'] as const) {
      const targetId = request[field];
      if (!targetId) continue;
      const target = requests.get(targetId);
      if (!target || target.id === request.id || target.taskId !== request.taskId) {
        issue(['requests', i, field], 'Reference must identify another request in the same task');
      } else if (Date.parse(target.startedAt) > Date.parse(request.startedAt)) {
        issue(['requests', i, field], 'Referenced request cannot start after this request');
      }
    }
    if (request.rateCardId) {
      const card = cards.get(request.rateCardId);
      if (!card) issue(['requests', i, 'rateCardId'], 'Unknown rate card');
      else {
        if (card.provider !== request.provider || card.model !== request.model) {
          issue(['requests', i, 'rateCardId'], 'Rate card provider/model does not match request');
        }
        const time = Date.parse(request.startedAt);
        if (time < Date.parse(card.effectiveFrom) || (card.effectiveTo && time >= Date.parse(card.effectiveTo))) {
          issue(['requests', i, 'rateCardId'], 'Rate card is not effective at request start');
        }
      }
    }
  });
  input.additionalCosts.forEach((cost, i) => {
    if (cost.taskId && !tasks.has(cost.taskId)) issue(['additionalCosts', i, 'taskId'], 'Unknown task');
    if (input.costCoverage[cost.category] === 'not-applicable') {
      issue(['additionalCosts', i, 'category'], 'A not-applicable category cannot contain charges');
    }
  });

  // Linear-time cycle detection, including mixed parent/retry cycles. Input
  // ordering is irrelevant; timestamps alone cannot rule out equal-time loops.
  const children = new Map<string, string[]>();
  const degrees = new Map(input.requests.map(request => [request.id, 0]));
  for (const request of input.requests) {
    for (const target of new Set([request.parentRequestId, request.retryOf])) {
      if (!target || !requests.has(target)) continue;
      const list = children.get(target) ?? [];
      list.push(request.id);
      children.set(target, list);
      degrees.set(request.id, (degrees.get(request.id) ?? 0) + 1);
    }
  }
  const ready = [...degrees].filter(([, degree]) => degree === 0).map(([key]) => key);
  for (let i = 0; i < ready.length; i++) {
    for (const child of children.get(ready[i]!) ?? []) {
      const degree = degrees.get(child)! - 1;
      degrees.set(child, degree);
      if (degree === 0) ready.push(child);
    }
  }
  if (ready.length !== requests.size) issue(['requests'], 'Parent/retry references contain a cycle');
});

export type EconomicsInput = z.infer<typeof EconomicsInputSchema>;
export type EconomicsRequest = EconomicsInput['requests'][number];
export type RateCard = EconomicsInput['rateCards'][number];
