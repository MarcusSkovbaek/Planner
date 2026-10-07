import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Briefcase, CalendarPlus, Copy, EyeOff, Layers, Lock, LockOpen, MousePointerClick, Pencil, Plus, Trash2 } from 'lucide-react';
import { blockMinutes } from '@core/activity/aggregate';
import { appDisplayName } from '@core/activity/apps';
import { layoutColumns } from '@core/layout';
import type { TimeEntry } from '@core/model';
import { clamp, dateKeyOf, formatClock, MINUTES_PER_DAY, minuteOfDay, snapMinutes } from '@core/time';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';
import { openContextMenu } from '@/state/contextMenu';
import { toast } from '@/state/toast';
import { useI18n } from '@/lib/i18n';
import { useNow } from '@/lib/useNow';
import { cx } from '@/lib/cx';
import { timeOfDay } from '@/lib/format';
import { computePosition } from '@/lib/position';
import { EmptyState } from '@/components/ui/controls';
import { Button } from '@/components/ui/Button';
import { KindIcon } from '@/components/shell/KindIcon';
import { CapturedCard, EntryCard, type EntryGesture } from './Cards';
import { CapturedFilter } from './CapturedFilter';
import { blankEntry, blockDurationMin, entryFromBlocks } from './entryFactory';
import { startGesture } from './gesture';
import type { BlockView, PlannerData } from './usePlannerData';

interface BlockDrag {
  blocks: BlockView[];
  durationMin: number;
  grabRatio: number;
  x: number;
  y: number;
  over: boolean;
  startMin: number;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function Board({ data, active }: { data: PlannerData; active: boolean }) {
  const { t, hours, duration, language } = useI18n();
  const settings = useApp((s) => s.settings);
  const matters = useApp((s) => s.matters);
  const updateSettings = useApp((s) => s.updateSettings);
  const selectedEntryIds = usePlanner((s) => s.selectedEntryIds);
  const selectedBlockIds = usePlanner((s) => s.selectedBlockIds);
  const editingId = usePlanner((s) => s.editingId);
  const activitiesDate = usePlanner((s) => s.activitiesDate);
  const loading = usePlanner((s) => s.loading);
  const { selectEntry, selectBlocks, clearSelection, createEntries, updateEntry, openEditor, duplicateEntry, deleteEntries, setStatus, deleteActivities } =
    usePlanner.getState();

  const { hourHeight } = settings.planner;
  const pxPerMin = hourHeight / 60;
  const inc = settings.timesheet.incrementMin;
  const { date } = data;
  const now = useNow(30_000);
  const isToday = date === dateKeyOf(now);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<BlockDrag | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [drag, setDrag] = useState<BlockDrag | null>(null);
  const [entryPreview, setEntryPreview] = useState<{ id: string; startMin: number; endMin: number } | null>(null);
  const [createPreview, setCreatePreview] = useState<{ startMin: number; endMin: number } | null>(null);
  const [hover, setHover] = useState<{ block: BlockView; rect: DOMRect } | null>(null);

  const minuteAt = useCallback(
    (clientY: number) => {
      const el = entriesRef.current;
      return el ? (clientY - el.getBoundingClientRect().top) / pxPerMin : 0;
    },
    [pxPerMin],
  );

  // ── Scroll: jump to the working day (or "now") when a day is opened; keep the centre on zoom. ──
  const scrolledFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !activitiesDate || !active || scrolledFor.current === activitiesDate) return;
    scrolledFor.current = activitiesDate;
    const viewMin = el.clientHeight / pxPerMin;
    const firstItem = Math.min(
      ...data.dayEntries.map((e) => e.startMin),
      ...data.blocks.map((b) => blockMinutes(b).startMin),
      MINUTES_PER_DAY,
    );
    let target = settings.timesheet.dayStartHour * 60 - 30;
    if (firstItem < target + 20) target = firstItem - 20;
    if (activitiesDate === dateKeyOf(Date.now())) {
      const nowMin = minuteOfDay(Date.now());
      if (nowMin > target + viewMin * 0.75) target = nowMin - viewMin * 0.72;
    }
    el.scrollTop = Math.max(0, target * pxPerMin);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activitiesDate, active]);

  // Bring the edited entry into view (e.g. when opened from the list view).
  useEffect(() => {
    const el = scrollerRef.current;
    const entry = editingId ? data.dayEntries.find((e) => e.id === editingId) : undefined;
    if (!el || !entry || !active) return;
    const top = entry.startMin * pxPerMin;
    const bottom = entry.endMin * pxPerMin;
    const headerHeight = 40;
    if (top < el.scrollTop + headerHeight || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, top - 120), behavior: 'smooth' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, active]);

  const prevHourHeight = useRef(hourHeight);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const prev = prevHourHeight.current;
    prevHourHeight.current = hourHeight;
    if (!el || prev === hourHeight) return;
    const centre = el.scrollTop + el.clientHeight / 2;
    el.scrollTop = (centre * hourHeight) / prev - el.clientHeight / 2;
  }, [hourHeight]);

  // ── Layout ──
  const shownEntries = useMemo(
    () => data.dayEntries.map((e) => (entryPreview?.id === e.id ? { ...e, startMin: entryPreview.startMin, endMin: entryPreview.endMin } : e)),
    [data.dayEntries, entryPreview],
  );
  const entryLayout = useMemo(() => layoutColumns(shownEntries, (e) => e, 22 / pxPerMin), [shownEntries, pxPerMin]);
  const blockLayout = useMemo(() => layoutColumns(data.blocks, (b) => blockMinutes(b), 22 / pxPerMin), [data.blocks, pxPerMin]);

  // ── Entry gestures ──
  const onEntryPointerDown = useCallback(
    (event: React.PointerEvent, entry: TimeEntry, gesture: EntryGesture) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const locked = entry.status === 'released';
      const toggle = event.ctrlKey || event.metaKey;
      const grab = minuteAt(event.clientY) - entry.startMin;
      const length = entry.endMin - entry.startMin;
      let next = { startMin: entry.startMin, endMin: entry.endMin };
      startGesture(event, {
        scroller: scrollerRef.current,
        cursor: locked ? 'not-allowed' : gesture === 'move' ? 'grabbing' : 'ns-resize',
        onMove: (_x, y) => {
          if (locked) return;
          const m = minuteAt(y);
          if (gesture === 'move') {
            const start = clamp(snapMinutes(m - grab, inc, 'round'), 0, MINUTES_PER_DAY - length);
            next = { startMin: start, endMin: start + length };
          } else if (gesture === 'resize-start') {
            next = { startMin: clamp(snapMinutes(m, inc, 'round'), 0, entry.endMin - inc), endMin: entry.endMin };
          } else {
            next = { startMin: entry.startMin, endMin: clamp(snapMinutes(m, inc, 'round'), entry.startMin + inc, MINUTES_PER_DAY) };
          }
          setEntryPreview({ id: entry.id, ...next });
        },
        onEnd: (_x, _y, moved) => {
          if (moved && !locked) {
            if (next.startMin !== entry.startMin || next.endMin !== entry.endMin) void updateEntry(entry.id, next, { undoable: true });
            setEntryPreview(null);
          } else if (!moved) {
            selectEntry(entry.id, toggle ? 'toggle' : 'replace');
          }
        },
        onCancel: () => setEntryPreview(null),
      });
    },
    [inc, minuteAt, selectEntry, updateEntry],
  );

  const onEntriesBackgroundPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const anchor = clamp(snapMinutes(minuteAt(event.clientY), inc, 'floor'), 0, MINUTES_PER_DAY - inc);
    let range = { startMin: anchor, endMin: anchor + inc };
    startGesture(event, {
      scroller: scrollerRef.current,
      cursor: 'ns-resize',
      onMove: (_x, y) => {
        const m = minuteAt(y);
        range =
          m >= anchor
            ? { startMin: anchor, endMin: clamp(snapMinutes(m, inc, 'ceil'), anchor + inc, MINUTES_PER_DAY) }
            : { startMin: clamp(snapMinutes(m, inc, 'floor'), 0, anchor), endMin: anchor + inc };
        setCreatePreview(range);
      },
      onEnd: (_x, _y, moved) => {
        setCreatePreview(null);
        if (moved) void createEntries([blankEntry(date, range.startMin, settings, range.endMin - range.startMin)], { edit: true });
        else clearSelection();
      },
      onCancel: () => setCreatePreview(null),
    });
  };

  const onEntriesDoubleClick = (event: React.MouseEvent) => {
    if (event.target !== event.currentTarget) return;
    void createEntries([blankEntry(date, minuteAt(event.clientY), settings)], { edit: true });
  };

  const onEntryContextMenu = useCallback(
    (event: React.MouseEvent, entry: TimeEntry) => {
      const locked = entry.status === 'released';
      if (!usePlanner.getState().selectedEntryIds.includes(entry.id)) selectEntry(entry.id);
      openContextMenu(event, [
        { label: t('common.edit'), icon: <Pencil />, onSelect: () => openEditor(entry.id) },
        { label: t('planner.duplicate'), icon: <Copy />, shortcut: 'Ctrl+D', onSelect: () => void duplicateEntry(entry.id) },
        locked
          ? { label: t('planner.reopen'), icon: <LockOpen />, onSelect: () => void setStatus([entry.id], 'draft') }
          : { label: t('planner.release'), icon: <Lock />, shortcut: 'Ctrl+Enter', onSelect: () => void setStatus([entry.id], 'released') },
        { type: 'separator' },
        { label: t('common.delete'), icon: <Trash2 />, shortcut: 'Del', danger: true, disabled: locked, onSelect: () => void deleteEntries([entry.id]) },
      ]);
    },
    [t, selectEntry, openEditor, duplicateEntry, setStatus, deleteEntries],
  );

  // ── Captured block gestures ──
  const onBlockPointerDown = useCallback(
    (event: React.PointerEvent, block: BlockView) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const toggle = event.ctrlKey || event.metaKey;
      const add = event.shiftKey;
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const grabRatio = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
      const selectedIds = usePlanner.getState().selectedBlockIds;
      const group = selectedIds.includes(block.id) ? data.blocks.filter((b) => selectedIds.includes(b.id)) : [block];
      const durationMin = blockDurationMin(group, settings);
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      setHover(null);

      startGesture(event, {
        scroller: scrollerRef.current,
        cursor: 'grabbing',
        threshold: 5,
        onMove: (x, y) => {
          const col = entriesRef.current?.getBoundingClientRect();
          const scroller = scrollerRef.current?.getBoundingClientRect();
          const over = !!col && !!scroller && x >= col.left && x <= col.right && y >= scroller.top && y <= scroller.bottom;
          const startMin = clamp(snapMinutes(minuteAt(y) - grabRatio * durationMin, inc, 'round'), 0, MINUTES_PER_DAY - durationMin);
          const next: BlockDrag = { blocks: group, durationMin, grabRatio, x, y, over, startMin };
          dragRef.current = next;
          setDrag(next);
        },
        onEnd: (_x, _y, moved) => {
          const current = dragRef.current;
          dragRef.current = null;
          setDrag(null);
          if (!moved) {
            selectBlocks([block.id], toggle ? 'toggle' : add ? 'add' : 'replace');
            return;
          }
          if (current?.over) {
            void createEntries([entryFromBlocks(current.blocks, { date, settings, matters, startMin: current.startMin })], { edit: true });
          }
        },
        onCancel: () => {
          dragRef.current = null;
          setDrag(null);
        },
      });
    },
    [data.blocks, settings, matters, date, inc, minuteAt, selectBlocks, createEntries],
  );

  const onBlockDoubleClick = useCallback(
    (block: BlockView) => {
      void createEntries([entryFromBlocks([block], { date, settings, matters })], { edit: true });
    },
    [createEntries, date, settings, matters],
  );

  const onBlockContextMenu = useCallback(
    (event: React.MouseEvent, block: BlockView) => {
      const state = usePlanner.getState();
      const group = state.selectedBlockIds.includes(block.id) ? data.blocks.filter((b) => state.selectedBlockIds.includes(b.id)) : [block];
      if (!state.selectedBlockIds.includes(block.id)) selectBlocks([block.id]);
      const appName = appDisplayName(block.app, language, block.appName);
      openContextMenu(event, [
        {
          label: group.length > 1 ? t('planner.combine') : t('planner.createEntry'),
          icon: <CalendarPlus />,
          onSelect: () => void createEntries([entryFromBlocks(group, { date, settings, matters })], { edit: true }),
        },
        ...(group.length > 1
          ? [
              {
                label: t('planner.createEntries', { n: group.length }),
                icon: <Layers />,
                onSelect: () => void createEntries(group.map((b) => entryFromBlocks([b], { date, settings, matters })), { edit: false }),
              },
            ]
          : []),
        {
          label: t('planner.selectSameApp', { app: appName }),
          icon: <MousePointerClick />,
          onSelect: () => selectBlocks(data.blocks.filter((b) => b.app === block.app).map((b) => b.id)),
        },
        { type: 'separator' },
        {
          label: t('planner.excludeApp', { app: appName }),
          icon: <EyeOff />,
          onSelect: () => {
            const excluded = [...new Set([...settings.tracking.excludedApps, block.app])];
            void updateSettings({ tracking: { excludedApps: excluded } }).then(() =>
              toast({ message: t('toast.appExcluded', { app: appName }) }),
            );
          },
        },
        {
          label: t('planner.deleteCaptured'),
          icon: <Trash2 />,
          danger: true,
          onSelect: () => void deleteActivities(group.flatMap((b) => b.segmentIds)),
        },
      ]);
    },
    [data.blocks, language, t, selectBlocks, createEntries, date, settings, matters, updateSettings, deleteActivities],
  );

  const onEntryActivate = useCallback((entry: TimeEntry, toggle: boolean) => selectEntry(entry.id, toggle ? 'toggle' : 'replace'), [selectEntry]);
  const onBlockActivate = useCallback((block: BlockView, toggle: boolean) => selectBlocks([block.id], toggle ? 'toggle' : 'replace'), [selectBlocks]);

  const onBlockHover = useCallback((block: BlockView | null, element?: HTMLElement) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (!block || !element || document.body.classList.contains('is-dragging')) {
      setHover(null);
      return;
    }
    hoverTimer.current = setTimeout(() => setHover({ block, rect: element.getBoundingClientRect() }), 550);
  }, []);

  const dayStart = settings.timesheet.dayStartHour * 60;
  const dayEnd = settings.timesheet.dayEndHour * 60;
  const nowMin = minuteOfDay(now);
  const capturedTotalMin = data.summary.capturedMs / 60_000;
  const selectedEntrySet = new Set(selectedEntryIds);
  const selectedBlockSet = new Set(selectedBlockIds);

  const offHours = (
    <>
      <div className="offhours" style={{ top: 0, height: dayStart * pxPerMin }} />
      <div className="offhours" style={{ top: dayEnd * pxPerMin, height: (MINUTES_PER_DAY - dayEnd) * pxPerMin }} />
    </>
  );

  return (
    <div className="board" style={{ '--hour-h': `${hourHeight}px` } as React.CSSProperties}>
      <div className="board-scroller" ref={scrollerRef} data-testid="board-scroller">
        <div className="board-head-row">
          <div className="board-head gutter-head" />
          <div className="board-head">
            <span className="board-head-title">{t('planner.entries')}</span>
            <span className="board-head-total tabular" data-testid="entries-total">
              {hours(data.summary.totalMin)}
            </span>
          </div>
          <div className="board-head">
            <span className="board-head-title">{t('planner.captured')}</span>
            <span className="board-head-total tabular">{hours(capturedTotalMin)}</span>
            <div className="board-head-spacer" />
            <CapturedFilter data={data} />
          </div>
        </div>

        <div className="board-body" style={{ height: MINUTES_PER_DAY * pxPerMin }}>
          <div className="gutter">
            {HOURS.map((h) => (
              <div key={h} className={cx('gutter-label tabular', (h * 60 < dayStart || h * 60 >= dayEnd) && 'off')} style={{ top: h * hourHeight }}>
                {h > 0 && formatClock(h * 60)}
              </div>
            ))}
            {isToday && (
              <div className="gutter-now tabular" style={{ top: nowMin * pxPerMin }}>
                {timeOfDay(now)}
              </div>
            )}
          </div>

          <div
            ref={entriesRef}
            className={cx('column entries-column', drag?.over && 'drop-active')}
            onPointerDown={onEntriesBackgroundPointerDown}
            onDoubleClick={onEntriesDoubleClick}
            data-testid="entries-column"
          >
            {offHours}
            {entryLayout.map((l) => (
              <EntryCard
                key={l.item.id}
                entry={l.item}
                matter={l.item.matterId ? data.matterById.get(l.item.matterId) : undefined}
                layout={l}
                pxPerMin={pxPerMin}
                selected={selectedEntrySet.has(l.item.id)}
                active={editingId === l.item.id || entryPreview?.id === l.item.id}
                onPointerDown={onEntryPointerDown}
                onContextMenu={onEntryContextMenu}
                onActivate={onEntryActivate}
              />
            ))}
            {createPreview && (
              <div className="ghost-range" style={{ top: createPreview.startMin * pxPerMin, height: (createPreview.endMin - createPreview.startMin) * pxPerMin }}>
                <span className="tabular">
                  {formatClock(createPreview.startMin)} – {formatClock(createPreview.endMin)} · {hours(createPreview.endMin - createPreview.startMin)}
                </span>
              </div>
            )}
            {drag?.over && (
              <div className="ghost-range drop" style={{ top: drag.startMin * pxPerMin, height: drag.durationMin * pxPerMin }}>
                <span className="tabular">
                  {formatClock(drag.startMin)} – {formatClock(drag.startMin + drag.durationMin)} · {hours(drag.durationMin)}
                </span>
              </div>
            )}
          </div>

          <div className="column captured-column" data-testid="captured-column" onPointerDown={(e) => e.button === 0 && clearSelection()}>
            {offHours}
            {blockLayout.map((l) => (
              <CapturedCard
                key={l.item.id}
                block={l.item}
                layout={l}
                pxPerMin={pxPerMin}
                selected={selectedBlockSet.has(l.item.id)}
                onPointerDown={onBlockPointerDown}
                onDoubleClick={onBlockDoubleClick}
                onContextMenu={onBlockContextMenu}
                onHover={onBlockHover}
                onActivate={onBlockActivate}
              />
            ))}
          </div>

          {isToday && (
            <div className="now-line" style={{ top: nowMin * pxPerMin }} aria-hidden="true">
              <span className="now-dot" />
            </div>
          )}
        </div>
      </div>

      {!loading && activitiesDate === date && !createPreview && !drag && (data.dayEntries.length === 0 || data.allBlocks.length === 0) && (
        <div className="board-empty" aria-live="polite">
          <div />
          <div className="board-empty-cell">
            {data.dayEntries.length === 0 &&
              (matters.length === 0 ? (
                <EmptyState
                  icon={<Briefcase />}
                  title={t('planner.onboardingTitle')}
                  text={t('planner.onboardingText')}
                  actions={
                    <Button variant="primary" icon={<Briefcase />} onClick={() => useApp.getState().setView('matters')}>
                      {t('planner.onboardingAction')}
                    </Button>
                  }
                />
              ) : (
                <EmptyState icon={<Plus />} title={t('planner.entriesEmptyTitle')} text={t('planner.entriesEmpty')} />
              ))}
          </div>
          <div className="board-empty-cell">
            {data.allBlocks.length === 0 && (
              <EmptyState
                icon={<Layers />}
                title={t('planner.capturedEmptyTitle')}
                text={isToday ? t('planner.capturedEmptyToday') : t('planner.capturedEmpty')}
              />
            )}
          </div>
        </div>
      )}

      {drag &&
        createPortal(
          <div className={cx('drag-ghost', `kind-${drag.blocks[0]!.kind}`, drag.over && 'over')} style={{ left: drag.x + 14, top: drag.y + 12 }}>
            <KindIcon kind={drag.blocks[0]!.kind} />
            <span className="truncate">{drag.blocks.length > 1 ? t('planner.selected', { n: drag.blocks.length }) : drag.blocks[0]!.subject}</span>
            <span className="drag-ghost-hours tabular">{hours(drag.durationMin)}</span>
          </div>,
          document.body,
        )}

      {hover && !drag && <BlockHoverCard block={hover.block} rect={hover.rect} />}
    </div>
  );
}

function BlockHoverCard({ block, rect }: { block: BlockView; rect: DOMRect }) {
  const { t, duration, language } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (ref.current) setPos(computePosition(rect, ref.current.getBoundingClientRect(), 'left-start', 10));
  }, [rect]);
  const appName = appDisplayName(block.app, language, block.appName);
  return createPortal(
    <div ref={ref} className={cx('hover-card', `kind-${block.kind}`)} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      <div className="hc-head">
        <span className="hc-icon">
          <KindIcon kind={block.kind} />
        </span>
        <div className="hc-title">
          <div className="hc-subject">{block.subject}</div>
          <div className="hc-sub">
            {t(`kinds.${block.kind}`)} · {appName}
          </div>
        </div>
      </div>
      <div className="hc-stats">
        <div>
          <span className="hc-label">{t('list.colTime')}</span>
          <span className="tabular">
            {timeOfDay(block.start)} – {timeOfDay(block.end)}
          </span>
        </div>
        <div>
          <span className="hc-label">{t('summary.captured')}</span>
          <span className="tabular">{duration(block.activeMs)}</span>
        </div>
        <div>
          <span className="hc-label">{t('summary.converted')}</span>
          <span className="tabular">{Math.round(block.converted * 100)}%</span>
        </div>
      </div>
      {block.titles.length > 0 && (
        <div className="hc-titles">
          <div className="hc-label">{t('planner.windowTitles')}</div>
          {block.titles.slice(0, 4).map((title) => (
            <div key={title} className="hc-window truncate">
              {title}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
