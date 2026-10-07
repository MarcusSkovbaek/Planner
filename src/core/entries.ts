import type { ActivitySegment, BillingType, TimeEntry } from './model';

export const entryMinutes = (e: Pick<TimeEntry, 'startMin' | 'endMin'>) => Math.max(0, e.endMin - e.startMin);

export interface DaySummary {
  unreleasedMin: number;
  releasedMin: number;
  totalMin: number;
  byBilling: Record<BillingType, number>;
  capturedMs: number;
  convertedMs: number;
}

export function summarizeDay(
  entries: readonly TimeEntry[],
  activities: readonly ActivitySegment[],
  excludedApps: readonly string[] = [],
): DaySummary {
  const byBilling: Record<BillingType, number> = { billable: 0, nonBillable: 0, businessDevelopment: 0 };
  let unreleasedMin = 0;
  let releasedMin = 0;
  const linked = new Set<string>();
  for (const e of entries) {
    const min = entryMinutes(e);
    byBilling[e.billingType] += min;
    if (e.status === 'released') releasedMin += min;
    else unreleasedMin += min;
    for (const id of e.activityIds) linked.add(id);
  }
  const excluded = new Set(excludedApps);
  let capturedMs = 0;
  let convertedMs = 0;
  for (const a of activities) {
    if (excluded.has(a.app)) continue;
    const ms = Math.max(0, a.end - a.start);
    capturedMs += ms;
    if (linked.has(a.id)) convertedMs += ms;
  }
  return { unreleasedMin, releasedMin, totalMin: unreleasedMin + releasedMin, byBilling, capturedMs, convertedMs };
}

/** Ids of all activity segments linked to any of the entries. */
export function linkedActivityIds(entries: readonly TimeEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const e of entries) for (const id of e.activityIds) ids.add(id);
  return ids;
}

export function sortEntries<T extends Pick<TimeEntry, 'date' | 'startMin' | 'endMin'>>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.endMin - b.endMin);
}
