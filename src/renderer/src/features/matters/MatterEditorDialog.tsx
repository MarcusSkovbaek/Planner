import './matters.css';
import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Check, Trash2, X } from 'lucide-react';
import { apiErrorCode, ApiErrorCode } from '@core/api';
import { BILLING_TYPES, MATTER_COLOR_COUNT, type BillingType, type Matter } from '@core/model';
import { useApp } from '@/state/app';
import { toast } from '@/state/toast';
import { useI18n } from '@/lib/i18n';
import { cx } from '@/lib/cx';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field, Segmented } from '@/components/ui/controls';

interface MatterEditorDialogProps {
  open: boolean;
  matter: Matter | null;
  onClose(): void;
  onSaved?(matter: Matter): void;
}

export function MatterEditorDialog({ open, matter, onClose, onSaved }: MatterEditorDialogProps) {
  const { t } = useI18n();
  const matters = useApp((s) => s.matters);
  const saveMatter = useApp((s) => s.saveMatter);
  const deleteMatter = useApp((s) => s.deleteMatter);
  const [form, setForm] = useState(() => toForm(matter, matters.length));
  const [keyword, setKeyword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(toForm(matter, matters.length));
      setKeyword('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matter]);

  const set = <K extends keyof ReturnType<typeof toForm>>(key: K, value: ReturnType<typeof toForm>[K]) => setForm((f) => ({ ...f, [key]: value }));

  const addKeyword = () => {
    const k = keyword.trim();
    if (k && !form.keywords.includes(k)) set('keywords', [...form.keywords, k]);
    setKeyword('');
  };

  const submit = async (overrides: Partial<Matter> = {}) => {
    if (!form.clientNumber.trim() || !form.matterNumber.trim()) {
      setError(t('matters.errorRequired'));
      return;
    }
    setBusy(true);
    try {
      const pendingKeyword = keyword.trim();
      const saved = await saveMatter({
        ...(matter ? { id: matter.id } : {}),
        ...form,
        keywords: pendingKeyword && !form.keywords.includes(pendingKeyword) ? [...form.keywords, pendingKeyword] : form.keywords,
        ...overrides,
      });
      toast({ message: overrides.archived ? t('toast.matterArchived') : t('toast.matterSaved') });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(apiErrorCode(err) === ApiErrorCode.MatterDuplicate ? t('matters.errorDuplicate') : t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!matter) return;
    setBusy(true);
    try {
      await deleteMatter(matter.id);
      toast({ message: t('toast.matterDeleted') });
      onClose();
    } catch (err) {
      setError(apiErrorCode(err) === ApiErrorCode.MatterInUse ? t('matters.errorInUse') : t('common.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={matter ? t('matters.editTitle') : t('matters.newTitle')}
      width={560}
      closeLabel={t('common.close')}
      testId="matter-dialog"
      footer={
        <>
          {matter && (
            <>
              <Button
                variant="ghost"
                icon={matter.archived ? <ArchiveRestore /> : <Archive />}
                disabled={busy}
                onClick={() => void submit({ archived: !matter.archived })}
              >
                {matter.archived ? t('matters.restore') : t('matters.archive')}
              </Button>
              <Button variant="danger" icon={<Trash2 />} disabled={busy} onClick={() => void remove()}>
                {t('common.delete')}
              </Button>
            </>
          )}
          <div className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={<Check />} disabled={busy} onClick={() => void submit()} data-testid="matter-save">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="matter-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('matters.clientNumber')}>
          <input className="input tabular" data-autofocus value={form.clientNumber} onChange={(e) => set('clientNumber', e.target.value)} data-testid="mf-client-number" />
        </Field>
        <Field label={t('matters.clientName')}>
          <input className="input" value={form.clientName} onChange={(e) => set('clientName', e.target.value)} data-testid="mf-client-name" />
        </Field>
        <Field label={t('matters.matterNumber')}>
          <input className="input tabular" value={form.matterNumber} onChange={(e) => set('matterNumber', e.target.value)} data-testid="mf-matter-number" />
        </Field>
        <Field label={t('matters.matterName')}>
          <input className="input" value={form.matterName} onChange={(e) => set('matterName', e.target.value)} data-testid="mf-matter-name" />
        </Field>
        <div className="field span-2">
          <span className="field-label">{t('matters.defaultType')}</span>
          <Segmented<BillingType>
            full
            label={t('matters.defaultType')}
            value={form.billingType}
            onChange={(v) => set('billingType', v)}
            options={BILLING_TYPES.map((b) => ({ value: b, label: t(`billing.${b}`) }))}
          />
        </div>
        <div className="field span-2">
          <span className="field-label">{t('matters.keywords')}</span>
          <div className="chip-input">
            {form.keywords.map((k) => (
              <span key={k} className="chip">
                {k}
                <button type="button" aria-label={t('common.delete')} onClick={() => set('keywords', form.keywords.filter((x) => x !== k))}>
                  <X />
                </button>
              </span>
            ))}
            <input
              value={keyword}
              placeholder={t('matters.keywordsPlaceholder')}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addKeyword();
                } else if (e.key === 'Backspace' && !keyword && form.keywords.length) {
                  set('keywords', form.keywords.slice(0, -1));
                }
              }}
              onBlur={addKeyword}
              data-testid="mf-keyword"
            />
          </div>
          <span className="field-hint">{t('matters.keywordsHint')}</span>
        </div>
        <div className="field span-2">
          <span className="field-label">{t('matters.color')}</span>
          <div className="swatches">
            {Array.from({ length: MATTER_COLOR_COUNT }, (_, i) => (
              <button
                key={i}
                type="button"
                className={cx('swatch', `matter-c${i}`)}
                aria-pressed={form.color === i}
                aria-label={`${t('matters.color')} ${i + 1}`}
                onClick={() => set('color', i)}
              />
            ))}
          </div>
        </div>
        {error && <div className="form-error span-2">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function toForm(matter: Matter | null, count: number) {
  return {
    clientNumber: matter?.clientNumber ?? '',
    clientName: matter?.clientName ?? '',
    matterNumber: matter?.matterNumber ?? '',
    matterName: matter?.matterName ?? '',
    billingType: matter?.billingType ?? ('billable' as BillingType),
    keywords: matter?.keywords ?? ([] as string[]),
    color: matter?.color ?? count % MATTER_COLOR_COUNT,
  };
}
