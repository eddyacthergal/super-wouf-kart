/**
 * Mise en forme des textes affichés (temps, classements, noms) en français.
 * Fonctions pures, sans dépendance à Angular.
 */
import type { BreedId, ItemKind, SkinSelection } from '../../game/core/types';
import { BREEDS } from '../../game/dogs/breeds';
import { SKIN_SLOTS, SKINS } from '../../game/dogs/skins-catalog';

const pad2 = (value: number): string => String(value).padStart(2, '0');

/**
 * Temps de course : « 1:05.32 » (minutes:secondes.centièmes, tronqués). Avec `decimals = 1`,
 * « 1:05.3 » : utile pour le chrono du HUD, publié ~10 fois par seconde, dont les centièmes
 * resteraient figés.
 */
export function formatRaceTime(seconds: number, decimals: 1 | 2 = 2): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const scale = decimals === 1 ? 10 : 100;
  // Petite marge : 0.29 * 100 vaut 28.999… en virgule flottante.
  const units = Math.floor(safe * scale + 1e-6);
  const minutes = Math.floor(units / (60 * scale));
  const secs = Math.floor(units / scale) % 60;
  const fraction = String(units % scale).padStart(decimals, '0');
  return `${minutes}:${pad2(secs)}.${fraction}`;
}

/** Rang ordinal simple, lisible par les synthèses vocales : « 1er », « 2e ». */
export function formatRank(rank: number): string {
  return rank === 1 ? '1er' : `${rank}e`;
}

/** Variante typographique pour l'affichage : « 1ᵉʳ », « 2ᵉ ». */
export function formatRankDisplay(rank: number): string {
  return rank === 1 ? '1ᵉʳ' : `${rank}ᵉ`;
}

/** Place au féminin : « 1re place », « 3e place ». */
export function formatPlace(rank: number): string {
  return rank === 1 ? '1re place' : `${rank}e place`;
}

export function breedName(id: BreedId): string {
  return BREEDS[id]?.name ?? id;
}

export function skinName(id: string): string {
  return SKINS.find((skin) => skin.id === id)?.name ?? id;
}

const ITEM_NAMES: Readonly<Record<ItemKind, string>> = {
  bone: 'Os',
  'tennis-ball': 'Balle de tennis',
  mud: 'Flaque de boue',
  'kibble-turbo': 'Croquette turbo',
};

export function itemName(kind: ItemKind): string {
  return ITEM_NAMES[kind];
}

/** Énumération à la française : « a », « a et b », « a, b et c ». */
export function joinWithEt(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** Noms des accessoires portés, dans l'ordre tête, cou, corps. */
export function equippedSkinNames(skins: SkinSelection): string[] {
  return SKIN_SLOTS.flatMap((slot) => {
    const id = skins[slot];
    return id ? [skinName(id)] : [];
  });
}

/** « chihuahua avec casquette et bandana », « teckel sans accessoire » (en minuscules). */
export function describeDog(breed: BreedId, skins: SkinSelection): string {
  const lower = (text: string): string => text.toLocaleLowerCase('fr');
  const accessories = equippedSkinNames(skins).map(lower);
  const name = lower(breedName(breed));
  return accessories.length === 0
    ? `${name} sans accessoire`
    : `${name} avec ${joinWithEt(accessories)}`;
}
