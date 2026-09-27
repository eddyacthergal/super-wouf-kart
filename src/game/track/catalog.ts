/**
 * Catalogue des circuits, dans l'ordre de l'écran de choix. Chaque circuit est un fichier JSON de
 * `circuits/`, contrôlé par parseCircuit au chargement (un fichier invalide fait échouer les tests).
 */
import { parseCircuit } from './circuit-loader';
import colline from './circuits/colline.json';
import grandJardin from './circuits/grand-jardin.json';
import parcEnneige from './circuits/parc-enneige.json';
import plage from './circuits/plage.json';
import potager from './circuits/potager.json';
import type { TrackDefinition } from './track-definition';

export const TRACK_CATALOG: readonly TrackDefinition[] = [
  grandJardin,
  potager,
  parcEnneige,
  plage,
  colline,
].map(parseCircuit);

export const DEFAULT_TRACK_ID = 'grand-jardin';

/** Vrai si `value` est l'identifiant d'un circuit du catalogue. */
export function isTrackId(value: unknown): value is string {
  return typeof value === 'string' && TRACK_CATALOG.some((track) => track.id === value);
}

/** Circuit d'identifiant `id`, ou le circuit par défaut si l'identifiant est absent ou inconnu. */
export function findTrack(id: string | null | undefined): TrackDefinition {
  return (
    TRACK_CATALOG.find((track) => track.id === id) ??
    TRACK_CATALOG.find((track) => track.id === DEFAULT_TRACK_ID)!
  );
}
