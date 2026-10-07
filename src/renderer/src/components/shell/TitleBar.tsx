import { Briefcase, CalendarRange, ListChecks, Settings2 } from 'lucide-react';
import type { ViewId } from '@core/model';
import { useApp } from '@/state/app';
import { useI18n } from '@/lib/i18n';
import { Logo } from './Logo';
import { TrackingIndicator } from './TrackingIndicator';
import { UpdatePill } from './UpdatePill';

const NAV: { id: ViewId; icon: React.ReactNode; key: 'nav.planner' | 'nav.list' | 'nav.matters' | 'nav.settings' }[] = [
  { id: 'planner', icon: <CalendarRange />, key: 'nav.planner' },
  { id: 'list', icon: <ListChecks />, key: 'nav.list' },
  { id: 'matters', icon: <Briefcase />, key: 'nav.matters' },
  { id: 'settings', icon: <Settings2 />, key: 'nav.settings' },
];

/** Custom title bar: draggable, with navigation and tracking status. Native window controls sit on the right. */
export function TitleBar() {
  const { t } = useI18n();
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  return (
    <header className="titlebar">
      <div className="brand">
        <Logo />
        <span className="brand-name">{t('app.name')}</span>
      </div>
      <nav className="nav" aria-label="Navigation">
        {NAV.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={view === item.id ? 'page' : undefined}
            onClick={() => setView(item.id)}
            title={`${t(item.key)} (Ctrl+${index + 1})`}
            data-testid={`nav-${item.id}`}
          >
            {item.icon}
            <span>{t(item.key)}</span>
          </button>
        ))}
      </nav>
      <div className="titlebar-drag" />
      <UpdatePill />
      <TrackingIndicator />
    </header>
  );
}
