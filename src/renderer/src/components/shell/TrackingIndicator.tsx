import { useRef, useState } from 'react';
import { Pause, Play, Power, ShieldCheck, Sparkles } from 'lucide-react';
import { parseActivity } from '@core/activity/parse';
import { appDisplayName } from '@core/activity/apps';
import { api } from '@/api/client';
import { useApp } from '@/state/app';
import { useI18n } from '@/lib/i18n';
import { timeOfDay } from '@/lib/format';
import { Popover } from '@/components/ui/Popover';
import { Button } from '@/components/ui/Button';
import { KindIcon } from './KindIcon';
import { useNow } from '@/lib/useNow';

/** Title bar pill showing what is being captured right now, with pause/resume controls. */
export function TrackingIndicator() {
  const { t, language, duration } = useI18n();
  const tracking = useApp((s) => s.tracking);
  const info = useApp((s) => s.info);
  const updateSettings = useApp((s) => s.updateSettings);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const now = useNow(15_000);

  const state = tracking.state;
  const current = tracking.current;
  const parsed = current ? parseActivity(current.app, current.title, current.appName) : null;
  const appName = current ? appDisplayName(current.app, language, current.appName) : '';

  const pause = (minutes: number | null) => {
    setOpen(false);
    void api().pauseTracking(minutes).then((status) => useApp.setState({ tracking: status }));
  };
  const resume = () => {
    setOpen(false);
    void api().resumeTracking().then((status) => useApp.setState({ tracking: status }));
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`tracking-pill state-${state}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="tracking-indicator"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tracking-dot" />
        <span className="tracking-label">{t(`tracking.state.${state}`)}</span>
        {state === 'active' && current && <span className="tracking-app truncate">{appName}</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref} placement="bottom-end" className="tracking-popover">
        <div className="tp-header">
          <span className="tp-title">{t('tracking.title')}</span>
          <span className={`pill tp-state state-${state}`}>
            <span className="tracking-dot" />
            {t(`tracking.state.${state}`)}
          </span>
        </div>

        <div className="tp-now">
          {state === 'active' && current && parsed ? (
            <div className={`tp-current kind-${parsed.kind}`}>
              <span className="tp-current-icon">
                <KindIcon kind={parsed.kind} />
              </span>
              <span className="tp-current-text">
                <span className="tp-current-subject truncate">{parsed.subject}</span>
                <span className="tp-current-meta">
                  {appName} · {t('tracking.since', { time: timeOfDay(current.since) })} · {duration(Math.max(0, now - current.since))}
                </span>
              </span>
            </div>
          ) : (
            <div className="tp-hint">
              {state === 'idle' && t('tracking.idleHint')}
              {state === 'paused' &&
                (tracking.pausedUntil ? t('tracking.pausedUntil', { time: timeOfDay(tracking.pausedUntil) }) : t('tracking.pausedIndefinitely'))}
              {state === 'disabled' && t('tracking.disabledHint')}
              {state === 'unavailable' && (
                <>
                  {t('tracking.unavailableHint')}
                  {tracking.message && <code className="tp-error">{tracking.message}</code>}
                </>
              )}
              {(state === 'active' || state === 'starting') && t('tracking.noWindow')}
            </div>
          )}
        </div>

        <div className="tp-actions">
          {state === 'paused' ? (
            <Button variant="primary" icon={<Play />} onClick={resume} data-testid="resume-tracking">
              {t('tracking.resume')}
            </Button>
          ) : state === 'disabled' ? (
            <Button
              variant="primary"
              icon={<Power />}
              onClick={() => {
                setOpen(false);
                void updateSettings({ tracking: { enabled: true } });
              }}
            >
              {t('tracking.enable')}
            </Button>
          ) : (
            <>
              <button type="button" className="tp-action" onClick={() => pause(15)} data-testid="pause-15">
                <Pause /> {t('tracking.pause15')}
              </button>
              <button type="button" className="tp-action" onClick={() => pause(60)}>
                <Pause /> {t('tracking.pause60')}
              </button>
              <button type="button" className="tp-action" onClick={() => pause(null)}>
                <Pause /> {t('tracking.pauseIndefinitely')}
              </button>
            </>
          )}
        </div>

        <div className="tp-footer">
          {info.demo ? <Sparkles /> : <ShieldCheck />}
          <span>{info.demo ? t('tracking.demo') : t('tracking.privacy')}</span>
        </div>
      </Popover>
    </>
  );
}
