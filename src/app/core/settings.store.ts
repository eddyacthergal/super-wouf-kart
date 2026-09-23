import { DOCUMENT, InjectionToken, Service, computed, inject, signal } from '@angular/core';
import { EMPTY_SKINS, type BreedId, type SkinSelection, type SkinSlot } from '../../game/core/types';
import { BREEDS } from '../../game/dogs/breeds';
import { isSkinInSlot, sanitizeSkins } from '../../game/dogs/skins-catalog';

export const SETTINGS_STORAGE_KEY = 'wouf-kart.settings.v1';

/** Sous-ensemble de l'API Storage utilisé par le store (remplaçable dans les tests). */
export type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Stockage persistant des réglages ; null si localStorage est inaccessible (navigation privée stricte, serveur). */
export const SETTINGS_STORAGE = new InjectionToken<SettingsStorage | null>('SETTINGS_STORAGE', {
  factory: () => {
    try {
      return inject(DOCUMENT).defaultView?.localStorage ?? null;
    } catch {
      // L'accès même à la propriété localStorage peut lever (SecurityError).
      return null;
    }
  },
});

export interface Settings {
  breed: BreedId;
  skins: SkinSelection;
  muted: boolean;
}

export const DEFAULT_SETTINGS: Settings = { breed: 'chihuahua', skins: EMPTY_SKINS, muted: false };

export function isBreedId(value: unknown): value is BreedId {
  return typeof value === 'string' && Object.hasOwn(BREEDS, value);
}

/** Valide une valeur lue depuis le stockage : chaque champ invalide reprend sa valeur par défaut. */
export function parseSettings(raw: string | null): Settings {
  if (raw === null) return DEFAULT_SETTINGS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_SETTINGS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS;
  const record = value as Record<string, unknown>;
  return {
    breed: isBreedId(record['breed']) ? record['breed'] : DEFAULT_SETTINGS.breed,
    skins: sanitizeSkins(record['skins']),
    muted: typeof record['muted'] === 'boolean' ? record['muted'] : DEFAULT_SETTINGS.muted,
  };
}

/** Choix du joueur (race, accessoires, son), mémorisés dans localStorage. */
@Service()
export class SettingsStore {
  private readonly storage = inject(SETTINGS_STORAGE);
  private readonly state = signal<Settings>(this.load());

  readonly breed = computed(() => this.state().breed);
  readonly skins = computed(() => this.state().skins);
  readonly muted = computed(() => this.state().muted);

  setBreed(id: BreedId): void {
    if (!isBreedId(id) || id === this.state().breed) return;
    this.update({ breed: id });
  }

  /** Équipe un accessoire (ignoré s'il n'appartient pas à l'emplacement) ou le retire avec `null`. */
  setSkin(slot: SkinSlot, id: string | null): void {
    if (id !== null && !isSkinInSlot(id, slot)) return;
    if (this.state().skins[slot] === id) return;
    this.update({ skins: { ...this.state().skins, [slot]: id } });
  }

  setMuted(muted: boolean): void {
    if (muted === this.state().muted) return;
    this.update({ muted });
  }

  private update(patch: Partial<Settings>): void {
    this.state.update((current) => ({ ...current, ...patch }));
    this.save();
  }

  private load(): Settings {
    try {
      return parseSettings(this.storage?.getItem(SETTINGS_STORAGE_KEY) ?? null);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.state()));
    } catch {
      // Stockage plein ou interdit : les réglages restent valables pour cette session.
    }
  }
}
