import './matters.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { parseCsv } from '@core/csv';
import { detectMatterColumns, MATTER_FIELDS, matterCode, rowsToMatters, type MatterField } from '@core/matters';
import { useApp } from '@/state/app';
import { toast } from '@/state/toast';
import { useI18n } from '@/lib/i18n';
import type { TranslationKey } from '@core/i18n';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';

const FIELD_LABELS: Record<MatterField, TranslationKey> = {
  clientNumber: 'matters.clientNumber',
  clientName: 'matters.clientName',
  matterNumber: 'matters.matterNumber',
  matterName: 'matters.matterName',
  code: 'matters.fieldCode',
  billingType: 'matters.fieldBillingType',
  keywords: 'matters.fieldKeywords',
};

/** Import matters from a CSV file or rows pasted from Excel, with column mapping and preview. */
export function ImportDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  // Fresh state for every opening; see MatterEditorDialog.
  return open ? <ImportForm onClose={onClose} /> : null;
}

function ImportForm({ onClose }: { onClose(): void }) {
  const open = true;
  const { t } = useI18n();
  const importMatters = useApp((s) => s.importMatters);
  const [text, setText] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<Record<MatterField, number> | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => (text.trim() ? parseCsv(text) : []), [text]);
  const columnCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const headers = hasHeader && rows[0] ? rows[0] : Array.from({ length: columnCount }, (_, i) => `#${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;

  useEffect(() => {
    if (!rows.length) {
      setMapping(null);
      return;
    }
    const detected = detectMatterColumns(hasHeader ? rows[0]! : []);
    // Without recognisable headers, assume the common order: client no, client, matter no, matter.
    if (!hasHeader || Object.values(detected).every((v) => v < 0)) {
      const guess = { clientNumber: 0, clientName: 1, matterNumber: 2, matterName: 3, code: -1, billingType: -1, keywords: -1 };
      for (const key of MATTER_FIELDS) if (guess[key] >= columnCount) guess[key] = -1;
      setMapping(guess);
    } else {
      setMapping(detected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, hasHeader]);

  const inputs = useMemo(() => (mapping ? rowsToMatters(body, mapping).filter((m) => m.clientNumber && m.matterNumber) : []), [body, mapping]);

  const readFile = async (file: File) => {
    const buffer = await file.arrayBuffer();
    let decoded = new TextDecoder('utf-8').decode(buffer);
    // Excel on Windows often saves CSV as Windows-1252; fall back when UTF-8 decoding fails.
    if (decoded.includes('�')) decoded = new TextDecoder('windows-1252').decode(buffer);
    setText(decoded);
  };

  const submit = async () => {
    if (!inputs.length) return;
    setBusy(true);
    try {
      const result = await importMatters(inputs);
      toast({ message: t('toast.imported', { added: result.added, updated: result.updated }) });
      onClose();
    } catch {
      toast({ tone: 'error', message: t('common.errorGeneric') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('matters.importTitle')}
      description={t('matters.importIntro')}
      width={760}
      closeLabel={t('common.close')}
      testId="import-dialog"
      footer={
        <>
          {rows.length > 0 && <span className="muted">{t('matters.rowsFound', { n: body.length })}</span>}
          <div className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={<Upload />} disabled={!inputs.length || busy} onClick={() => void submit()} data-testid="import-submit">
            {inputs.length ? t('matters.importCount', { n: inputs.length }) : t('matters.nothingToImport')}
          </Button>
        </>
      }
    >
      <div className="import">
        <div className="import-source">
          <Button icon={<FileUp />} onClick={() => fileRef.current?.click()}>
            {t('matters.chooseFile')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readFile(file);
              e.target.value = '';
            }}
            data-testid="import-file"
          />
          <span className="muted">{t('common.or')}</span>
        </div>
        <textarea
          className="textarea import-paste"
          value={text}
          placeholder={t('matters.pastePlaceholder')}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          data-testid="import-text"
        />

        {mapping && rows.length > 0 && (
          <>
            <label className="toggle-label">
              <input type="checkbox" className="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
              {t('matters.hasHeader')}
            </label>
            <div className="import-section-title">{t('matters.mapping')}</div>
            <div className="mapping">
              {MATTER_FIELDS.map((field) => (
                <label key={field} className="field">
                  <span className="field-label">{t(FIELD_LABELS[field])}</span>
                  <select
                    className="select"
                    value={mapping[field]}
                    onChange={(e) => setMapping({ ...mapping, [field]: Number(e.target.value) })}
                  >
                    <option value={-1}>{t('matters.notMapped')}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `#${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="import-section-title">{t('matters.preview')}</div>
            <div className="import-preview">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t('matters.colCode')}</th>
                    <th>{t('matters.colClient')}</th>
                    <th>{t('matters.colMatter')}</th>
                    <th>{t('matters.colType')}</th>
                  </tr>
                </thead>
                <tbody>
                  {inputs.slice(0, 5).map((m, i) => (
                    <tr key={i}>
                      <td className="tabular">{matterCode({ clientNumber: m.clientNumber, matterNumber: m.matterNumber })}</td>
                      <td>{m.clientName}</td>
                      <td>{m.matterName}</td>
                      <td>{m.billingType && t(`billing.${m.billingType}`)}</td>
                    </tr>
                  ))}
                  {!inputs.length && (
                    <tr>
                      <td colSpan={4} className="muted">
                        {t('matters.nothingToImport')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
