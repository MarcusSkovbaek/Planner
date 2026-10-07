import type { WindowProvider, WindowSample } from './types';

/**
 * Tries providers in order and uses the first one that initialises successfully.
 * Lets the desktop app prefer the fast native provider and fall back gracefully.
 */
export class ProviderChain implements WindowProvider {
  private active: WindowProvider | null = null;
  private readonly errors: string[] = [];

  constructor(private readonly candidates: readonly (() => WindowProvider)[]) {}

  get id(): string {
    return this.active?.id ?? 'none';
  }

  async init(): Promise<void> {
    if (this.active) return;
    for (const create of this.candidates) {
      let provider: WindowProvider | null = null;
      try {
        provider = create();
        await provider.init?.();
        this.active = provider;
        return;
      } catch (err) {
        provider?.dispose?.();
        this.errors.push(`${provider?.id ?? 'provider'}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(this.errors.join(' | ') || 'No window provider available');
  }

  sample(): Promise<WindowSample | null> | WindowSample | null {
    if (!this.active) throw new Error('Provider not initialised');
    return this.active.sample();
  }

  dispose(): void {
    this.active?.dispose?.();
    this.active = null;
  }
}
