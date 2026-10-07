import { useApp } from '@/state/app';
import { useI18n } from '@/lib/i18n';
import { Dialog } from '@/components/ui/Dialog';
import { Kbd } from '@/components/ui/controls';

export function ShortcutsDialog() {
  const { t } = useI18n();
  const open = useApp((s) => s.shortcutsOpen);
  const setOpen = useApp((s) => s.setShortcutsOpen);
  const rows: [React.ReactNode, string][] = [
    [<><Kbd>←</Kbd><Kbd>→</Kbd></>, t('shortcuts.navigateDays')],
    [<Kbd>T</Kbd>, t('shortcuts.today')],
    [<Kbd>N</Kbd>, t('shortcuts.newEntry')],
    [<><Kbd>Ctrl</Kbd><Kbd>Enter</Kbd></>, t('shortcuts.release')],
    [<Kbd>Delete</Kbd>, t('shortcuts.delete')],
    [<><Kbd>Ctrl</Kbd><Kbd>D</Kbd></>, t('shortcuts.duplicate')],
    [<><Kbd>Ctrl</Kbd><Kbd>Z</Kbd></>, t('shortcuts.undo')],
    [<><Kbd>Ctrl</Kbd><span className="muted">+ {t('shortcuts.click')}</span></>, t('shortcuts.multiSelect')],
    [<><Kbd>+</Kbd><Kbd>−</Kbd></>, t('shortcuts.zoom')],
    [<Kbd>Esc</Kbd>, t('shortcuts.close')],
    [<Kbd>?</Kbd>, t('shortcuts.help')],
    [<span className="muted">{t('shortcuts.dragLabel')}</span>, t('shortcuts.drag')],
    [<span className="muted">{t('shortcuts.dragLabel')}</span>, t('shortcuts.dragCreate')],
  ];
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title={t('shortcuts.title')} width={480} closeLabel={t('common.close')}>
      <div className="shortcuts">
        {rows.map(([keys, label], i) => (
          <div key={i} className="shortcut-row">
            <span>{label}</span>
            <span className="shortcut-keys">{keys}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
