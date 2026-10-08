import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ListChecks, Lock, Search } from 'lucide-react';
import { entryMinutes } from '@core/entries';
import { matterCode } from '@core/matters';
import type { DateKey, EntryStatus, TimeEntry } from '@core/model';
import { addDays, addMonths, dateKeyOf, endOfMonth, formatClock, startOfMonth, startOfWeek } from '@core/time';
import { api } from '@/api/client';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';
import { toast } from '@/state/toast';
import { useI18n } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import { dayMonth, dayMonthShort, isoWeek, monthYear, weekdayLong } from '@/lib/format';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState, Segmented } from '@/components/ui/controls';
import { matchesQuery } from '@/features/matters/MatterPicker';

type Mode = 'week' | 'month';
type StatusFilter = 'all' | EntryStatus;

export function ListView() {
  const { t, language, hoursValue, hours } = useI18n();
  const matters = useApp((s) => s.matters);
  const setView = useApp((s) => s.setView);
  const [mode, setMode] = useState<Mode>('week');
  const [anchor, setAnchor] = useState<DateKey>(() => usePlanner.getState().date);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const from = mode === 'week' ? startOfWeek(anchor) : startOfMonth(anchor);
  const to = mode === 'week' ? addDays(from, 6) : endOfMonth(anchor);
  const matterById = useMemo(() => new Map(matters.map((m) => [m.id, m])), [matters]);

  const load = useCallback(() => {
    void api()
      .getEntries(from, to)
      .then(setEntries);
  }, [from, to]);

  useEffect(() => {
    setEntries(null);
    setSelected(new Set());
    load();
  }, [load]);

  useEffect(() => api().subscribe((event) => event.type === 'entries' && load()), [load]);

  const visible = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => {
      if (status !== 'all' && e.status !== status) return false;
      if (!query.trim()) return true;
      const m = e.matterId ? matterById.get(e.matterId) : undefined;
      return (m && matchesQuery(m, query)) || e.narrative.toLowerCase().includes(query.trim().toLowerCase());
    });
  }, [entries, status, query, matterById]);

  const byDay = useMemo(() => {
    const map = new Map<DateKey, TimeEntry[]>();
    for (const e of visible) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return [...map.entries()];
  }, [visible]);

  const totals = useMemo(() => {
    let total = 0;
    let billable = 0;
    let released = 0;
    for (const e of visible) {
      const min = entryMinutes(e);
      total += min;
      if (e.billingType === 'billable') billable += min;
      if (e.status === 'released') released += min;
    }
    return { total, billable, released };
  }, [visible]);

  const shift = (dir: 1 | -1) => setAnchor(mode === 'week' ? addDays(from, dir * 7) : addMonths(from, dir));
  const periodLabel =
    mode === 'week'
      ? `${t('common.week', { n: isoWeek(from) })} · ${dayMonthShort(from, language)} – ${dayMonth(to, language, true)}`
      : monthYear(from, language);

  const selectedDrafts = visible.filter((e) => selected.has(e.id) && e.status === 'draft');
  const allSelected = visible.length > 0 && visible.every((e) => selected.has(e.id));

  const release = async () => {
    const withMatter = selectedDrafts.filter((e) => e.matterId);
    const missing = selectedDrafts.length - withMatter.length;
    if (missing) toast({ tone: 'error', message: t('toast.missingMatterMany', { n: missing }) });
    if (!withMatter.length) return;
    const changed = await api().setEntryStatus(withMatter.map((e) => e.id), 'released');
    toast({ message: changed.length === 1 ? t('toast.released') : t('toast.releasedMany', { n: changed.length }) });
    setSelected(new Set());
  };

  const exportCsv = async () => {
    try {
      if (await api().exportEntries(from, to)) toast({ message: t('toast.exported') });
    } catch (err) {
      // Typically EBUSY: Excel locks a CSV it has open against writes.
      console.error(err);
      toast({ tone: 'error', message: t('toast.exportFailed') });
    }
  };

  const open = (e: TimeEntry) => {
    setView('planner');
    void usePlanner.getState().focusEntry(e.date, e.id);
  };

  return (
    <div className="page" data-testid="list-view">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('list.title')}</h1>
            <div className="page-subtitle">{periodLabel}</div>
          </div>
          <div className="page-actions">
            {selectedDrafts.length > 0 && (
              <Button icon={<Lock />} onClick={() => void release()}>
                {t('list.releaseSelected', { n: selectedDrafts.length })}
              </Button>
            )}
            <Button variant="primary" icon={<Download />} onClick={() => void exportCsv()} disabled={!entries?.length} data-testid="export-csv">
              {t('list.export')}
            </Button>
          </div>
        </div>

        <div className="list-controls">
          <Segmented<Mode>
            label={t('list.title')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'week', label: t('list.week') },
              { value: 'month', label: t('list.month') },
            ]}
          />
          <div className="period-nav">
            <IconButton size="sm" label={t('list.previous')} icon={<ChevronLeft />} onClick={() => shift(-1)} />
            <IconButton size="sm" label={t('list.next')} icon={<ChevronRight />} onClick={() => shift(1)} />
            <Button size="sm" variant="ghost" onClick={() => setAnchor(dateKeyOf(Date.now()))}>
              {t('common.today')}
            </Button>
          </div>
          <div className="list-controls-spacer" />
          <Segmented<StatusFilter>
            label={t('list.statusFilter')}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: t('common.all') },
              { value: 'draft', label: t('status.draft') },
              { value: 'released', label: t('status.released') },
            ]}
          />
          <div className="input-group list-search">
            <Search />
            <input className="input" value={query} placeholder={t('list.searchPlaceholder')} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className="card list-card">
          {entries === null ? (
            <div className="list-loading">
              <div className="spinner" />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={<ListChecks />} title={t('list.empty')} text={t('list.emptyHint')} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allSelected && visible.some((e) => selected.has(e.id));
                      }}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((e) => e.id)))}
                      aria-label={t('common.all')}
                    />
                  </th>
                  <th className="col-time">{t('list.colTime')}</th>
                  <th className="col-hours">{t('list.colDuration')}</th>
                  <th>{t('list.colMatter')}</th>
                  <th>{t('list.colNarrative')}</th>
                  <th className="col-type">{t('list.colType')}</th>
                  <th className="col-status">{t('list.colStatus')}</th>
                </tr>
              </thead>
              {byDay.map(([date, dayEntries]) => (
                <tbody key={date}>
                  <tr className="day-row">
                    <td colSpan={7}>
                      <span className="day-row-title">
                        {weekdayLong(date, language)} {dayMonth(date, language)}
                      </span>
                      <span className="day-row-total tabular">{hours(dayEntries.reduce((s, e) => s + entryMinutes(e), 0))}</span>
                    </td>
                  </tr>
                  {dayEntries.map((e) => {
                    const m = e.matterId ? matterById.get(e.matterId) : undefined;
                    return (
                      <tr key={e.id} className={cx('entry-row', selected.has(e.id) && 'selected')} onClick={() => open(e)} title={t('list.openInPlanner')} data-testid="list-row">
                        <td className="col-check" onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => {
                              const next = new Set(selected);
                              if (next.has(e.id)) next.delete(e.id);
                              else next.add(e.id);
                              setSelected(next);
                            }}
                          />
                        </td>
                        <td className="col-time tabular">
                          {formatClock(e.startMin)}–{formatClock(e.endMin)}
                        </td>
                        <td className="col-hours tabular">{hoursValue(entryMinutes(e))}</td>
                        <td className={cx('col-matter', m && `matter-c${m.color}`)}>
                          {m ? (
                            <span className="lm">
                              <span className="matter-dot" />
                              <span className="lm-text">
                                <span className="lm-name truncate">{m.clientName}</span>
                                <span className="lm-code tabular">
                                  {matterCode(m)} · {m.matterName}
                                </span>
                              </span>
                            </span>
                          ) : (
                            <span className="lm-missing">{t('planner.noMatter')}</span>
                          )}
                        </td>
                        <td className="col-narrative">
                          <span className="narrative-clamp">{e.narrative || <span className="muted">—</span>}</span>
                        </td>
                        <td className="col-type">
                          <span className={`pill pill-billing billing-${e.billingType}`}>{t(`billing.${e.billingType}`)}</span>
                        </td>
                        <td className="col-status">
                          <span className={cx('pill', e.status === 'released' ? 'pill-released' : 'pill-draft')}>
                            {e.status === 'released' ? <Lock /> : <span className="pill-dot" />}
                            {t(`status.${e.status}`)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          )}
          {visible.length > 0 && (
            <div className="list-footer">
              <span>{t('list.entriesCount', { n: visible.length })}</span>
              <span className="list-footer-spacer" />
              <span className="lf-metric">
                <span className="metric-dot" style={{ background: 'var(--m-billable)' }} />
                {t('summary.billable')} <strong className="tabular">{hours(totals.billable)}</strong>
              </span>
              <span className="lf-metric">
                <span className="metric-dot" style={{ background: 'var(--m-released)' }} />
                {t('summary.released')} <strong className="tabular">{hours(totals.released)}</strong>
              </span>
              <span className="lf-metric total">
                {t('list.total')} <strong className="tabular">{hours(totals.total)}</strong>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
