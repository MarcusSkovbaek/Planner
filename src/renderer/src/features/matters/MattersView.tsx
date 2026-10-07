import './matters.css';
import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Plus, Search, Upload } from 'lucide-react';
import { entryMinutes } from '@core/entries';
import { matterCode } from '@core/matters';
import type { Matter } from '@core/model';
import { addDays, dateKeyOf } from '@core/time';
import { api } from '@/api/client';
import { useApp } from '@/state/app';
import { useI18n } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import { Button } from '@/components/ui/Button';
import { EmptyState, Switch } from '@/components/ui/controls';
import { MatterEditorDialog } from './MatterEditorDialog';
import { ImportDialog } from './ImportDialog';
import { matchesQuery } from './MatterPicker';

export function MattersView() {
  const { t, hoursValue } = useI18n();
  const matters = useApp((s) => s.matters);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Matter | null | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [minutesByMatter, setMinutesByMatter] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const today = dateKeyOf(Date.now());
    const load = () =>
      void api()
        .getEntries(addDays(today, -29), today)
        .then((entries) => {
          const map = new Map<string, number>();
          for (const e of entries) if (e.matterId) map.set(e.matterId, (map.get(e.matterId) ?? 0) + entryMinutes(e));
          setMinutesByMatter(map);
        });
    load();
    return api().subscribe((event) => event.type === 'entries' && load());
  }, []);

  const archivedCount = matters.filter((m) => m.archived).length;
  const visible = useMemo(
    () =>
      matters
        .filter((m) => (showArchived || !m.archived) && matchesQuery(m, query))
        .sort((a, b) => Number(a.archived) - Number(b.archived) || matterCode(a).localeCompare(matterCode(b))),
    [matters, showArchived, query],
  );

  return (
    <div className="page" data-testid="matters-view">
      <div className="page-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('matters.title')}</h1>
            <div className="page-subtitle tabular">{t('matters.count', { n: matters.length - archivedCount })}</div>
          </div>
          <div className="page-actions">
            <Button icon={<Upload />} onClick={() => setImportOpen(true)} data-testid="import-matters">
              {t('matters.import')}
            </Button>
            <Button variant="primary" icon={<Plus />} onClick={() => setEditing(null)} data-testid="new-matter">
              {t('matters.newMatter')}
            </Button>
          </div>
        </div>

        {matters.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Briefcase />}
              title={t('matters.empty')}
              text={t('matters.emptyHint')}
              actions={
                <>
                  <Button icon={<Upload />} onClick={() => setImportOpen(true)}>
                    {t('matters.import')}
                  </Button>
                  <Button variant="primary" icon={<Plus />} onClick={() => setEditing(null)}>
                    {t('matters.newMatter')}
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          <>
            <div className="list-controls">
              <div className="input-group matters-search">
                <Search />
                <input className="input" value={query} placeholder={t('matters.searchPlaceholder')} onChange={(e) => setQuery(e.target.value)} data-testid="matters-search" />
              </div>
              <div className="list-controls-spacer" />
              {archivedCount > 0 && (
                <label className="toggle-label">
                  <Switch checked={showArchived} onChange={setShowArchived} label={t('matters.showArchived')} />
                  {t('matters.showArchived')} <span className="muted tabular">({archivedCount})</span>
                </label>
              )}
            </div>
            <div className="card list-card">
              {visible.length === 0 ? (
                <EmptyState icon={<Search />} title={t('matters.noMatch')} />
              ) : (
                <table className="table matters-table">
                  <thead>
                    <tr>
                      <th className="col-code">{t('matters.colCode')}</th>
                      <th>{t('matters.colClient')}</th>
                      <th>{t('matters.colMatter')}</th>
                      <th className="col-type">{t('matters.colType')}</th>
                      <th>{t('matters.colKeywords')}</th>
                      <th className="col-hours">{t('matters.colHours')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((m) => (
                      <tr
                        key={m.id}
                        className={cx('entry-row', m.archived && 'archived', `matter-c${m.color}`)}
                        onClick={() => setEditing(m)}
                        onKeyDown={(e) => e.key === 'Enter' && setEditing(m)}
                        tabIndex={0}
                        data-testid="matter-row"
                      >
                        <td className="col-code tabular">
                          <span className="lm">
                            <span className="matter-dot" />
                            {matterCode(m)}
                          </span>
                        </td>
                        <td className="strong">{m.clientName || <span className="muted">—</span>}</td>
                        <td>
                          {m.matterName || <span className="muted">—</span>}
                          {m.archived && <span className="pill archived-pill">{t('matters.archived')}</span>}
                        </td>
                        <td className="col-type">
                          <span className={`pill pill-billing billing-${m.billingType}`}>{t(`billing.${m.billingType}`)}</span>
                        </td>
                        <td>
                          <div className="chips">
                            {m.keywords.slice(0, 4).map((k) => (
                              <span key={k} className="chip static">
                                {k}
                              </span>
                            ))}
                            {m.keywords.length > 4 && <span className="muted">+{m.keywords.length - 4}</span>}
                          </div>
                        </td>
                        <td className="col-hours tabular">{minutesByMatter.get(m.id) ? hoursValue(minutesByMatter.get(m.id)!) : <span className="muted">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
      <MatterEditorDialog open={editing !== undefined} matter={editing ?? null} onClose={() => setEditing(undefined)} />
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
