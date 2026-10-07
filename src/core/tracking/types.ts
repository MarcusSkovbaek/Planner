/** What a platform reports about the window in the foreground. */
export interface WindowSample {
  /** Normalised process key, e.g. `winword`. */
  app: string;
  /** Friendly name if known, otherwise the process name. */
  appName: string;
  title: string;
  pid?: number;
  /** True when the window belongs to this application itself. */
  isSelf?: boolean;
}

/**
 * A source of foreground-window information. Implementations: Win32 (koffi FFI),
 * PowerShell fallback and a simulator for demos/tests. Future sources (browser
 * extension, calendar…) can be added behind the same interface.
 */
export interface WindowProvider {
  readonly id: string;
  /** Called once before sampling starts; throw to signal the provider is unusable. */
  init?(): Promise<void> | void;
  sample(): Promise<WindowSample | null> | WindowSample | null;
  dispose?(): void;
}

export interface IdleSource {
  /** Seconds since the last keyboard/mouse input. */
  getIdleSeconds(): number;
}
