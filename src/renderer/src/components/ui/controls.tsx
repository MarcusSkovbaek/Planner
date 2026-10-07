import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';

export function Switch({ checked, onChange, label, disabled, testId }: { checked: boolean; onChange(v: boolean): void; label: string; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
    />
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  full,
  label,
  className,
  testId,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange(value: T): void;
  full?: boolean;
  label: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cx('segmented', full && 'full', className)} role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          onKeyDown={(event) => {
            const index = options.findIndex((x) => x.value === value);
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
              event.preventDefault();
              onChange(options[(index + 1) % options.length]!.value);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              onChange(options[(index - 1 + options.length) % options.length]!.value);
            }
          }}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function EmptyState({ icon, title, text, actions, className }: { icon: ReactNode; title: ReactNode; text?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('empty', className)}>
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {actions && <div className="empty-actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('field', className)}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
