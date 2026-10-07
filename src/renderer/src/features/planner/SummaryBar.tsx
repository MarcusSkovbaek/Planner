import { useApp } from '@/state/app';
import { useI18n } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import type { PlannerData } from './usePlannerData';

/** Day totals – mirrors the metrics row of Intapp's planner, plus progress towards the daily goal. */
export function SummaryBar({ data }: { data: PlannerData }) {
  const { t, hoursValue, hours } = useI18n();
  const goalHours = useApp((s) => s.settings.timesheet.dailyGoalHours);
  const s = data.summary;
  const goalMin = goalHours * 60;
  const progress = goalMin ? Math.min(1, s.totalMin / goalMin) : 0;
  const capturedMin = s.capturedMs / 60_000;
  const convertedMin = s.convertedMs / 60_000;

  const metric = (key: string, label: string, minutes: number, color: string, testId?: string) => (
    <div className="metric" key={key} data-testid={testId}>
      <span className="metric-value tabular">
        <span className="metric-dot" style={{ background: color }} />
        {hoursValue(minutes)}
      </span>
      <span className="metric-label">{label}</span>
    </div>
  );

  const radius = 15;
  const circumference = 2 * Math.PI * radius;

  return (
    <footer className="summary-bar" data-testid="summary-bar">
      <div className="metric-group">
        {metric('unreleased', t('summary.unreleased'), s.unreleasedMin, 'var(--m-unreleased)', 'metric-unreleased')}
        {metric('released', t('summary.released'), s.releasedMin, 'var(--m-released)', 'metric-released')}
        {metric('converted', t('summary.converted'), convertedMin, 'var(--m-converted)')}
        {metric('captured', t('summary.captured'), capturedMin, 'var(--m-captured)')}
      </div>
      <div className="metric-divider" />
      <div className="metric-group">
        {metric('billable', t('summary.billable'), s.byBilling.billable, 'var(--m-billable)')}
        {metric('nonBillable', t('summary.nonBillable'), s.byBilling.nonBillable, 'var(--m-nonbillable)')}
        {metric('bd', t('summary.businessDevelopment'), s.byBilling.businessDevelopment, 'var(--m-bd)')}
      </div>
      <div className="summary-spacer" />
      <div className="summary-total">
        <span className="metric-label">{t('summary.total')}</span>
        <span className="summary-total-value tabular" data-testid="summary-total">
          {hours(s.totalMin)}
        </span>
      </div>
      {goalMin > 0 && (
        <div className={cx('goal', progress >= 1 && 'reached')} title={`${t('summary.goal')}: ${Math.round(progress * 100)}%`}>
          <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r={radius} className="goal-track" />
            <circle
              cx="20"
              cy="20"
              r={radius}
              className="goal-progress"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - progress)}
            />
          </svg>
          <div className="goal-text">
            <span className="goal-pct tabular">{Math.round(progress * 100)}%</span>
            <span className="metric-label">
              {progress >= 1 ? t('summary.goalReached') : `${t('summary.goal')} ${t('summary.goalOf', { goal: hours(goalMin, 1) })}`}
            </span>
          </div>
        </div>
      )}
    </footer>
  );
}
