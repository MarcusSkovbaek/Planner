import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useToasts } from '@/state/toast';

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} data-testid="toast">
          {t.tone === 'error' ? <XCircle /> : t.tone === 'info' ? <Info /> : <CheckCircle2 />}
          <span className="toast-message">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                dismiss(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="Luk" onClick={() => dismiss(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
