/**
 * Types partagés de la simulation. Ce fichier est le contrat entre les modules
 * (circuit, kart, course, IA, objets, rendu, audio, interface Angular).
 * Aucune dépendance à three.js ni à Angular ici.
 */
import type { Rng } from './rng';
import type { Vec2 } from './vec2';

// ---------------------------------------------------------------------------
// Chiens et personnalisation
// ---------------------------------------------------------------------------

export type BreedId = 'chihuahua' | 'carlin' | 'teckel' | 'jack-russell';

export type SkinSlot = 'head' | 'neck' | 'body';

/** Sélection d'accessoires : un par emplacement, `null` = aucun. */
export type SkinSelection = Record<SkinSlot, string | null>;

export const EMPTY_SKINS: Readonly<SkinSelection> = Object.freeze({ head: null, neck: null, body: null });

/** Statistiques d'une race, de 1 à 5 points chacune. */
export interface StatBlock {
  speed: number;
  acceleration: number;
  weight: number;
  handling: number;
}

/** Données d'une race lisibles par l'interface (sans three.js). */
export interface BreedInfo {
  id: BreedId;
  /** Nom affiché, en français. */
  name: string;
  /** Une phrase de description, en français. */
  description: string;
  stats: StatBlock;
}

/** Données d'un accessoire lisibles par l'interface (sans three.js). */
export interface SkinInfo {
  id: string;
  name: string;
  slot: SkinSlot;
}

// ---------------------------------------------------------------------------
// Kart
// ---------------------------------------------------------------------------

/** Valeurs physiques dérivées des stats (voir PHYSICS dans constants.ts). */
export interface KartTuning {
  /** Vitesse max en marche avant (m/s). */
  maxSpeed: number;
  /** Accélération (m/s²). */
  acceleration: number;
  /** Vitesse de rotation à plein braquage (rad/s). */
  turnRate: number;
  /** Masse relative (~0.9 à 1.3), utilisée pour les collisions entre karts. */
  mass: number;
  /** Multiplicateur de vitesse max hors de la route (bas-côté). */
  offroadFactor: number;
}

/** Commandes d'un pilote pour un pas de simulation (joueur ou IA). */
export interface DriverInput {
  throttle: boolean;
  brake: boolean;
  /** -1 = gauche, +1 = droite (point de vue du pilote). */
  steer: number;
  /** Maintenu = saut + dérapage. */
  drift: boolean;
  /** Vrai une seule fois par appui (front montant). */
  useItem: boolean;
  /**
   * Assistance au dérapage (active si absent) : au neutre, le kart suit le virage tout seul ;
   * désactivée, le neutre est une courbe fixe (DRIFT.turnNeutral), pour les pilotes confirmés.
   */
  driftAssist?: boolean;
}

export const NEUTRAL_INPUT: DriverInput = { throttle: false, brake: false, steer: 0, drift: false, useItem: false };

/** 0 = pas de charge, 1 = bleu, 2 = orange, 3 = violet. */
export type DriftTier = 0 | 1 | 2 | 3;

export interface DriftState {
  active: boolean;
  /** Sens du dérapage : -1 = vers la gauche, +1 = vers la droite, 0 = aucun. */
  direction: -1 | 0 | 1;
  /** Temps passé en dérapage (s). */
  charge: number;
  tier: DriftTier;
}

export interface KartState {
  position: Vec2;
  /** Cap θ : avant = (sin θ, cos θ). */
  heading: number;
  /** Vitesse signée le long du cap (m/s), négative en marche arrière. */
  speed: number;
  /** Braquage lissé réellement appliqué, -1..1. */
  steer: number;
  drift: DriftState;
  /** Temps de boost restant (s). */
  boostTime: number;
  /** Multiplicateur de vitesse max pendant le boost en cours. */
  boostStrength: number;
  /** Temps restant du petit saut de début de dérapage (visuel). */
  hopTime: number;
  /** Temps restant de tête-à-queue après un impact (aucun contrôle). */
  spinTime: number;
  /** Vrai si le kart roule sur le bas-côté. */
  offroad: boolean;
  /** Vrai si le kart a touché une haie pendant le dernier pas. */
  wallContact: boolean;
  /** Rotation visuelle ajoutée au modèle (dérapage, tête-à-queue), rad. */
  visualYaw: number;
  /** Position au début du dernier pas (interpolation du rendu). */
  prevPosition: Vec2;
  /** Cap au début du dernier pas (interpolation du rendu). */
  prevHeading: number;
  /** Indice d'échantillon du circuit le plus proche au dernier pas (accélère project()). */
  trackIndex: number;
  /** Décalage latéral signé par rapport à la ligne médiane (+ = gauche). */
  lateral: number;
}

/** Événements émis par stepKart (sans identifiant de pilote). */
export type KartEvent =
  | { type: 'drift-start' }
  | { type: 'drift-tier'; tier: DriftTier }
  | { type: 'boost'; source: 'drift'; tier: DriftTier }
  | { type: 'wall'; intensity: number };

// ---------------------------------------------------------------------------
// Circuit
// ---------------------------------------------------------------------------

export interface TrackSample {
  /** Abscisse curviligne (m) depuis la ligne de départ, dans [0, length[. */
  s: number;
  position: Vec2;
  /** Tangente unitaire (sens de la course). */
  tangent: Vec2;
  /** Normale unitaire vers la gauche : (tangent.z, -tangent.x). */
  left: Vec2;
  /** Demi-largeur de route à cet endroit. */
  halfWidth: number;
  /** Courbure signée (1/m) : > 0 = virage à gauche, < 0 = virage à droite. */
  curvature: number;
}

export interface TrackProjection {
  /** Abscisse curviligne du point projeté, dans [0, length[. */
  s: number;
  /** Décalage latéral signé (+ = gauche). */
  lateral: number;
  /** Indice de l'échantillon le plus proche. */
  index: number;
  sample: TrackSample;
}

export interface GridSlot {
  position: Vec2;
  heading: number;
  /** Abscisse curviligne non bouclée (négative : derrière la ligne). */
  progress: number;
}

export interface TrackQuery {
  /** Longueur d'un tour (m). */
  readonly length: number;
  /** Distance ligne médiane → haie. */
  readonly wallHalfWidth: number;
  /** Échantillons réguliers le long de la ligne médiane (environ 1 par mètre). */
  readonly samples: readonly TrackSample[];
  /** Échantillon interpolé à l'abscisse s (bouclée automatiquement). */
  sampleAt(s: number): TrackSample;
  /**
   * Projette un point sur la ligne médiane. `hintIndex` (dernier indice connu)
   * permet une recherche locale rapide ; sans lui, recherche globale.
   */
  project(point: Vec2, hintIndex?: number): TrackProjection;
  /** Emplacement de départ n° i (0 = pole position). */
  gridSlot(index: number): GridSlot;
  /** Abscisses (m) des rangées de boîtes à objets. */
  readonly itemBoxRows: readonly number[];
}

// ---------------------------------------------------------------------------
// Objets
// ---------------------------------------------------------------------------

/** Os (projectile droit), balle de tennis (autoguidée), flaque de boue (piège), croquette turbo (boost). */
export type ItemKind = 'bone' | 'tennis-ball' | 'mud' | 'kibble-turbo';

export type ItemEntityKind = Exclude<ItemKind, 'kibble-turbo'>;

export interface ItemEntity {
  id: number;
  kind: ItemEntityKind;
  ownerId: number;
  position: Vec2;
  prevPosition: Vec2;
  heading: number;
  /** m/s (0 pour la flaque). */
  speed: number;
  /** Temps de vie restant (s). */
  life: number;
  bounces: number;
  /** Cible de la balle de tennis. */
  targetId: number | null;
  trackIndex: number;
  /** Temps restant avant de pouvoir toucher son lanceur. */
  armTime: number;
}

export interface ItemBoxState {
  id: number;
  position: Vec2;
  /** Temps avant réapparition (s) ; 0 = disponible. */
  respawn: number;
}

// ---------------------------------------------------------------------------
// Course
// ---------------------------------------------------------------------------

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RacerState {
  id: number;
  name: string;
  breed: BreedId;
  skins: SkinSelection;
  /** Couleur de carrosserie, format CSS hexadécimal (#rrggbb). */
  kartColor: string;
  isPlayer: boolean;
  /** Multiplicateur de niveau de l'IA (1 pour le joueur). */
  aiSkill: number;
  tuning: KartTuning;
  kart: KartState;
  /** Distance parcourue non bouclée (m) ; négative sur la grille ; tours finis = floor(progress / length). */
  progress: number;
  /** Tour en cours, 1-based, plafonné au nombre de tours. */
  lap: number;
  /** Dernière abscisse curviligne connue (pour mettre à jour progress). */
  lastS: number;
  finished: boolean;
  /** Temps de course à l'arrivée (s). */
  finishTime: number | null;
  /** Classement actuel, 1-based. */
  rank: number;
  item: ItemKind | null;
  /** Temps restant de la roulette ; l'objet n'est utilisable que lorsqu'il vaut 0. */
  itemRoulette: number;
  /** Temps d'invulnérabilité restant après un impact. */
  hitImmunity: number;
}

export interface RaceState {
  phase: RacePhase;
  /** Secondes restantes avant le départ (phase countdown). */
  countdown: number;
  /** Temps de course écoulé depuis le départ (s). */
  time: number;
  laps: number;
  trackLength: number;
  racers: RacerState[];
  playerId: number;
  items: ItemEntity[];
  itemBoxes: ItemBoxState[];
  nextEntityId: number;
  /** Identifiants des pilotes dans l'ordre d'arrivée. */
  finishOrder: number[];
}

/**
 * Événements d'un pas de simulation. Les intensités (`wall`, `bump`) sont normalisées dans [0, 1].
 * `bump` est émis une fois par paire de karts (racerId et otherId). Un même pas peut émettre
 * `lap` et `final-lap` ensemble (dernier tour), ou `lap` et `finish`.
 */
export type GameEvent =
  | { type: 'countdown'; value: number }
  | { type: 'go' }
  | { type: 'drift-start'; racerId: number }
  | { type: 'drift-tier'; racerId: number; tier: DriftTier }
  | { type: 'boost'; racerId: number; source: 'drift' | 'item'; tier: DriftTier }
  | { type: 'wall'; racerId: number; intensity: number }
  | { type: 'bump'; racerId: number; otherId: number; intensity: number }
  | { type: 'item-box'; racerId: number }
  | { type: 'item-ready'; racerId: number; item: ItemKind }
  | { type: 'item-use'; racerId: number; item: ItemKind }
  | { type: 'hit'; racerId: number; by: ItemEntityKind; ownerId: number }
  | { type: 'lap'; racerId: number; lap: number }
  | { type: 'final-lap'; racerId: number }
  | { type: 'finish'; racerId: number; rank: number };

export type EmitEvent = (event: GameEvent) => void;

// ---------------------------------------------------------------------------
// Pilotes (joueur, IA)
// ---------------------------------------------------------------------------

export interface DriverContext {
  racer: RacerState;
  race: RaceState;
  track: TrackQuery;
  dt: number;
}

/** Produit les commandes d'un pilote à chaque pas de simulation. */
export interface DriverController {
  readonly racerId: number;
  update(context: DriverContext): DriverInput;
}

/** Description d'un participant avant la création de la course. */
export interface RacerEntry {
  name: string;
  breed: BreedId;
  skins: SkinSelection;
  kartColor: string;
  isPlayer: boolean;
  aiSkill: number;
}

export type { Rng, Vec2 };
