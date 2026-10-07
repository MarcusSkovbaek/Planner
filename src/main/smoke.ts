import { app, BrowserWindow, session } from 'electron';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlannerService } from '@core/backend/PlannerService';
import { ActivityTracker } from '@core/tracking/ActivityTracker';
import type { WindowSample } from '@core/tracking/types';
import { dateKeyOf } from '@core/time';
import { FileStorage } from './storage/FileStorage';
import { createWindowProvider } from './tracking';
import { registerIpc } from './ipc';
import { createElectronPlatform } from './platform';
import { lockDownNetwork } from './security';
import { createUpdater } from './update';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface SmokeReport {
  ok: boolean;
  platform: string;
  version: string;
  provider: string | null;
  samples: (WindowSample | null)[];
  storage: boolean;
  renderer: boolean;
  trackingState: string | null;
  /** The UI could not reach the internet (all captured data stays local). */
  networkBlocked: boolean;
  /** A separate session could reach the same URL, proving the block is not just a missing network. */
  networkControlReachable: boolean | null;
  updateState: string | null;
  errors: string[];
}

/**
 * `Planner.exe --smoke-test=<file>`: verifies the packaged build end to end (native
 * window provider, storage, IPC, preload and renderer) and writes a JSON report.
 * Used by CI on a real Windows runner.
 */
export async function runSmokeTest(outFile: string | undefined, demo: boolean): Promise<number> {
  const report: SmokeReport = {
    ok: false,
    platform: process.platform,
    version: app.getVersion(),
    provider: null,
    samples: [],
    storage: false,
    renderer: false,
    trackingState: null,
    networkBlocked: false,
    networkControlReachable: null,
    updateState: null,
    errors: [],
  };
  lockDownNetwork();
  const note = (err: unknown) => report.errors.push(err instanceof Error ? `${err.message}` : String(err));

  // 1. Native window provider.
  const provider = createWindowProvider(demo);
  try {
    await provider.init?.();
    report.provider = provider.id;
    for (let i = 0; i < 5; i++) {
      report.samples.push(await provider.sample());
      await sleep(250);
    }
  } catch (err) {
    note(err);
  }

  // 2. Storage round trip.
  const dir = await fs.mkdtemp(join(tmpdir(), 'planner-smoke-'));
  const storage = new FileStorage(dir);
  try {
    await storage.write('entries', [{ ok: true }]);
    const back = await storage.read<{ ok: boolean }[]>('entries');
    report.storage = back?.[0]?.ok === true;
  } catch (err) {
    note(err);
  }

  // 3. Full app: service + IPC + preload + renderer.
  let win: BrowserWindow | null = null;
  try {
    const service = new PlannerService({
      storage,
      platform: createElectronPlatform({ dataPath: dir, demo, getWindow: () => win, onSettings: () => undefined }),
      createTracker: (options, emit) => new ActivityTracker(provider, { getIdleSeconds: () => 0 }, options, emit),
    });
    await service.init();
    registerIpc(service);
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true },
    });
    await win.loadFile(join(__dirname, '../renderer/index.html'));
    for (let i = 0; i < 60 && !report.renderer; i++) {
      report.renderer = (await win.webContents.executeJavaScript('document.documentElement.dataset.ready === "true"')) === true;
      if (!report.renderer) await sleep(250);
    }
    const probe = 'https://example.com/';
    const rendererBlocked = await win.webContents.executeJavaScript(
      `fetch('${probe}', { mode: 'no-cors', cache: 'no-store' }).then(() => false, () => true)`,
    );
    const sessionBlocked = await session.defaultSession.fetch(probe).then(
      () => false,
      () => true,
    );
    report.networkBlocked = rendererBlocked === true && sessionBlocked;
    report.networkControlReachable = await session
      .fromPartition('smoke-control')
      .fetch(probe)
      .then(
        (res) => res.ok,
        () => false,
      );
    report.updateState = createUpdater().getStatus().state;
    await sleep(1500);
    report.trackingState = service.getTrackingStatus().state;
    await service.getDay(dateKeyOf(Date.now()));
    await service.dispose();
  } catch (err) {
    note(err);
  } finally {
    win?.destroy();
  }

  const providerOk = process.platform !== 'win32' || demo || report.provider === 'win32' || report.provider === 'powershell';
  report.ok = providerOk && report.storage && report.renderer && report.networkBlocked;
  const json = JSON.stringify(report, null, 2);
  process.stdout.write(json + '\n');
  if (outFile) await fs.writeFile(outFile, json, 'utf8').catch(note);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  return report.ok ? 0 : 1;
}
