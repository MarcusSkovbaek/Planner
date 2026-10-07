import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';
import './styles/table.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { connectApi } from '@/api/client';
import { useApp } from '@/state/app';
import { usePlanner } from '@/state/planner';
import { applyTheme } from '@/lib/theme';
import { App } from './App';

async function boot() {
  const api = await connectApi();
  api.subscribe((event) => {
    useApp.getState().handleEvent(event);
    usePlanner.getState().handleEvent(event);
  });
  await useApp.getState().init();
  applyTheme(useApp.getState().settings.general.theme);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await usePlanner.getState().load();
  document.documentElement.dataset.ready = 'true';
}

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById('root')!;
  root.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = `Planner kunne ikke starte: ${err instanceof Error ? err.message : String(err)}`;
  root.appendChild(box);
});
