/**
 * Catalogue des circuits, dans l'ordre de l'écran de choix. Données pures (aucune dépendance au
 * rendu) : l'interface l'importe pour afficher les cartes, le jeu pour construire la course.
 */
import { GRAND_JARDIN } from './circuits/grand-jardin';
import { PARC_ENNEIGE } from './circuits/parc-enneige';
import { POTAGER } from './circuits/potager';
import type { TrackDefinition } from './track-definition';

export const TRACK_CATALOG: readonly TrackDefinition[] = [GRAND_JARDIN, POTAGER, PARC_ENNEIGE];

export const DEFAULT_TRACK_ID = GRAND_JARDIN.id;

/** Vrai si `value` est l'identifiant d'un circuit du catalogue. */
export function isTrackId(value: unknown): value is string {
  return typeof value === 'string' && TRACK_CATALOG.some((track) => track.id === value);
}

/** Circuit d'identifiant `id`, ou le circuit par défaut si l'identifiant est absent ou inconnu. */
export function findTrack(id: string | null | undefined): TrackDefinition {
  return TRACK_CATALOG.find((track) => track.id === id) ?? GRAND_JARDIN;
}
