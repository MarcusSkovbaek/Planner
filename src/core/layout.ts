export interface Interval {
  startMin: number;
  endMin: number;
}

export interface LaidOut<T> {
  item: T;
  /** Zero-based column within its overlap cluster. */
  column: number;
  /** Number of columns in the cluster. */
  columns: number;
  /** How many columns this item may extend into to the right (≥ 1). */
  span: number;
}

/**
 * Calendar-style layout: overlapping intervals are placed in side-by-side columns.
 * `minDurationMin` makes tiny items occupy the space they visually take up.
 */
export function layoutColumns<T>(items: readonly T[], getInterval: (item: T) => Interval, minDurationMin = 0): LaidOut<T>[] {
  const prepared = items
    .map((item) => {
      const { startMin, endMin } = getInterval(item);
      return { item, startMin, endMin: Math.max(endMin, startMin + minDurationMin) };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const result: LaidOut<T>[] = [];
  let cluster: { entry: (typeof prepared)[number]; column: number }[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = columnEnds.length;
    for (const { entry, column } of cluster) {
      // Let an item expand right while the neighbouring columns are free during its interval.
      let span = 1;
      for (let c = column + 1; c < columns; c++) {
        const blocked = cluster.some(
          (o) => o.column === c && o.entry.startMin < entry.endMin && o.entry.endMin > entry.startMin,
        );
        if (blocked) break;
        span++;
      }
      result.push({ item: entry.item, column, columns, span });
    }
    cluster = [];
    columnEnds = [];
  };

  for (const entry of prepared) {
    if (entry.startMin >= clusterEnd && cluster.length) flush();
    let column = columnEnds.findIndex((end) => end <= entry.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(entry.endMin);
    } else {
      columnEnds[column] = entry.endMin;
    }
    cluster.push({ entry, column });
    clusterEnd = cluster.length === 1 ? entry.endMin : Math.max(clusterEnd, entry.endMin);
  }
  if (cluster.length) flush();
  return result;
}
