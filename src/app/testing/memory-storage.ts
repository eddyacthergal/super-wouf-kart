import type { SettingsStorage } from '../core/settings.store';

/** Stockage en mémoire, pour isoler les tests de localStorage. */
export class MemoryStorage implements SettingsStorage {
  readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}
