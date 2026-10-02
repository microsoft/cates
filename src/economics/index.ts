// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import { ANALYZER_VERSION } from '../version.js';
import { COST_CATEGORIES, EconomicsInputSchema, type EconomicsRequest, type RateCard } from './schema.js';

export { EconomicsInputSchema, ECONOMICS_LIMITS } from './schema.js';
export type { EconomicsInput } from './schema.js';

export interface RequestEconomics {
  id: string;
  taskId: string;
  provider: string;
  model: string;
  purpose: EconomicsRequest['purpose'];
  status: EconomicsRequest['status'];
  startedAt: string;
  endedAt: string;
  usage: EconomicsRequest['usage'];
  parentRequestId?: string;
  retryOf?: string;
  rateCardId?: string;
  billingSource?: string;
  cost: number | null;
  knownSubtotal: number;
  estimatedCost: number | null;
  reconciliationDelta: number | null;
  costBasis: 'reported' | 'rate-card' | 'incomplete';
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function completeSum(values: (number | null | undefined)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value == null) return null;
    total += value;
  }
  return total;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
}

function price(tokens: number | null, rate: number | undefined): number | null {
  if (tokens === 0) return 0;
  return tokens === null || rate === undefined ? null : tokens * rate / 1_000_000;
}

function priceRequest(request: EconomicsRequest, card: RateCard | undefined): RequestEconomics {
  const usage = request.usage;
  const uncached = usage.input === null || usage.cacheRead === null || usage.cacheWrite === null
    ? null : usage.input - usage.cacheRead - usage.cacheWrite;
  const components = [
    price(uncached, card?.perMillion.input),
    price(usage.cacheRead, card?.perMillion.cacheRead),
    price(usage.cacheWrite, card?.perMillion.cacheWrite),
    price(usage.output, card?.perMillion.output),
  ];
  const estimatedCost = completeSum(components);
  const cost = request.billing?.amount ?? estimatedCost;
  return {
    id: request.id, taskId: request.taskId,
    provider: request.provider, model: request.model,
    purpose: request.purpose, status: request.status,
    startedAt: request.startedAt, endedAt: request.endedAt, usage: request.usage,
    parentRequestId: request.parentRequestId, retryOf: request.retryOf,
    rateCardId: request.rateCardId, billingSource: request.billing?.source,
    cost,
    knownSubtotal: request.billing?.amount ?? sum(components.filter(value => value !== null)),
    estimatedCost,
    reconciliationDelta: request.billing && estimatedCost !== null ? request.billing.amount - estimatedCost : null,
    costBasis: request.billing ? 'reported' : estimatedCost !== null ? 'rate-card' : 'incomplete',
  };
}

function latency(entries: { startedAt: string; endedAt: string }[]) {
  const sorted = entries.map(entry => Date.parse(entry.endedAt) - Date.parse(entry.startedAt)).sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.5) - 1]! : null,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1]! : null,
  };
}

/**
 * Opt-in, offline accounting over caller-normalized records. It neither calls
 * models nor infers usage, task success, provider prices, or missing costs.
 */
export function analyzeEconomics(rawInput: unknown) {
  const input = EconomicsInputSchema.parse(rawInput);
  const cards = new Map(input.rateCards.map(card => [card.id, card]));
  const requests = input.requests.map(request => priceRequest(request, cards.get(request.rateCardId ?? '')));
  const captureComplete = input.requestCoverage === 'complete';
  const modelCost = captureComplete ? completeSum(requests.map(request => request.cost)) : null;
  const categories = COST_CATEGORIES.map(category => {
    const items = input.additionalCosts.filter(cost => cost.category === category);
    const coverage = input.costCoverage[category];
    return {
      category, coverage,
      knownSubtotal: sum(items.flatMap(item => item.amount === null ? [] : [item.amount])),
      total: coverage === 'complete' || coverage === 'not-applicable' ? completeSum(items.map(item => item.amount)) : null,
    };
  });
  const totalCost = completeSum([modelCost, ...categories.map(category => category.total)]);
  const knownSubtotal = sum(requests.map(request => request.knownSubtotal)) + sum(categories.map(category => category.knownSubtotal));
  const usageSum = (field: keyof EconomicsRequest['usage']) => completeSum(input.requests.map(request => request.usage[field]));
  const inputTokens = usageSum('input');
  const outputTokens = usageSum('output');
  const cacheRead = usageSum('cacheRead');
  const cacheWrite = usageSum('cacheWrite');
  const reasoning = usageSum('reasoning');
  const totalTokens = completeSum([inputTokens, outputTokens]);
  const accepted = input.tasks.filter(task => task.outcome === 'accepted').length;
  const terminal = input.tasks.filter(task => ['accepted', 'rejected', 'abandoned'].includes(task.outcome)).length;

  const group = (entries: RequestEconomics[]) => ({
    requests: entries.length,
    knownSubtotal: sum(entries.map(request => request.knownSubtotal)),
    cost: captureComplete ? completeSum(entries.map(request => request.cost)) : null,
  });
  const models = new Map<string, RequestEconomics[]>();
  const purposes = new Map<EconomicsRequest['purpose'], RequestEconomics[]>();
  const taskRequests = new Map<string, RequestEconomics[]>();
  for (const request of requests) {
    const key = JSON.stringify([request.provider, request.model]);
    for (const [map, keyValue] of [[models, key], [taskRequests, request.taskId]] as const) {
      const entries = map.get(keyValue) ?? [];
      entries.push(request);
      map.set(keyValue, entries);
    }
    const entries = purposes.get(request.purpose) ?? [];
    entries.push(request);
    purposes.set(request.purpose, entries);
  }

  const limitations = [
    'EXPERIMENTAL: no score, conformance, or CI gate impact; schema and metrics may change.',
    'Caller-reported data and prices are not independently verified. Complete means caller-declared coverage, not an audit.',
    'Rate-card amounts are estimates, not invoices. Unknown is not zero. No FX, tax, credit, tier, or discount inference.',
    'Token subsets are not additive: cached input is inside input; reasoning is inside output.',
    'Model/purpose/retry/status groups overlap; do not add across groupings. Parent records must contain exclusive request usage, not subtree totals.',
    'Cost per accepted task includes all captured work, including failed, abandoned, and pending work. It is not causal ROI or proven savings.',
    'Latency uses nearest-rank percentiles of recorded intervals, not a sum of concurrent request durations.',
  ];
  const gaps: string[] = [];
  if (input.source.kind === 'scenario') gaps.push('Scenario inputs: results are modeled, not observed production outcomes.');
  if (!captureComplete) gaps.push(`Request capture is ${input.requestCoverage}; total cost and per-accepted-task economics are unknown.`);
  for (const category of categories) {
    if (category.total === null) gaps.push(`Incomplete ${category.category} cost coverage.`);
  }
  for (const request of requests) {
    if (request.cost === null) gaps.push(`Request ${request.id}: missing usage or applicable pricing; only a known subtotal is available.`);
  }
  if ([inputTokens, outputTokens, cacheRead, cacheWrite].some(value => value === null)) gaps.push('Token accounting contains unknown values.');
  if (reasoning === null) gaps.push('Reasoning breakdown is unavailable for at least one request; output can still be complete.');
  if (input.tasks.some(task => task.outcome === 'unknown')) gaps.push('Some task outcomes are unknown; acceptance rate uses only terminal, classified tasks.');
  if (!accepted) gaps.push('No accepted tasks: per-accepted-task economics are undefined, not zero.');

  return {
    schemaVersion: 1 as const,
    stability: 'experimental' as const,
    analyzerVersion: ANALYZER_VERSION,
    currency: input.currency,
    source: input.source,
    window: input.window,
    coverage: { requests: input.requestCoverage, costs: input.costCoverage },
    pricing: input.rateCards,
    costs: {
      knownSubtotal, total: totalCost, model: modelCost, categories,
      reportedRequests: requests.filter(request => request.costBasis === 'reported').length,
      estimatedRequests: requests.filter(request => request.costBasis === 'rate-card').length,
      unpricedRequests: requests.filter(request => request.costBasis === 'incomplete').length,
      perAcceptedTask: ratio(totalCost, accepted),
    },
    tokens: {
      input: inputTokens, cacheRead, cacheWrite, output: outputTokens, reasoning,
      total: totalTokens,
      cacheReadShare: ratio(cacheRead, inputTokens),
      reasoningShare: ratio(reasoning, outputTokens),
      perAcceptedTask: captureComplete ? ratio(totalTokens, accepted) : null,
    },
    outcomes: {
      tasks: input.tasks.length, accepted, terminal,
      rejected: input.tasks.filter(task => task.outcome === 'rejected').length,
      abandoned: input.tasks.filter(task => task.outcome === 'abandoned').length,
      pending: input.tasks.filter(task => task.outcome === 'pending').length,
      unknown: input.tasks.filter(task => task.outcome === 'unknown').length,
      acceptanceRate: ratio(accepted, terminal),
    },
    latency: { requests: latency(input.requests), tasks: latency(input.tasks) },
    attribution: {
      models: [...models.values()].map(entries => ({ provider: entries[0]!.provider, model: entries[0]!.model, ...group(entries) })),
      purposes: [...purposes].map(([purpose, entries]) => ({ purpose, ...group(entries) })),
      tasks: input.tasks.map(task => ({ ...task, model: group(taskRequests.get(task.id) ?? []) })),
      retries: group(requests.filter(request => request.retryOf)),
      failed: group(requests.filter(request => request.status === 'failed')),
      cancelled: group(requests.filter(request => request.status === 'cancelled')),
    },
    requests,
    additionalCosts: input.additionalCosts,
    gaps,
    limitations,
  };
}

export type EconomicsReport = ReturnType<typeof analyzeEconomics>;

export function formatEconomics(report: EconomicsReport): string {
  const value = (n: number | null) => n === null ? 'unknown' : String(Number(n.toPrecision(10)));
  const money = (n: number | null) => n === null ? 'unknown' : `${report.currency} ${value(n)}`;
  return [
    'CATES Token Economics - EXPERIMENTAL (not scored)',
    `Evidence: ${report.source.kind} | Request coverage: ${report.coverage.requests}`,
    `Total cost: ${money(report.costs.total)} | Known subtotal: ${money(report.costs.knownSubtotal)}`,
    `Model cost: ${money(report.costs.model)} | Reported / estimated / unpriced requests: ${report.costs.reportedRequests} / ${report.costs.estimatedRequests} / ${report.costs.unpricedRequests}`,
    `Accepted tasks: ${report.outcomes.accepted}/${report.outcomes.terminal} terminal (${report.outcomes.tasks} captured)`,
    `Cost per accepted task: ${money(report.costs.perAcceptedTask)}`,
    `Input / output tokens: ${value(report.tokens.input)} / ${value(report.tokens.output)}`,
    `Cache read / write (input subsets): ${value(report.tokens.cacheRead)} / ${value(report.tokens.cacheWrite)}`,
    `Reasoning (output subset): ${value(report.tokens.reasoning)}`,
    `Tokens per accepted task: ${value(report.tokens.perAcceptedTask)}`,
    `Retries / failed / cancelled requests: ${report.attribution.retries.requests} / ${report.attribution.failed.requests} / ${report.attribution.cancelled.requests}`,
    `Request latency p50 / p95: ${value(report.latency.requests.p50Ms)} / ${value(report.latency.requests.p95Ms)} ms`,
    `Task elapsed time p50 / p95: ${value(report.latency.tasks.p50Ms)} / ${value(report.latency.tasks.p95Ms)} ms`,
    '',
    'Non-model cost coverage:',
    ...report.costs.categories.map(category => `  ${category.category}: ${category.coverage}; total ${money(category.total)}`),
    '',
    'Gaps:',
    ...(report.gaps.length ? report.gaps.map(gap => `  - ${gap}`) : ['  No missing fields detected; caller declarations still require verification.']),
    '',
    ...report.limitations.map(note => `  ${note}`),
  ].join('\n');
}
