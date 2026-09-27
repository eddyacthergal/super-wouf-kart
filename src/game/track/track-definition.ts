/**
 * Définition d'un circuit : des données pures et sérialisables (aucune fonction, aucune dépendance
 * au rendu), qui viennent telles quelles d'un fichier JSON (`circuits/<id>.json`, contrôlé par
 * `parseCircuit`). Le monde 3D est choisi par l'identifiant de thème ; les indications de décor sont
 * interprétées par ce thème.
 *
 * Ajouter un circuit : écrire `circuits/<id>.json`, l'inscrire dans `catalog.ts` ; les tests du
 * catalogue vérifient alors le tracé (validateur) et qu'une course entre IA va à son terme.
 */
import type { Vec2 } from '../core/vec2';
import type { TrackCorner } from './centerline';

export const TRACK_THEMES = ['garden', 'snow', 'beach'] as const;
/** Thème de rendu : jardin d'été, parc enneigé, plage au couchant. */
export type TrackThemeId = (typeof TRACK_THEMES)[number];

/** Pièce de décor unique (niche, arrosoir…) : type propre au thème, position souhaitée et encombrement (m). */
export interface LandmarkHint {
  kind: string;
  x: number;
  z: number;
  radius: number;
}

/** Indications de décor, en coordonnées du circuit (m). Un objet qui gênerait est déplacé ou omis. */
export interface TrackDecorHints {
  landmarks?: readonly LandmarkHint[];
  /** Chemin décoratif (pierres de gué du jardin…) entre deux points. */
  path?: { from: Vec2; to: Vec2 };
}

export interface TrackDefinition {
  /** Identifiant stable (réglages mémorisés, adresses) : minuscules et tirets. */
  id: string;
  name: string;
  /** Une phrase pour l'écran de choix. */
  description: string;
  theme: TrackThemeId;
  /** Nombre de tours (RACE_LAPS par défaut). */
  laps?: number;
  /** Ligne de départ : sur la ligne droite qui va du dernier coin au premier. */
  start: Vec2;
  /** Polygone fermé, dans l'ordre de course (voir TrackCorner). */
  corners: readonly TrackCorner[];
  decor?: TrackDecorHints;
}
