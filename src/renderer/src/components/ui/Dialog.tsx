import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '@/lib/cx';
import { IconButton } from './Button';

interface DialogProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  closeLabel?: string;
  children: ReactNode;
  testId?: string;
}

/** Modal dialog with focus management. Escape and the backdrop close it. */
export function Dialog({ open, onClose, title, description, footer, width = 560, className, closeLabel = 'Luk', children, testId }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button:not([aria-label])');
    (first ?? ref.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key === 'Tab' && ref.current) {
        // Keep keyboard focus inside the dialog.
        const focusable = [...ref.current.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => !el.hasAttribute('disabled'),
        );
        if (!focusable.length) return;
        const firstEl = focusable[0]!;
        const lastEl = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="dialog-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={cx('dialog', className)} role="dialog" aria-modal="true" style={{ width: `min(${width}px, 100%)` }} tabIndex={-1} data-testid={testId}>
        <div className="dialog-header">
          <div>
            <div className="dialog-title">{title}</div>
            {description && <div className="dialog-description">{description}</div>}
          </div>
          <IconButton label={closeLabel} icon={<X />} size="sm" onClick={onClose} />
        </div>
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
