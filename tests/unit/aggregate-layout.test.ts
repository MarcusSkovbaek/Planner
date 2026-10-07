import { describe, expect, it } from 'vitest';
import { buildCapturedBlocks, suggestNarrative } from '@core/activity/aggregate';
import { layoutColumns } from '@core/layout';
import type { ActivitySegment } from '@core/model';

const MIN = 60_000;
const base = new Date(2026, 9, 7, 9, 0).getTime();
let n = 0;
const seg = (app: string, title: string, startMin: number, endMin: number): ActivitySegment => ({
  id: `s${n++}`,
  app,
  appName: app,
  title,
  start: base + startMin * MIN,
  end: base + endMin * MIN,
});

describe('buildCapturedBlocks', () => {
  it('merges visits within the gap and keeps interleaved work as overlapping blocks', () => {
    const segments = [
      seg('winword', 'A.docx - Word', 0, 10),
      seg('outlook', 'RE: A - Message (HTML)', 10, 12),
      seg('winword', 'A.docx - Word', 12, 30),
      seg('winword', 'A.docx - Word', 60, 70), // after a long break → new block
    ];
    const blocks = buildCapturedBlocks(segments, { mergeGapMs: 5 * MIN });
    expect(blocks).toHaveLength(3);
    const [doc, mail, later] = blocks;
    expect(doc).toMatchObject({ subject: 'A.docx', visits: 2, activeMs: 28 * MIN });
    expect(doc!.end - doc!.start).toBe(30 * MIN);
    expect(mail).toMatchObject({ kind: 'email', activeMs: 2 * MIN });
    expect(later!.activeMs).toBe(10 * MIN);
  });

  it('respects exclusions, hidden kinds and minimum active time', () => {
    const segments = [seg('spotify', 'Music', 0, 30), seg('chrome', 'News - Google Chrome', 30, 30.5), seg('excel', 'B.xlsx - Excel', 31, 40)];
    const blocks = buildCapturedBlocks(segments, {
      mergeGapMs: MIN,
      minActiveMs: MIN,
      excludedApps: ['spotify'],
      hiddenKinds: ['presentation'],
    });
    expect(blocks.map((b) => b.subject)).toEqual(['B.xlsx']);
  });

  it('suggests a narrative from the heaviest subjects', () => {
    expect(
      suggestNarrative([
        { subject: 'Mail', activeMs: 1 },
        { subject: 'SPA.docx', activeMs: 10 },
        { subject: 'spa.docx', activeMs: 5 },
      ]),
    ).toBe('SPA.docx; Mail');
  });
});

describe('layoutColumns', () => {
  const iv = (startMin: number, endMin: number) => ({ startMin, endMin });

  it('stacks overlapping intervals in columns and lets free items span', () => {
    const items = [iv(0, 60), iv(10, 20), iv(30, 50), iv(70, 80)];
    const laid = layoutColumns(items, (x) => x);
    const byStart = new Map(laid.map((l) => [l.item.startMin, l]));
    expect(byStart.get(0)).toMatchObject({ column: 0, columns: 2 });
    expect(byStart.get(10)).toMatchObject({ column: 1, columns: 2 });
    expect(byStart.get(30)).toMatchObject({ column: 1, columns: 2 });
    expect(byStart.get(70)).toMatchObject({ column: 0, columns: 1, span: 1 });
  });

  it('honours a minimum visual duration', () => {
    const laid = layoutColumns([iv(0, 1), iv(5, 6)], (x) => x, 10);
    expect(laid.every((l) => l.columns === 2)).toBe(true);
  });
});
