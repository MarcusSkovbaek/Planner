import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Copy, Link2Off, Lock, LockOpen, Trash2, X } from 'lucide-react';
import { buildCapturedBlocks } from '@core/activity/aggregate';
import { appDisplayName } from '@core/activity/apps';
import { suggestMatters } from '@core/matters';
import { BILLING_TYPES, type BillingType, type Matter, type TimeEntry } from '@core/model';
import { clamp, formatClock, MINUTES_PER_DAY, parseClock, roundDuration } from '@core/time';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';
import { useI18n } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import { fullDate, parseHoursInput } from '@/lib/format';
import { Button, IconButton } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/controls';
import { Popover } from '@/components/ui/Popover';
import { DatePicker } from '@/components/ui/DatePicker';
import { KindIcon } from '@/components/shell/KindIcon';
import { MatterPicker } from '@/features/matters/MatterPicker';
import { MatterEditorDialog } from '@/features/matters/MatterEditorDialog';
import type { PlannerData } from './usePlannerData';

const NARRATIVE_SAVE_DELAY = 450;

/** Side panel for editing the selected time entry. Changes save automatically. */
export function EntryEditor({ data }: { data: PlannerData }) {
  const editingId = usePlanner((s) => s.editingId);
  const entry = data.dayEntries.find((e) => e.id === editingId) ?? null;
  // Keep showing the last entry while the panel slides out.
  const last = useRef<TimeEntry | null>(null);
  if (entry) last.current = entry;
  const shown = entry ?? last.current;

  const asideRef = useRef<HTMLElement>(null);
  const open = !!entry;
  // A closing panel must not keep keyboard focus, or global shortcuts stop working.
  useEffect(() => {
    if (!open && asideRef.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }, [open]);

  return (
    <aside ref={asideRef} className={cx('editor', open && 'open')} aria-hidden={!open} inert={!open} data-testid="entry-editor">
      <div className="editor-inner">{shown && <EditorContent key={shown.id} entry={shown} data={data} visible={open} />}</div>
    </aside>
  );
}

function EditorContent({ entry, data, visible }: { entry: TimeEntry; data: PlannerData; visible: boolean }) {
  const { t, hoursValue, language, duration } = useI18n();
  const settings = useApp((s) => s.settings);
  const matters = useApp((s) => s.matters);
  const weekEntries = usePlanner((s) => s.entries);
  const { updateEntry, openEditor, setStatus, deleteEntries, duplicateEntry, focusEntry } = usePlanner.getState();
  const locked = entry.status === 'released';
  const inc = settings.timesheet.incrementMin;
  const minutes = entry.endMin - entry.startMin;

  // ── Narrative with debounced autosave ──
  const [narrative, setNarrative] = useState(entry.narrative);
  const [saving, setSaving] = useState(false);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const narrativeRef = useRef<HTMLTextAreaElement>(null);
  const latestNarrative = useRef(narrative);
  latestNarrative.current = narrative;

  const flushNarrative = () => {
    if (!pending.current) return;
    clearTimeout(pending.current);
    pending.current = null;
    void updateEntry(entry.id, { narrative: latestNarrative.current }).finally(() => setSaving(false));
  };

  useEffect(() => {
    if (!pending.current) setNarrative(entry.narrative);
  }, [entry.narrative]);

  useEffect(() => () => flushNarrative(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the narrative of freshly created entries so the user can type right away.
  // Done on the next frame (not after the slide-in) so focus never jumps unexpectedly.
  useEffect(() => {
    if (visible && Date.now() - entry.createdAt < 2500 && !locked) {
      const frame = requestAnimationFrame(() => {
        if (usePlanner.getState().editingId === entry.id) narrativeRef.current?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Time fields (committed on blur / Enter) ──
  const [startText, setStartText] = useState(formatClock(entry.startMin));
  const [endText, setEndText] = useState(formatClock(entry.endMin));
  const [hoursText, setHoursText] = useState(hoursValue(minutes));
  useEffect(() => {
    setStartText(formatClock(entry.startMin));
    setEndText(formatClock(entry.endMin));
    setHoursText(hoursValue(entry.endMin - entry.startMin));
  }, [entry.startMin, entry.endMin, hoursValue]);

  /** The newest version of this entry. Edits made in quick succession must build on each
   *  other, even before React has re-rendered with the previous one. */
  const latest = () => usePlanner.getState().entries.find((e) => e.id === entry.id) ?? entry;

  const commitTimes = (startMin: number, endMin: number) => {
    const current = latest();
    const start = clamp(Math.round(startMin), 0, MINUTES_PER_DAY - inc);
    const end = clamp(Math.round(endMin), start + 1, MINUTES_PER_DAY);
    if (start !== current.startMin || end !== current.endMin) void updateEntry(entry.id, { startMin: start, endMin: end }, { undoable: true });
    else {
      setStartText(formatClock(current.startMin));
      setEndText(formatClock(current.endMin));
      setHoursText(hoursValue(current.endMin - current.startMin));
    }
  };

  const commitStart = () => {
    const current = latest();
    const length = current.endMin - current.startMin;
    const parsed = parseClock(startText);
    if (parsed === null) return setStartText(formatClock(current.startMin));
    const start = Math.min(parsed, MINUTES_PER_DAY - length);
    commitTimes(start, start + length);
  };
  const commitEnd = () => {
    const current = latest();
    const parsed = parseClock(endText);
    if (parsed === null || parsed <= current.startMin) return setEndText(formatClock(current.endMin));
    commitTimes(current.startMin, current.startMin + roundDuration(parsed - current.startMin, inc, settings.timesheet.roundingMode));
  };
  const commitHours = () => {
    const current = latest();
    const h = parseHoursInput(hoursText);
    if (h === null || h <= 0) return setHoursText(hoursValue(current.endMin - current.startMin));
    const length = roundDuration(h * 60, inc, settings.timesheet.roundingMode);
    commitTimes(current.startMin, current.startMin + length);
  };
  const onEnter = (commit: () => void) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      (e.target as HTMLInputElement).blur();
    }
  };

  // ── Linked captured time & matter suggestions ──
  const sources = useMemo(() => {
    const ids = new Set(entry.activityIds);
    const segments = data.activities.filter((a) => ids.has(a.id));
    // Most-used first: the main document is what the entry is about.
    return buildCapturedBlocks(segments, { mergeGapMs: Number.MAX_SAFE_INTEGER }).sort((a, b) => b.activeMs - a.activeMs);
  }, [entry.activityIds, data.activities]);

  const suggestions = useMemo<Matter[]>(
    () => suggestMatters([narrative, ...sources.flatMap((s) => [s.subject, ...s.titles])], matters, 3).map((s) => s.matter),
    [narrative, sources, matters],
  );
  const recent = useMemo<Matter[]>(() => {
    const seen = new Set<string>();
    const out: Matter[] = [];
    for (const e of [...weekEntries].sort((a, b) => b.updatedAt - a.updatedAt)) {
      if (!e.matterId || seen.has(e.matterId)) continue;
      seen.add(e.matterId);
      const m = data.matterById.get(e.matterId);
      if (m) out.push(m);
      if (out.length >= 5) break;
    }
    return out;
  }, [weekEntries, data.matterById]);

  const [newMatterOpen, setNewMatterOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const dateRef = useRef<HTMLButtonElement>(null);

  const setMatter = (id: string | null) => {
    const matter = id ? data.matterById.get(id) : undefined;
    void updateEntry(entry.id, { matterId: id, ...(matter ? { billingType: matter.billingType } : {}) });
  };

  return (
    <div className="editor-content">
      <div className="editor-header">
        <span className={cx('pill', locked ? 'pill-released' : 'pill-draft')}>
          {locked ? <Lock /> : <span className="pill-dot" />}
          {t(`status.${entry.status}`)}
        </span>
        <span className={cx('editor-saved', saving && 'saving')}>{saving ? t('editor.saving') : t('editor.saved')}</span>
        <div className="editor-header-spacer" />
        <IconButton size="sm" label={t('common.close')} shortcut="Esc" icon={<X />} onClick={() => openEditor(null)} data-testid="editor-close" />
      </div>

      <div className="editor-scroll">
        <div className="editor-hero">
          <div className="hero-hours tabular">
            {hoursValue(minutes)}
            <span>{t('editor.hours')}</span>
          </div>
          <button ref={dateRef} type="button" className="hero-date" disabled={locked} onClick={() => setDateOpen((v) => !v)}>
            <CalendarDays />
            {fullDate(entry.date, language)} · <span className="tabular">{formatClock(entry.startMin)}–{formatClock(entry.endMin)}</span>
          </button>
          <Popover open={dateOpen} onClose={() => setDateOpen(false)} anchor={dateRef} placement="bottom-start">
            <DatePicker
              value={entry.date}
              onChange={(d) => {
                setDateOpen(false);
                if (d === entry.date) return;
                void updateEntry(entry.id, { date: d }, { undoable: true }).then(() => focusEntry(d, entry.id));
              }}
            />
          </Popover>
        </div>

        {locked && (
          <div className="editor-locked">
            <Lock />
            <span>{t('editor.lockedHint')}</span>
          </div>
        )}

        <div className="editor-field">
          <span className="field-label">{t('editor.matter')}</span>
          <MatterPicker
            value={entry.matterId}
            matters={matters}
            onChange={setMatter}
            suggestions={suggestions}
            recent={recent}
            disabled={locked}
            onCreateMatter={() => setNewMatterOpen(true)}
          />
        </div>

        <label className="editor-field">
          <span className="field-label">{t('editor.narrative')}</span>
          <textarea
            ref={narrativeRef}
            className="textarea"
            value={narrative}
            disabled={locked}
            placeholder={t('editor.narrativePlaceholder')}
            rows={4}
            spellCheck
            onChange={(e) => {
              setNarrative(e.target.value);
              setSaving(true);
              if (pending.current) clearTimeout(pending.current);
              pending.current = setTimeout(flushNarrative, NARRATIVE_SAVE_DELAY);
            }}
            onBlur={flushNarrative}
            data-testid="narrative"
          />
        </label>

        <div className="editor-times">
          <label className="editor-field">
            <span className="field-label">{t('editor.start')}</span>
            <input
              className="input tabular"
              value={startText}
              disabled={locked}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={commitStart}
              onKeyDown={onEnter(commitStart)}
              data-testid="start-input"
            />
          </label>
          <label className="editor-field">
            <span className="field-label">{t('editor.end')}</span>
            <input
              className="input tabular"
              value={endText}
              disabled={locked}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={commitEnd}
              onKeyDown={onEnter(commitEnd)}
              data-testid="end-input"
            />
          </label>
          <label className="editor-field">
            <span className="field-label">{t('editor.duration')}</span>
            <div className="input-group">
              <input
                className="input tabular"
                value={hoursText}
                disabled={locked}
                inputMode="decimal"
                onChange={(e) => setHoursText(e.target.value)}
                onBlur={commitHours}
                onKeyDown={onEnter(commitHours)}
                data-testid="hours-input"
              />
              <span className="input-suffix">{t('common.hoursShort')}</span>
            </div>
          </label>
        </div>

        <div className="editor-field">
          <span className="field-label">{t('editor.type')}</span>
          <Segmented<BillingType>
            full
            label={t('editor.type')}
            value={entry.billingType}
            onChange={(v) => !locked && void updateEntry(entry.id, { billingType: v })}
            options={BILLING_TYPES.map((b) => ({
              value: b,
              label: <span className={`billing-option billing-${b}`}>{t(`billing.${b}`)}</span>,
            }))}
            className={cx('billing-segmented', locked && 'disabled')}
          />
        </div>

        <div className="editor-field">
          <span className="field-label">
            {t('editor.sources')}
            {sources.length > 0 && <span className="field-count tabular">{duration(sources.reduce((s, b) => s + b.activeMs, 0))}</span>}
          </span>
          {sources.length ? (
            <div className="sources">
              {sources.map((s) => (
                <div key={s.id} className={`source kind-${s.kind}`}>
                  <span className="source-icon">
                    <KindIcon kind={s.kind} />
                  </span>
                  <span className="source-text">
                    <span className="source-subject truncate">{s.subject}</span>
                    <span className="source-meta">
                      {appDisplayName(s.app, language, s.appName)} · <span className="tabular">{duration(s.activeMs)}</span>
                    </span>
                  </span>
                  {!locked && (
                    <IconButton
                      size="sm"
                      label={t('common.delete')}
                      icon={<Link2Off />}
                      onClick={() => {
                        const remove = new Set(s.segmentIds);
                        void updateEntry(entry.id, { activityIds: latest().activityIds.filter((id) => !remove.has(id)) }, { undoable: true });
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="sources-empty">{t('editor.noSources')}</div>
          )}
        </div>
      </div>

      <div className="editor-footer">
        <IconButton label={t('editor.delete')} shortcut="Del" icon={<Trash2 />} variant="danger" disabled={locked} onClick={() => void deleteEntries([entry.id])} data-testid="editor-delete" />
        <IconButton label={t('editor.duplicate')} shortcut="Ctrl+D" icon={<Copy />} onClick={() => void duplicateEntry(entry.id)} />
        <div className="spacer" />
        {locked ? (
          <Button icon={<LockOpen />} onClick={() => void setStatus([entry.id], 'draft')} data-testid="editor-reopen">
            {t('editor.reopen')}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon={<Lock />}
            onClick={() => {
              flushNarrative();
              void setStatus([entry.id], 'released');
            }}
            data-testid="editor-release"
          >
            {t('editor.release')}
          </Button>
        )}
      </div>

      <MatterEditorDialog
        open={newMatterOpen}
        matter={null}
        onClose={() => setNewMatterOpen(false)}
        onSaved={(m) => {
          setNewMatterOpen(false);
          setMatter(m.id);
        }}
      />
    </div>
  );
}
