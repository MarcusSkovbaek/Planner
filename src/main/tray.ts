import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { translate, type TranslationKey } from '@core/i18n';
import type { Language, TrackingStatus, UpdateStatus } from '@core/model';

export interface TrayActions {
  open(): void;
  openSettings(): void;
  pause(minutes: number | null): void;
  resume(): void;
  installUpdate(): void;
  quit(): void;
}

/** System tray icon with quick pause/resume, so capture can be controlled without the window. */
export class AppTray {
  private readonly tray: Tray;
  private language: Language = 'da';
  private status: TrackingStatus | null = null;
  private update: UpdateStatus | null = null;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly icons: { active: Electron.NativeImage; inactive: Electron.NativeImage };
  private dimmed = false;

  constructor(
    icons: { active: string; inactive: string },
    private readonly actions: TrayActions,
  ) {
    this.icons = { active: nativeImage.createFromPath(icons.active), inactive: nativeImage.createFromPath(icons.inactive) };
    this.tray = new Tray(this.icons.active);
    this.tray.on('click', () => actions.open());
    this.tray.on('double-click', () => actions.open());
    this.rebuild();
  }

  setLanguage(language: Language): void {
    if (language === this.language) return;
    this.language = language;
    this.scheduleRebuild();
  }

  setStatus(status: TrackingStatus): void {
    const changed =
      status.state !== this.status?.state ||
      status.current?.app !== this.status?.current?.app ||
      status.pausedUntil !== this.status?.pausedUntil;
    this.status = status;
    // A grey icon tells at a glance that nothing is being captured.
    const dimmed = status.state !== 'active' && status.state !== 'starting';
    if (dimmed !== this.dimmed && !this.icons.inactive.isEmpty()) {
      this.dimmed = dimmed;
      this.tray.setImage(dimmed ? this.icons.inactive : this.icons.active);
    }
    if (changed) this.scheduleRebuild();
  }

  setUpdate(update: UpdateStatus): void {
    const changed = update.state !== this.update?.state || update.availableVersion !== this.update?.availableVersion;
    this.update = update;
    if (changed) this.scheduleRebuild();
  }

  destroy(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.tray.destroy();
  }

  private t(key: TranslationKey, params?: Record<string, string | number>) {
    return translate(this.language, key, params);
  }

  private scheduleRebuild(): void {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, 250);
  }

  private rebuild(): void {
    const state = this.status?.state ?? 'starting';
    const paused = state === 'paused';
    const current = this.status?.current;
    const statusLabel = current
      ? `${this.t(`tracking.state.${state}`)}: ${current.appName}`
      : this.t(`tracking.state.${state}`);

    const template: MenuItemConstructorOptions[] = [
      { label: this.t('tray.open'), click: () => this.actions.open() },
      { type: 'separator' },
      { label: statusLabel, enabled: false },
      paused
        ? { label: this.t('tray.resume'), click: () => this.actions.resume() }
        : {
            label: this.t('tray.pause'),
            enabled: state !== 'disabled' && state !== 'unavailable',
            submenu: [
              { label: this.t('tray.pause15'), click: () => this.actions.pause(15) },
              { label: this.t('tray.pause60'), click: () => this.actions.pause(60) },
              { label: this.t('tracking.pauseIndefinitely'), click: () => this.actions.pause(null) },
            ],
          },
      { type: 'separator' },
      ...(this.update?.state === 'ready'
        ? [
            {
              label: this.t('tray.installUpdate', { version: this.update.availableVersion ?? '' }),
              click: () => this.actions.installUpdate(),
            },
            { type: 'separator' as const },
          ]
        : []),
      { label: this.t('tray.settings'), click: () => this.actions.openSettings() },
      { label: this.t('tray.quit'), click: () => this.actions.quit() },
    ];
    this.tray.setContextMenu(Menu.buildFromTemplate(template));
    this.tray.setToolTip(
      paused ? this.t('tray.tooltipPaused') : state === 'idle' ? this.t('tray.tooltipIdle') : this.t('tray.tooltipActive'),
    );
  }
}
