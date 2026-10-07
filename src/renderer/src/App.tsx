import { useEffect } from 'react';
import type { ViewId } from '@core/model';
import { useApp } from '@/state/app';
import { useHotkeys } from '@/lib/hotkeys';
import { useThemeSync } from '@/lib/theme';
import { TitleBar } from '@/components/shell/TitleBar';
import { ShortcutsDialog } from '@/components/shell/ShortcutsDialog';
import { Toaster } from '@/components/ui/Toaster';
import { ContextMenuHost } from '@/components/ui/ContextMenuHost';
import { PlannerView } from '@/features/planner/PlannerView';
import { ListView } from '@/features/list/ListView';
import { MattersView } from '@/features/matters/MattersView';
import { SettingsView } from '@/features/settings/SettingsView';

const VIEWS: ViewId[] = ['planner', 'list', 'matters', 'settings'];

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const theme = useApp((s) => s.settings.general.theme);
  const language = useApp((s) => s.settings.general.language);
  const platform = useApp((s) => s.info.platform);
  useThemeSync(theme);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useHotkeys({
    'mod+1': () => setView(VIEWS[0]!),
    'mod+2': () => setView(VIEWS[1]!),
    'mod+3': () => setView(VIEWS[2]!),
    'mod+4': () => setView(VIEWS[3]!),
    'mod+,': () => setView('settings'),
    '?': () => useApp.getState().setShortcutsOpen(true),
  });

  return (
    <div className="app" data-platform={platform}>
      <TitleBar />
      <main className="app-main">
        {/* The planner stays mounted so its scroll position and live state survive view switches. */}
        <div className="view-host" hidden={view !== 'planner'}>
          <PlannerView active={view === 'planner'} />
        </div>
        {view === 'list' && <ListView />}
        {view === 'matters' && <MattersView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <Toaster />
      <ContextMenuHost />
      <ShortcutsDialog />
    </div>
  );
}
