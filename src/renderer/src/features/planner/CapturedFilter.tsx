import { useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { ACTIVITY_KINDS, type ActivityKind } from '@core/model';
import { DEFAULT_SETTINGS } from '@core/settings';
import { useApp } from '@/state/app';
import { useI18n } from '@/lib/i18n';
import { Popover } from '@/components/ui/Popover';
import { Segmented, Switch } from '@/components/ui/controls';
import { Button } from '@/components/ui/Button';
import { KindIcon } from '@/components/shell/KindIcon';
import type { PlannerData } from './usePlannerData';

/** Filters for the captured column (persisted in settings). */
export function CapturedFilter({ data }: { data: PlannerData }) {
  const { t } = useI18n();
  const planner = useApp((s) => s.settings.planner);
  const updateSettings = useApp((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const presentKinds = useMemo(() => {
    const kinds = new Set<ActivityKind>(data.allBlocks.map((b) => b.kind));
    for (const k of planner.hiddenKinds) kinds.add(k);
    return ACTIVITY_KINDS.filter((k) => kinds.has(k));
  }, [data.allBlocks, planner.hiddenKinds]);

  const active =
    planner.hiddenKinds.length > 0 || !planner.showConverted || planner.minBlockMin !== DEFAULT_SETTINGS.planner.minBlockMin;

  const toggleKind = (kind: ActivityKind) => {
    const hidden = planner.hiddenKinds.includes(kind) ? planner.hiddenKinds.filter((k) => k !== kind) : [...planner.hiddenKinds, kind];
    void updateSettings({ planner: { hiddenKinds: hidden } });
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="filter-button"
        aria-expanded={open}
        data-active={active}
        onClick={() => setOpen((v) => !v)}
        data-testid="captured-filter"
      >
        <SlidersHorizontal />
        <span>{t('planner.filters')}</span>
        {data.hiddenCount > 0 && <span className="filter-count tabular">{data.hiddenCount}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} placement="bottom-end" className="filter-popover">
        <div className="fp-section">
          <div className="fp-row">
            <span>{t('planner.showConverted')}</span>
            <Switch
              checked={planner.showConverted}
              label={t('planner.showConverted')}
              onChange={(v) => void updateSettings({ planner: { showConverted: v } })}
            />
          </div>
        </div>
        <div className="fp-section">
          <div className="fp-label">{t('planner.hideShort')}</div>
          <Segmented
            full
            label={t('planner.hideShort')}
            value={String(planner.minBlockMin)}
            onChange={(v) => void updateSettings({ planner: { minBlockMin: Number(v) } })}
            options={[
              { value: '0', label: t('common.all') },
              { value: '2', label: '< 2 min' },
              { value: '5', label: '< 5 min' },
              { value: '15', label: '< 15 min' },
            ]}
          />
        </div>
        <div className="fp-section">
          <div className="fp-label">{t('planner.filterKinds')}</div>
          <div className="fp-kinds">
            {presentKinds.map((kind) => (
              <label key={kind} className={`fp-kind kind-${kind}`}>
                <input type="checkbox" className="checkbox" checked={!planner.hiddenKinds.includes(kind)} onChange={() => toggleKind(kind)} />
                <KindIcon kind={kind} />
                <span>{t(`kinds.${kind}`)}</span>
              </label>
            ))}
          </div>
        </div>
        {active && (
          <div className="fp-footer">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void updateSettings({
                  planner: {
                    hiddenKinds: [],
                    showConverted: true,
                    minBlockMin: DEFAULT_SETTINGS.planner.minBlockMin,
                  },
                })
              }
            >
              {t('common.reset')}
            </Button>
            {data.hiddenCount > 0 && <span className="muted">{t('planner.hiddenCount', { n: data.hiddenCount })}</span>}
          </div>
        )}
      </Popover>
    </>
  );
}
