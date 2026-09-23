/**
 * Simulation d'une course complète, un pas fixe à la fois : compte à rebours, pilotage (joueur ou IA),
 * physique des karts avec rubber band des IA, objets, collisions, progression, classement et résultats.
 * Aucune dépendance au rendu : la simulation est déterministe pour une graine donnée.
 */
import type {
  DriverContext,
  DriverController,
  EmitEvent,
  GameEvent,
  KartEvent,
  KartTuning,
  RaceState,
  RacerEntry,
  RacerState,
  Rng,
  TrackQuery,
} from '../core/types';
import { clamp, clone } from '../core/vec2';
import { AiController } from '../ai/ai-controller';
import { createAiPersonality } from '../ai/personality';
import type { RaceResultEntry } from '../game-api';
import { stepItems, useItem } from '../items/item-system';
import { stepKart } from '../kart/kart-physics';
import { resolveKartCollisions } from './collisions';
import { updateProgress } from './progress';
import { createRaceState } from './race-setup';
import { computeRanks } from './ranking';
import { computeResults } from './results';

export interface RaceSimulationOptions {
  laps?: number;
  rng: Rng;
}

/** Rubber band : écart de progression (m) qui donne la pleine correction de vitesse… */
const RUBBER_BAND_DISTANCE = 400;
/** … et correction correspondante (fraction de la vitesse max). */
const RUBBER_BAND_GAIN = 0.08;
const RUBBER_BAND_MIN = 0.94;
const RUBBER_BAND_MAX = 1.08;
/** Tolérance sur le compte à rebours (cumul d'erreurs d'arrondi des pas fixes). */
const COUNTDOWN_EPSILON = 1e-9;

export class RaceSimulation {
  readonly state: RaceState;
  readonly track: TrackQuery;

  private readonly rng: Rng;
  /** Pilotes IA internes (joueur arrivé, pilote sans contrôleur), créés à la demande. */
  private readonly fallbackControllers = new Map<number, AiController>();
  /** Réglages effectifs de chaque pilote (rubber band), réutilisés d'un pas à l'autre. */
  private readonly effectiveTunings: KartTuning[];
  /** Relais des événements de stepKart, un par pilote (créés une fois). */
  private readonly kartEmitters: ((event: KartEvent) => void)[];
  /** Contexte transmis aux contrôleurs, un par pilote (créé une fois ; seul `dt` change). */
  private readonly contexts: DriverContext[];
  private readonly emit: EmitEvent = (event) => this.events?.push(event);
  /** Événements du pas en cours ; null hors de step() (rien n'est alors collecté). */
  private events: GameEvent[] | null = null;
  /** Dernière valeur annoncée du compte à rebours (null avant le premier pas). */
  private countdownShown: number | null = null;
  private finalResults: RaceResultEntry[] | null = null;

  constructor(track: TrackQuery, entries: readonly RacerEntry[], options: RaceSimulationOptions) {
    this.track = track;
    this.rng = options.rng;
    this.state = createRaceState(track, entries, { laps: options.laps });
    this.effectiveTunings = this.state.racers.map((racer) => ({ ...racer.tuning }));
    this.kartEmitters = this.state.racers.map(
      (racer) => (event: KartEvent) => this.events?.push({ ...event, racerId: racer.id }),
    );
    this.contexts = this.state.racers.map((racer) => ({
      racer,
      race: this.state,
      track,
      dt: 0,
    }));
  }

  /** Résultats figés à l'arrivée du joueur (null avant). */
  get results(): RaceResultEntry[] | null {
    return this.finalResults;
  }

  /** Avance d'un pas de `dt` secondes ; renvoie les événements de ce pas. */
  step(dt: number, controllers: ReadonlyMap<number, DriverController>): GameEvent[] {
    const events: GameEvent[] = [];
    if (!(dt > 0 && Number.isFinite(dt))) return events;
    this.events = events;
    try {
      if (this.state.phase === 'countdown') this.stepCountdown(dt, controllers);
      else this.stepRace(dt, controllers);
    } finally {
      // Les relais ne doivent plus écrire dans le tableau rendu à l'appelant.
      this.events = null;
    }
    return events;
  }

  /** Contexte du pilote n° `index` pour ce pas (objet réutilisé). */
  private contextFor(index: number, racer: RacerState, dt: number): DriverContext {
    const context = this.contexts[index];
    context.racer = racer;
    context.dt = dt;
    return context;
  }

  private stepCountdown(dt: number, controllers: ReadonlyMap<number, DriverController>): void {
    const state = this.state;
    const racers = state.racers;
    for (let i = 0; i < racers.length; i++) {
      const racer = racers[i];
      // Les commandes sont lues puis ignorées : un appui mémorisé (objet) ne part pas au « GO ».
      this.controllerFor(racer, controllers).update(this.contextFor(i, racer, dt));
      freeze(racer);
    }

    if (this.countdownShown === null) {
      this.countdownShown = Math.ceil(state.countdown - COUNTDOWN_EPSILON);
      if (this.countdownShown >= 1) this.emit({ type: 'countdown', value: this.countdownShown });
    }
    state.countdown = Math.max(0, state.countdown - dt);
    const over = state.countdown <= COUNTDOWN_EPSILON;
    // Une valeur par seconde entière franchie (même si un grand pas en franchit plusieurs).
    const target = over ? 1 : Math.ceil(state.countdown - COUNTDOWN_EPSILON);
    while (this.countdownShown > target) {
      this.countdownShown--;
      this.emit({ type: 'countdown', value: this.countdownShown });
    }
    if (!over) return;
    state.countdown = 0;
    state.phase = 'racing';
    state.time = 0;
    this.emit({ type: 'go' });
  }

  private stepRace(dt: number, controllers: ReadonlyMap<number, DriverController>): void {
    const state = this.state;
    const track = this.track;
    state.time += dt;

    const racers = state.racers;
    for (let i = 0; i < racers.length; i++) {
      const racer = racers[i];
      const input = this.controllerFor(racer, controllers).update(this.contextFor(i, racer, dt));
      stepKart(racer.kart, input, this.tuningFor(racer, i), track, dt, this.kartEmitters[i]);
      if (input.useItem) useItem(state, racer, track, input.brake, this.emit);
    }

    resolveKartCollisions(racers, this.emit);
    stepItems(state, track, this.rng, dt, this.emit);
    for (const racer of racers) updateProgress(racer, state, track, this.emit);
    computeRanks(state);

    if (state.phase === 'racing' && this.raceIsOver()) {
      state.phase = 'finished';
      this.finalResults = computeResults(state);
    }
  }

  /** Le joueur a franchi l'arrivée ; sans joueur, tous les pilotes sont arrivés. */
  private raceIsOver(): boolean {
    const player = this.player();
    if (player) return player.finished;
    const racers = this.state.racers;
    return racers.length > 0 && racers.every((racer) => racer.finished);
  }

  /** Pilote du joueur (l'id d'un pilote est son indice dans `racers`). */
  private player(): RacerState | undefined {
    const { racers, playerId } = this.state;
    return playerId >= 0 && playerId < racers.length ? racers[playerId] : undefined;
  }

  /** Contrôleur fourni, ou pilote IA interne pour le joueur arrivé et les pilotes sans contrôleur. */
  private controllerFor(
    racer: RacerState,
    controllers: ReadonlyMap<number, DriverController>,
  ): DriverController {
    const provided = controllers.get(racer.id);
    if (provided && !(racer.isPlayer && racer.finished)) return provided;
    let fallback = this.fallbackControllers.get(racer.id);
    if (!fallback) {
      fallback = new AiController(racer.id, createAiPersonality(this.rng, racer.id), this.rng);
      this.fallbackControllers.set(racer.id, fallback);
    }
    return fallback;
  }

  /**
   * Réglages du pas : ceux du joueur tels quels ; pour une IA, vitesse max × niveau × rubber band
   * (plus rapide quand le joueur est devant, plus lente quand il est derrière).
   */
  private tuningFor(racer: RacerState, index: number): KartTuning {
    if (racer.isPlayer) return racer.tuning;
    const tuning = this.effectiveTunings[index];
    const base = racer.tuning;
    tuning.acceleration = base.acceleration;
    tuning.turnRate = base.turnRate;
    tuning.mass = base.mass;
    tuning.offroadFactor = base.offroadFactor;
    tuning.maxSpeed = base.maxSpeed * racer.aiSkill * this.rubberBand(racer);
    return tuning;
  }

  private rubberBand(racer: RacerState): number {
    const player = this.player();
    if (!player || player === racer) return 1;
    const gap = player.progress - racer.progress;
    const factor = 1 + (gap / RUBBER_BAND_DISTANCE) * RUBBER_BAND_GAIN;
    return Number.isFinite(factor) ? clamp(factor, RUBBER_BAND_MIN, RUBBER_BAND_MAX) : 1;
  }
}

/** Kart immobile : l'état « au début du pas » reste égal à l'état courant (interpolation stable). */
function freeze(racer: RacerState): void {
  const kart = racer.kart;
  if (kart.prevPosition.x !== kart.position.x || kart.prevPosition.z !== kart.position.z) {
    kart.prevPosition = clone(kart.position);
  }
  kart.prevHeading = kart.heading;
}
