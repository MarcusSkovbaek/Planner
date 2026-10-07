import { memo } from 'react';
import { CheckCircle2, CircleDashed, Lock } from 'lucide-react';
import type { Matter, TimeEntry } from '@core/model';
import { matterCode } from '@core/matters';
import { formatClock } from '@core/time';
import { appDisplayName } from '@core/activity/apps';
import { blockMinutes } from '@core/activity/aggregate';
import type { LaidOut } from '@core/layout';
import { cx } from '@/lib/cx';
import { useI18n } from '@/lib/i18n';
import { KindIcon } from '@/components/shell/KindIcon';
import type { BlockView } from './usePlannerData';

export type EntryGesture = 'move' | 'resize-start' | 'resize-end';

const GAP = 3;

function horizontal(layout: Pick<LaidOut<unknown>, 'column' | 'columns' | 'span'>) {
  const left = (layout.column / layout.columns) * 100;
  const width = (layout.span / layout.columns) * 100;
  return { left: `calc(${left}% + ${GAP}px)`, width: `calc(${width}% - ${GAP * 2}px)` };
}

function sizeClass(height: number) {
  return height < 26 ? 'size-xs' : height < 46 ? 'size-sm' : height < 74 ? 'size-md' : 'size-lg';
}

interface EntryCardProps {
  entry: TimeEntry;
  matter?: Matter;
  layout: LaidOut<TimeEntry>;
  pxPerMin: number;
  selected: boolean;
  active: boolean;
  onPointerDown(event: React.PointerEvent, entry: TimeEntry, gesture: EntryGesture): void;
  onContextMenu(event: React.MouseEvent, entry: TimeEntry): void;
  onActivate(entry: TimeEntry, toggle: boolean): void;
}

export const EntryCard = memo(function EntryCard({ entry, matter, layout, pxPerMin, selected, active, onPointerDown, onContextMenu, onActivate }: EntryCardProps) {
  const { t, hoursValue, language } = useI18n();
  const top = entry.startMin * pxPerMin;
  const height = Math.max(18, (entry.endMin - entry.startMin) * pxPerMin - 2);
  const locked = entry.status === 'released';
  const minutes = entry.endMin - entry.startMin;
  // Show as many narrative lines as fit below the time and matter rows; never half a line.
  const narrativeLines = height >= 26 ? Math.max(0, Math.floor((height - 46) / 17)) : 0;

  return (
    <div
      className={cx(
        'entry-card',
        `status-${entry.status}`,
        matter ? `matter-c${matter.color}` : 'no-matter',
        sizeClass(height),
        selected && 'selected',
        active && 'active',
      )}
      style={{ top, height, ...horizontal(layout) }}
      data-testid="entry-card"
      data-entry-id={entry.id}
      onPointerDown={(e) => onPointerDown(e, entry, 'move')}
      onContextMenu={(e) => onContextMenu(e, entry)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onActivate(entry, e.ctrlKey || e.metaKey);
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${formatClock(entry.startMin)}–${formatClock(entry.endMin)} ${matter ? matterCode(matter) : t('planner.noMatter')}`}
    >
      {!locked && <div className="resize-handle start" onPointerDown={(e) => onPointerDown(e, entry, 'resize-start')} />}
      <div className="entry-body">
        <div className="entry-line">
          <span className="entry-time tabular">
            {formatClock(entry.startMin)} – {formatClock(entry.endMin)}
          </span>
          <span className="entry-duration tabular">
            {hoursValue(minutes, language === 'da' ? 2 : 2)} {t('common.hoursShort')}
          </span>
          {locked && <Lock className="entry-lock" aria-label={t('planner.locked')} />}
        </div>
        <div className="entry-matter">
          <span className="matter-dot" />
          {matter ? (
            <>
              <span className="entry-code tabular">{matterCode(matter)}</span>
              <span className="entry-matter-name truncate">{matter.clientName || matter.matterName}</span>
            </>
          ) : (
            <span className="entry-missing">{t('planner.noMatter')}</span>
          )}
        </div>
        {entry.narrative && narrativeLines > 0 && (
          <div className="entry-narrative" style={{ WebkitLineClamp: narrativeLines }}>
            {entry.narrative}
          </div>
        )}
      </div>
      {!locked && <div className="resize-handle end" onPointerDown={(e) => onPointerDown(e, entry, 'resize-end')} />}
    </div>
  );
});

interface CapturedCardProps {
  block: BlockView;
  layout: LaidOut<BlockView>;
  pxPerMin: number;
  selected: boolean;
  onPointerDown(event: React.PointerEvent, block: BlockView): void;
  onDoubleClick(block: BlockView): void;
  onContextMenu(event: React.MouseEvent, block: BlockView): void;
  onHover(block: BlockView | null, element?: HTMLElement): void;
  onActivate(block: BlockView, toggle: boolean): void;
}

export const CapturedCard = memo(function CapturedCard({ block, layout, pxPerMin, selected, onPointerDown, onDoubleClick, onContextMenu, onHover, onActivate }: CapturedCardProps) {
  const { t, duration, language } = useI18n();
  const { startMin, endMin } = blockMinutes(block);
  const top = startMin * pxPerMin;
  const height = Math.max(20, (endMin - startMin) * pxPerMin - 2);
  const inner = height - 8;
  const showMeta = inner >= 32;
  const subjectLines = Math.min(4, Math.max(1, Math.floor((inner - (showMeta ? 15 : 0)) / 16.2)));
  const converted = block.converted >= 0.98;
  const partly = !converted && block.converted > 0.02;
  const appName = appDisplayName(block.app, language, block.appName);

  return (
    <div
      className={cx(
        'captured-card',
        `kind-${block.kind}`,
        sizeClass(height),
        selected && 'selected',
        converted && 'converted',
        block.live && 'live',
      )}
      style={{ top, height, ...horizontal(layout) }}
      data-testid="captured-card"
      data-block-id={block.id}
      onPointerDown={(e) => onPointerDown(e, block)}
      onDoubleClick={() => onDoubleClick(block)}
      onContextMenu={(e) => onContextMenu(e, block)}
      onPointerEnter={(e) => onHover(block, e.currentTarget)}
      onPointerLeave={() => onHover(null)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          if (e.key === 'Enter' && selected) onDoubleClick(block);
          else onActivate(block, e.ctrlKey || e.metaKey);
        }
      }}
      tabIndex={0}
      role="button"
      aria-pressed={selected}
      aria-label={`${block.subject} – ${appName} – ${duration(block.activeMs)}`}
    >
      <div className="cc-head">
        <KindIcon kind={block.kind} className="cc-icon" />
        <span className="cc-subject" style={{ WebkitLineClamp: subjectLines }}>
          {block.subject}
        </span>
        {block.live && <span className="cc-live">{t('planner.live')}</span>}
        {converted && <CheckCircle2 className="cc-status" aria-label={t('planner.converted')} />}
        {partly && <CircleDashed className="cc-status partly" aria-label={t('planner.partlyConverted')} />}
      </div>
      {showMeta && (
        <div className="cc-meta truncate">
          {appName} · <span className="tabular">{duration(block.activeMs)}</span>
          {block.visits > 1 && <> · {t('planner.visits', { n: block.visits })}</>}
        </div>
      )}
    </div>
  );
});
