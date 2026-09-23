/**
 * Catalogue des accessoires (données seules, sans three.js) et validation d'une sélection
 * lue depuis une source non fiable (localStorage).
 */
import { EMPTY_SKINS, type SkinInfo, type SkinSelection, type SkinSlot } from '../core/types';

export const SKIN_SLOTS: readonly SkinSlot[] = ['head', 'neck', 'body'];

export const SKINS: readonly SkinInfo[] = [
  { id: 'cap', name: 'Casquette', slot: 'head' },
  { id: 'crown', name: 'Couronne', slot: 'head' },
  { id: 'beanie', name: 'Bonnet à pompon', slot: 'head' },
  { id: 'party-hat', name: 'Chapeau de fête', slot: 'head' },
  { id: 'bandana', name: 'Bandana', slot: 'neck' },
  { id: 'bowtie', name: 'Nœud papillon', slot: 'neck' },
  { id: 'bell-collar', name: 'Collier à grelot', slot: 'neck' },
  { id: 'sweater', name: 'Pull rayé', slot: 'body' },
  { id: 'cape', name: 'Cape de héros', slot: 'body' },
];

export function skinsForSlot(slot: SkinSlot): SkinInfo[] {
  return SKINS.filter((skin) => skin.slot === slot);
}

/** Vrai si `id` désigne un accessoire existant de l'emplacement `slot`. */
export function isSkinInSlot(id: unknown, slot: SkinSlot): id is string {
  return typeof id === 'string' && SKINS.some((skin) => skin.id === id && skin.slot === slot);
}

/**
 * Valide une valeur quelconque : garde seulement les identifiants existants
 * placés dans le bon emplacement, `null` partout ailleurs.
 */
export function sanitizeSkins(value: unknown): SkinSelection {
  const result: SkinSelection = { ...EMPTY_SKINS };
  if (typeof value !== 'object' || value === null) return result;
  const record = value as Record<string, unknown>;
  for (const slot of SKIN_SLOTS) {
    const id = record[slot];
    if (isSkinInSlot(id, slot)) result[slot] = id;
  }
  return result;
}
