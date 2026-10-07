/**
 * Minimal persistence abstraction. Keys are slash-separated (`activity/2026-10-07`).
 * Implementations: JSON files on disk (desktop), localStorage (browser), memory (tests).
 * Swapping in SQLite or a sync backend later only requires a new implementation.
 */
export interface KeyValueStorage {
  read<T>(key: string): Promise<T | undefined>;
  write<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  /** Keys starting with `prefix`. */
  keys(prefix: string): Promise<string[]>;
}

export class MemoryStorage implements KeyValueStorage {
  private readonly data = new Map<string, string>();

  async read<T>(key: string): Promise<T | undefined> {
    const raw = this.data.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }

  async write<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }

  async keys(prefix: string): Promise<string[]> {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}
