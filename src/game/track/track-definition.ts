/**
 * Définition d'un circuit : des données pures et sérialisables (aucune fonction, aucune dépendance
 * au rendu), qui pourraient venir telles quelles d'un fichier JSON ou d'un serveur. Le monde 3D est
 * choisi par l'identifiant de thème ; les indications de décor sont interprétées par ce thème.
 *
 * Ajouter un circuit : écrire une définition dans `circuits/`, l'inscrire dans `catalog.ts` ; les
 * tests du catalogue vérifient alors le tracé (validateur) et qu'une course entre IA va à son terme.
 */
import type { Vec2 } from '../core/vec2';

/** Thèmes de monde disponibles : chacun a son sol, ses murs, son ciel et son décor. */
export type TrackThemeId = 'garden';

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
  /**
   * Points de contrôle de la spline fermée (m). Le point 0 est sur la ligne de départ/arrivée, la
   * course suit les indices croissants, et une ligne droite doit précéder et suivre ce point.
   */
  controlPoints: readonly Vec2[];
  decor?: TrackDecorHints;
}
