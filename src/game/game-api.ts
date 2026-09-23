/**
 * API publique du jeu, consommée par l'interface Angular.
 * Angular n'importe QUE ce fichier (types) et, dynamiquement, `createGame` depuis ./game.
 */
import type { BreedId, DriftTier, ItemKind, RacePhase, SkinSelection } from './core/types';
import type { Vec2 } from './core/vec2';

export interface RaceSetup {
  playerBreed: BreedId;
  playerSkins: SkinSelection;
  /** Nombre de tours (par défaut RACE_LAPS). */
  laps?: number;
  /** Graine aléatoire (par défaut : aléatoire). */
  seed?: number;
  /** Le kart du joueur est piloté par l'IA (démo et vérifications automatiques). */
  autopilot?: boolean;
  muted: boolean;
  /** Préférence « réduire les animations » : pas de secousses ni d'effet de champ de vision. */
  reducedMotion: boolean;
  /** Journalise les événements clés dans la console (préfixe « [WoufKart] »). */
  debug?: boolean;
}

export interface RacerInfo {
  id: number;
  name: string;
  breed: BreedId;
  kartColor: string;
  isPlayer: boolean;
}

/** Données statiques envoyées une fois, quand la course est prête. */
export interface RaceInfo {
  laps: number;
  racers: RacerInfo[];
  /** Tracé de la ligne médiane (sous-échantillonné) pour la mini-carte. */
  trackOutline: Vec2[];
}

export interface MinimapDot {
  id: number;
  x: number;
  z: number;
}

/** État affiché par le HUD, publié ~10 fois par seconde. */
export interface HudSnapshot {
  phase: RacePhase;
  /** Valeur du compte à rebours affichée (3, 2, 1) ou null. */
  countdown: number | null;
  lap: number;
  laps: number;
  rank: number;
  racerCount: number;
  /** Temps de course (s). */
  raceTime: number;
  item: ItemKind | null;
  /** Vrai pendant la roulette de l'objet. */
  itemRolling: boolean;
  driftTier: DriftTier;
  boosting: boolean;
  /** Vrai si le joueur roule dans le mauvais sens depuis un moment. */
  wrongWay: boolean;
  /** Vitesse du joueur (km/h, pour l'affichage). */
  speedKmh: number;
  dots: MinimapDot[];
}

export interface RaceResultEntry {
  rank: number;
  racerId: number;
  name: string;
  breed: BreedId;
  isPlayer: boolean;
  /** Temps total (s). */
  time: number;
  /** Vrai si le temps est estimé (pilote pas encore arrivé quand le joueur a fini). */
  estimated: boolean;
}

export interface GameCallbacks {
  onReady(info: RaceInfo): void;
  onHud(snapshot: HudSnapshot): void;
  onPhase(phase: RacePhase): void;
  onResults(results: RaceResultEntry[]): void;
  /** Pause déclenchée ou levée, y compris par le jeu lui-même (touche Échap/P, onglet masqué). */
  onPauseChange(paused: boolean): void;
  onError(error: unknown): void;
}

export interface GameHandle {
  readonly paused: boolean;
  /** Met en pause (sans effet si déjà en pause) et appelle onPauseChange(true). */
  pause(): void;
  /** Reprend (sans effet si pas en pause) et appelle onPauseChange(false). */
  resume(): void;
  setMuted(muted: boolean): void;
  /** Arrête la boucle, retire les écouteurs clavier et libère les ressources WebGL et audio. */
  dispose(): void;
}

export type CreateGame = (canvas: HTMLCanvasElement, setup: RaceSetup, callbacks: GameCallbacks) => GameHandle;
