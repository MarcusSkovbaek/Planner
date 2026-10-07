import { CalendarPlus, Layers, Lock, Trash2, X } from 'lucide-react';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';
import { useI18n } from '@/lib/i18n';
import { Button, IconButton } from '@/components/ui/Button';
import { entryFromBlocks } from './entryFactory';
import type { PlannerData } from './usePlannerData';

/** Floating action bar for multi-selections (captured blocks or entries). */
export function SelectionBar({ data }: { data: PlannerData }) {
  const { t, duration, hours } = useI18n();
  const settings = useApp((s) => s.settings);
  const matters = useApp((s) => s.matters);
  const selectedBlockIds = usePlanner((s) => s.selectedBlockIds);
  const selectedEntryIds = usePlanner((s) => s.selectedEntryIds);
  const { createEntries, clearSelection, setStatus, deleteEntries } = usePlanner.getState();

  const blocks = data.blocks.filter((b) => selectedBlockIds.includes(b.id));
  const entries = data.dayEntries.filter((e) => selectedEntryIds.includes(e.id));

  if (blocks.length > 0) {
    const activeMs = blocks.reduce((sum, b) => sum + b.activeMs, 0);
    const ctx = { date: data.date, settings, matters };
    return (
      <div className="selection-bar" data-testid="selection-bar">
        <span className="sb-count tabular">{t('planner.selected', { n: blocks.length })}</span>
        <span className="sb-meta tabular">{t('planner.activeTime', { duration: duration(activeMs) })}</span>
        <span className="sb-divider" />
        <Button
          variant="primary"
          size="sm"
          icon={<CalendarPlus />}
          onClick={() => void createEntries([entryFromBlocks(blocks, ctx)], { edit: true })}
          data-testid="create-from-selection"
        >
          {blocks.length > 1 ? t('planner.combine') : t('planner.createEntry')}
        </Button>
        {blocks.length > 1 && (
          <Button size="sm" variant="ghost" icon={<Layers />} onClick={() => void createEntries(blocks.map((b) => entryFromBlocks([b], ctx)), { edit: false })}>
            {t('planner.createEntries', { n: blocks.length })}
          </Button>
        )}
        <IconButton size="sm" label={t('planner.clearSelection')} shortcut="Esc" icon={<X />} onClick={clearSelection} />
      </div>
    );
  }

  if (entries.length > 1) {
    const minutes = entries.reduce((sum, e) => sum + (e.endMin - e.startMin), 0);
    const drafts = entries.filter((e) => e.status === 'draft');
    return (
      <div className="selection-bar" data-testid="selection-bar">
        <span className="sb-count tabular">{t('planner.selected', { n: entries.length })}</span>
        <span className="sb-meta tabular">{hours(minutes)}</span>
        <span className="sb-divider" />
        <Button size="sm" variant="primary" icon={<Lock />} disabled={!drafts.length} onClick={() => void setStatus(drafts.map((e) => e.id), 'released')}>
          {t('planner.release')}
        </Button>
        <Button size="sm" variant="danger" icon={<Trash2 />} disabled={!drafts.length} onClick={() => void deleteEntries(drafts.map((e) => e.id))}>
          {t('common.delete')}
        </Button>
        <IconButton size="sm" label={t('planner.clearSelection')} shortcut="Esc" icon={<X />} onClick={clearSelection} />
      </div>
    );
  }
  return null;
}
