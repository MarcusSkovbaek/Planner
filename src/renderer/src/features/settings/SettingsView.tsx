import './settings.css';
import { useMemo, useRef, useState } from 'react';
import { ArrowUpCircle, Clock3, Database, Download, FolderOpen, Monitor, Moon, Plus, Radar, RefreshCw, Settings2, ShieldCheck, Sun, X } from 'lucide-react';
import { appDisplayName, appKeyFromProcess } from '@core/activity/apps';
import { BILLING_TYPES, type BillingType, type DeepPartial, type Settings, type UpdateStatus } from '@core/model';
import { INCREMENT_OPTIONS } from '@core/settings';
import { formatClock } from '@core/time';
import { api } from '@/api/client';
import { useApp } from '@/state/app';
import { useI18n, type TFunction } from '@/lib/i18n';
import { timeOfDay } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Segmented, Switch } from '@/components/ui/controls';
import { Popover } from '@/components/ui/Popover';

export function SettingsView() {
  const { t, language } = useI18n();
  const settings = useApp((s) => s.settings);
  const info = useApp((s) => s.info);
  const updateSettings = useApp((s) => s.updateSettings);
  const desktop = info.platform !== 'web';
  const update = (patch: DeepPartial<Settings>) => void updateSettings(patch);
  const { general, tracking, timesheet } = settings;

  const minutes = (n: number) => `${n} ${t('common.minutes')}`;

  return (
    <div className="page settings-page" data-testid="settings-view">
      <div className="page-inner settings-inner">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('settings.title')}</h1>
          </div>
        </div>

        <Section icon={<Settings2 />} title={t('settings.general')}>
          <Row label={t('settings.language')}>
            <Segmented
              label={t('settings.language')}
              value={general.language}
              onChange={(v) => update({ general: { language: v } })}
              options={[
                { value: 'da', label: 'Dansk' },
                { value: 'en', label: 'English' },
              ]}
              testId="language-switch"
            />
          </Row>
          <Row label={t('settings.theme')}>
            <Segmented
              label={t('settings.theme')}
              value={general.theme}
              onChange={(v) => update({ general: { theme: v } })}
              options={[
                { value: 'system', label: t('settings.themeSystem'), icon: <Monitor /> },
                { value: 'light', label: t('settings.themeLight'), icon: <Sun /> },
                { value: 'dark', label: t('settings.themeDark'), icon: <Moon /> },
              ]}
              testId="theme-switch"
            />
          </Row>
          {desktop && (
            <>
              <Row label={t('settings.launchAtLogin')} hint={t('settings.launchAtLoginHint')}>
                <Switch checked={general.launchAtLogin} label={t('settings.launchAtLogin')} onChange={(v) => update({ general: { launchAtLogin: v } })} />
              </Row>
              <Row label={t('settings.closeToTray')} hint={t('settings.closeToTrayHint')}>
                <Switch checked={general.closeToTray} label={t('settings.closeToTray')} onChange={(v) => update({ general: { closeToTray: v } })} />
              </Row>
            </>
          )}
        </Section>

        <Section icon={<Radar />} title={t('settings.tracking')}>
          <Row label={t('settings.trackingEnabled')} hint={t('settings.trackingEnabledHint')}>
            <Switch checked={tracking.enabled} label={t('settings.trackingEnabled')} onChange={(v) => update({ tracking: { enabled: v } })} testId="tracking-enabled" />
          </Row>
          <Row label={t('settings.showMeetings')} hint={t('settings.showMeetingsHint')}>
            <Switch
              checked={settings.calendar.enabled}
              label={t('settings.showMeetings')}
              onChange={(v) => update({ calendar: { enabled: v } })}
              testId="calendar-enabled"
            />
          </Row>
          <Row label={t('settings.idleThreshold')} hint={t('settings.idleThresholdHint')}>
            <NumberSelect value={tracking.idleThresholdMin} options={[2, 3, 5, 10, 15, 30]} format={minutes} onChange={(v) => update({ tracking: { idleThresholdMin: v } })} />
          </Row>
          <Row label={t('settings.mergeGap')} hint={t('settings.mergeGapHint')}>
            <NumberSelect value={tracking.mergeGapMin} options={[0, 2, 5, 10, 15, 30]} format={minutes} onChange={(v) => update({ tracking: { mergeGapMin: v } })} />
          </Row>
          <Row label={t('settings.minSegment')} hint={t('settings.minSegmentHint')}>
            <NumberSelect
              value={tracking.minSegmentSec}
              options={[0, 2, 3, 5, 10, 30]}
              format={(n) => `${n} ${t('common.seconds')}`}
              onChange={(v) => update({ tracking: { minSegmentSec: v } })}
            />
          </Row>
          <Row label={t('settings.excludedApps')} hint={t('settings.excludedAppsHint')} stacked>
            <ExcludedApps />
          </Row>
          <Row label={t('settings.retention')} hint={t('settings.retentionHint')}>
            <NumberSelect
              value={tracking.retentionDays}
              options={[30, 60, 90, 180, 365, 0]}
              format={(n) => (n ? `${n} ${t('common.days')}` : t('common.never'))}
              onChange={(v) => update({ tracking: { retentionDays: v } })}
            />
          </Row>
        </Section>

        <Section icon={<Clock3 />} title={t('settings.timesheet')}>
          <Row label={t('settings.increment')} hint={t('settings.incrementHint')}>
            <NumberSelect value={timesheet.incrementMin} options={[...INCREMENT_OPTIONS]} format={minutes} onChange={(v) => update({ timesheet: { incrementMin: v } })} />
          </Row>
          <Row label={t('settings.rounding')}>
            <Segmented
              label={t('settings.rounding')}
              value={timesheet.roundingMode}
              onChange={(v) => update({ timesheet: { roundingMode: v } })}
              options={[
                { value: 'up', label: t('settings.roundUp') },
                { value: 'nearest', label: t('settings.roundNearest') },
              ]}
            />
          </Row>
          <Row label={t('settings.dailyGoal')}>
            <NumberSelect
              value={timesheet.dailyGoalHours}
              options={[0, 4, 5, 6, 6.5, 7, 7.4, 7.5, 8, 9, 10]}
              format={(n) => (n ? `${n.toLocaleString(language === 'da' ? 'da-DK' : 'en-GB')} ${t('common.hoursShort')}` : t('common.off'))}
              onChange={(v) => update({ timesheet: { dailyGoalHours: v } })}
            />
          </Row>
          <Row label={t('settings.defaultType')}>
            <Segmented<BillingType>
              label={t('settings.defaultType')}
              value={timesheet.defaultBillingType}
              onChange={(v) => update({ timesheet: { defaultBillingType: v } })}
              options={BILLING_TYPES.map((b) => ({ value: b, label: t(`billing.${b}`) }))}
            />
          </Row>
          <Row label={t('settings.workday')} hint={t('settings.workdayHint')}>
            <div className="range-select">
              <NumberSelect
                value={timesheet.dayStartHour}
                options={Array.from({ length: 24 }, (_, h) => h)}
                format={(h) => formatClock(h * 60)}
                onChange={(v) => update({ timesheet: { dayStartHour: v, dayEndHour: Math.max(v + 1, timesheet.dayEndHour) } })}
              />
              <span className="muted">{t('settings.to')}</span>
              <NumberSelect
                value={timesheet.dayEndHour}
                options={Array.from({ length: 24 }, (_, h) => h + 1).filter((h) => h > timesheet.dayStartHour)}
                format={(h) => formatClock(h * 60)}
                onChange={(v) => update({ timesheet: { dayEndHour: v } })}
              />
            </div>
          </Row>
        </Section>

        <Section icon={<Database />} title={t('settings.data')}>
          <div className="privacy-note">
            <ShieldCheck />
            <span>{t('settings.privacyNote')}</span>
          </div>
          {desktop && info.dataPath && (
            <Row label={t('settings.dataFolder')} hint={<code className="path">{info.dataPath}</code>}>
              <Button icon={<FolderOpen />} onClick={() => void api().openDataFolder()}>
                {t('settings.openFolder')}
              </Button>
            </Row>
          )}
        </Section>

        <UpdatesSection />
      </div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section card">
      <h2 className="settings-section-title">
        <span className="ss-icon">{icon}</span>
        {title}
      </h2>
      <div className="settings-rows">{children}</div>
    </section>
  );
}

function Row({ label, hint, children, stacked }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; stacked?: boolean }) {
  return (
    <div className={`settings-row ${stacked ? 'stacked' : ''}`}>
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function NumberSelect({ value, options, format, onChange }: { value: number; options: number[]; format(n: number): string; onChange(v: number): void }) {
  const all = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <select className="select settings-select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {all.map((o) => (
        <option key={o} value={o}>
          {format(o)}
        </option>
      ))}
    </select>
  );
}

function ExcludedApps() {
  const { t, language } = useI18n();
  const excluded = useApp((s) => s.settings.tracking.excludedApps);
  const knownApps = useApp((s) => s.knownApps);
  const updateSettings = useApp((s) => s.updateSettings);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return knownApps
      .filter((a) => a.app !== 'planner' && !excluded.includes(a.app))
      .filter((a) => !q || a.app.includes(q) || a.appName.toLowerCase().includes(q))
      .slice(0, 12);
  }, [knownApps, excluded, query]);

  const add = (raw: string) => {
    const key = appKeyFromProcess(raw.trim());
    if (!key) return;
    void updateSettings({ tracking: { excludedApps: [...new Set([...excluded, key])] } });
    setQuery('');
    setOpen(false);
  };
  const remove = (key: string) => void updateSettings({ tracking: { excludedApps: excluded.filter((a) => a !== key) } });

  return (
    <div className="excluded">
      <div className="chips">
        {excluded.length === 0 && <span className="muted">{t('settings.noExcludedApps')}</span>}
        {excluded.map((app) => (
          <span key={app} className="chip">
            {appDisplayName(app, language)}
            <span className="chip-sub">{app}.exe</span>
            <button type="button" aria-label={t('common.delete')} onClick={() => remove(app)}>
              <X />
            </button>
          </span>
        ))}
      </div>
      <div className="input-group excluded-input" ref={wrapRef}>
        <Plus />
        <input
          ref={inputRef}
          className="input"
          value={query}
          placeholder={t('settings.addApp')}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              e.preventDefault();
              add(options[0] && !query.includes('.') && options[0].appName.toLowerCase().startsWith(query.toLowerCase()) ? options[0].app : query);
            }
          }}
          data-testid="exclude-input"
        />
        <Popover open={open && options.length > 0} onClose={() => setOpen(false)} anchor={wrapRef} placement="bottom-start" matchWidth>
          <div className="menu">
            {options.map((a) => (
              <button key={a.app} type="button" className="menu-item" onClick={() => add(a.app)}>
                <span className="truncate">{appDisplayName(a.app, language, a.appName)}</span>
                <span className="menu-shortcut">{a.app}.exe</span>
              </button>
            ))}
          </div>
        </Popover>
      </div>
    </div>
  );
}

const SECURITY_ERRORS = new Set(['INSECURE_URL', 'UNTRUSTED_KEY', 'SIGNATURE_INVALID', 'WRONG_TARGET', 'TOO_LARGE', 'SIZE_MISMATCH', 'HASH_MISMATCH']);

function updateStatusText(u: UpdateStatus, t: TFunction): string {
  const version = u.availableVersion ?? '';
  switch (u.state) {
    case 'checking':
      return t('update.checking');
    case 'up-to-date':
      return u.checkedAt ? `${t('update.upToDate')} · ${t('update.lastChecked', { time: timeOfDay(u.checkedAt) })}` : t('update.upToDate');
    case 'available':
      return t('update.available', { version });
    case 'downloading':
      return t('update.downloading', { version, percent: Math.round((u.progress ?? 0) * 100) });
    case 'ready':
      return t('update.ready', { version });
    case 'error':
      return t(`update.errors.${u.error ?? 'NETWORK'}`);
    case 'unsupported':
      return t('update.unsupported');
    case 'disabled':
      return t('update.disabled');
    default:
      return '';
  }
}

/** Version, update status and the only network-related setting of the app. */
function UpdatesSection() {
  const { t } = useI18n();
  const info = useApp((s) => s.info);
  const update = useApp((s) => s.update);
  const autoUpdate = useApp((s) => s.settings.general.autoUpdate);
  const updateSettings = useApp((s) => s.updateSettings);
  const [busy, setBusy] = useState(false);
  const active = update.state !== 'unsupported' && update.state !== 'disabled';
  const securityError = update.state === 'error' && SECURITY_ERRORS.has(update.error ?? '');

  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn().finally(() => setBusy(false));
  };

  return (
    <Section icon={<ArrowUpCircle />} title={t('update.title')}>
      <Row
        label={`${info.name} ${info.version}`}
        hint={<span className={securityError ? 'update-error' : undefined} data-testid="update-status">{updateStatusText(update, t)}</span>}
      >
        {update.state === 'ready' ? (
          <Button variant="primary" icon={<ArrowUpCircle />} disabled={busy} onClick={() => run(() => api().installUpdate())}>
            {t('update.install')}
          </Button>
        ) : update.state === 'available' ? (
          <Button variant="primary" icon={<Download />} disabled={busy} onClick={() => run(() => api().installUpdate())}>
            {t('update.download')}
          </Button>
        ) : active ? (
          <Button
            icon={<RefreshCw className={update.state === 'checking' ? 'spin' : undefined} />}
            disabled={busy || update.state === 'checking' || update.state === 'downloading'}
            onClick={() => run(() => api().checkForUpdates())}
            data-testid="check-updates"
          >
            {t('update.check')}
          </Button>
        ) : null}
      </Row>
      {active && (
        <Row label={t('update.autoUpdate')} hint={t('update.autoUpdateHint')}>
          <Switch checked={autoUpdate} label={t('update.autoUpdate')} onChange={(v) => void updateSettings({ general: { autoUpdate: v } })} />
        </Row>
      )}
      <div className="privacy-note subtle">
        <ShieldCheck />
        <span>{t('update.security')}</span>
      </div>
      {info.demo && <div className="settings-footnote">{t('settings.demoMode')}</div>}
    </Section>
  );
}
