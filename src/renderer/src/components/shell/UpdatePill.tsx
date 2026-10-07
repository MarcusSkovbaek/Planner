import { useState } from 'react';
import { ArrowUpCircle } from 'lucide-react';
import { api } from '@/api/client';
import { useApp } from '@/state/app';
import { useI18n } from '@/lib/i18n';
import { Tooltip } from '@/components/ui/Tooltip';

/** Appears in the title bar when a verified update is ready to install. */
export function UpdatePill() {
  const { t } = useI18n();
  const update = useApp((s) => s.update);
  const [busy, setBusy] = useState(false);
  if (update.state !== 'ready') return null;
  return (
    <Tooltip content={t('update.readyTooltip', { version: update.availableVersion ?? '' })}>
      <button
        type="button"
        className="update-pill"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api()
            .installUpdate()
            .finally(() => setBusy(false));
        }}
        data-testid="update-pill"
      >
        <ArrowUpCircle />
        {t('update.readyShort')}
      </button>
    </Tooltip>
  );
}
