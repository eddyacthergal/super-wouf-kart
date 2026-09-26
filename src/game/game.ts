/**
 * Point d'entrée du jeu, chargé dynamiquement par Angular : assemble circuit, plateau, simulation,
 * pilotes (IA, joueur au clavier), rendu three.js, bruitages et boucle à pas fixe, puis publie
 * l'état de la course vers l'interface (HUD ~10 Hz, phases, résultats, pause, erreurs).
 */
import { AiController } from './ai/ai-controller';
import { createAiPersonality } from './ai/personality';
import { AudioEngine, type PlayerAudioState } from './audio/audio-engine';
import { RACE_LAPS } from './core/constants';
import { createRng } from './core/rng';
import type {
  DriverController,
  GameEvent,
  RacePhase,
  RaceState,
  RacerState,
  TrackQuery,
} from './core/types';
import { clamp } from './core/vec2';
import { FixedStepLoop } from './engine/fixed-step-loop';
import type {
  CreateGame,
  GameCallbacks,
  GameHandle,
  RaceInfo,
  RaceResultEntry,
  RaceSetup,
} from './game-api';
import { isAppleTouchDevice, requestPlaybackSession, SilentLoop } from './audio/audio-session';
import { buildHudSnapshot, WrongWayTracker } from './hud';
import { KeyboardInput } from './input/keyboard-input';
import {
  combineInputSources,
  PlayerController,
  type DriverInputSource,
} from './input/player-controller';
import { TouchInput } from './input/touch-input';
import { createRoster } from './race/roster';
import { RaceSimulation } from './race/simulation';
import { RaceRenderer } from './render/race-renderer';
import type { RaceSceneOptions } from './render/race-scene';
import { findTrack } from './track/catalog';
import { createTrack, trackOutline } from './track/track';

/** Intervalle de publication du HUD (s). */
const HUD_INTERVAL = 0.1;
/** Intervalle du résumé périodique du journal de débogage (s de course). */
const DEBUG_SUMMARY_INTERVAL = 10;
const LOG_PREFIX = '[WoufKart]';

// ---------------------------------------------------------------------------
// Dépendances (remplaçables dans les tests)
// ---------------------------------------------------------------------------

export interface RendererLike {
  render(state: RaceState, alpha: number, frameDt: number, events: readonly GameEvent[]): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface AudioLike {
  /** Vrai quand le son joue (le navigateur l'a autorisé et ne l'a pas coupé depuis). */
  readonly running: boolean;
  resume(): Promise<void> | void;
  setMuted(muted: boolean): void;
  handleEvents(events: readonly GameEvent[], playerId: number): void;
  updatePlayer(state: PlayerAudioState): void;
  dispose(): void;
}

export interface KeyboardLike extends DriverInputSource {
  attach(): void;
  detach(): void;
  reset(): void;
}

export interface GameDeps {
  createRenderer(
    canvas: HTMLCanvasElement,
    track: TrackQuery,
    racers: readonly RacerState[],
    options: RaceSceneOptions,
  ): RendererLike;
  createAudio(): AudioLike;
  createKeyboard(options: { onPauseRequest(): void }): KeyboardLike;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  /** Horloge en millisecondes (performance.now() par défaut). */
  now?: () => number;
  /** Source aléatoire de la graine quand le setup n'en fournit pas (Math.random par défaut). */
  random?: () => number;
}

export const DEFAULT_DEPS: GameDeps = {
  createRenderer: (canvas, track, racers, options) =>
    new RaceRenderer(canvas, track, racers, options),
  createAudio: () => new AudioEngine(),
  createKeyboard: (options) => new KeyboardInput(options),
};

export const createGame: CreateGame = (canvas, setup, callbacks) =>
  createGameWithDeps(canvas, setup, callbacks, DEFAULT_DEPS);

/**
 * Crée une partie. Si l'assemblage échoue (WebGL indisponible…), l'erreur est transmise à
 * `callbacks.onError`, ce qui a déjà été créé est libéré et un handle inerte est renvoyé.
 */
export function createGameWithDeps(
  canvas: HTMLCanvasElement,
  setup: RaceSetup,
  callbacks: GameCallbacks,
  deps: GameDeps,
): GameHandle {
  const cleanups: (() => void)[] = [];
  try {
    return startRace(canvas, setup, callbacks, deps, cleanups);
  } catch (error) {
    runCleanups(cleanups);
    callbacks.onError(error);
    return inertHandle();
  }
}

// ---------------------------------------------------------------------------
// Assemblage
// ---------------------------------------------------------------------------

/** Assemble et démarre la course ; chaque ressource créée inscrit sa libération dans `cleanups`. */
function startRace(
  canvas: HTMLCanvasElement,
  setup: RaceSetup,
  callbacks: GameCallbacks,
  deps: GameDeps,
  cleanups: (() => void)[],
): GameHandle {
  const seed = setup.seed ?? randomSeed(deps.random ?? Math.random);
  const rng = createRng(seed);
  const definition = findTrack(setup.trackId);
  const track = createTrack(definition);
  const entries = createRoster(setup.playerBreed, setup.playerSkins, rng);
  const laps = setup.laps ?? definition.laps ?? RACE_LAPS;
  const sim = new RaceSimulation(track, entries, { laps, rng });
  const state = sim.state;
  const player = state.racers.find((racer) => racer.id === state.playerId);
  const log = createLogger(setup.debug === true);

  const renderer = deps.createRenderer(canvas, track, state.racers, {
    reducedMotion: setup.reducedMotion,
    theme: definition.theme,
    decor: definition.decor,
  });
  cleanups.push(() => renderer.dispose());

  // iPhone, iPad : le son du jeu doit passer même en mode silencieux (voir audio-session).
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  requestPlaybackSession(nav);
  const silentLoop =
    isAppleTouchDevice(nav) && typeof Audio === 'function'
      ? new SilentLoop(() => new Audio())
      : null;
  if (silentLoop) cleanups.push(() => silentLoop.dispose());
  const audio = deps.createAudio();
  cleanups.push(() => audio.dispose());
  audio.setMuted(setup.muted);

  let paused = false;
  let disposed = false;

  // La touche pause ne fait que mettre en pause : la reprise passe par le menu de l'interface.
  const keyboard = deps.createKeyboard({ onPauseRequest: () => requestPause() });
  keyboard.attach();
  cleanups.push(() => keyboard.detach());
  // Boutons à l'écran (téléphone, tablette), en plus du clavier.
  const touch = setup.touchControls === true ? new TouchInput() : null;
  const playerInput: DriverInputSource = touch ? combineInputSources([keyboard, touch]) : keyboard;

  const controllers = new Map<number, DriverController>();
  for (const racer of state.racers) {
    const byAi = !racer.isPlayer || setup.autopilot === true;
    controllers.set(
      racer.id,
      byAi
        ? new AiController(racer.id, createAiPersonality(rng, racer.id), rng)
        : new PlayerController(racer.id, playerInput),
    );
  }

  // --- Boucle -------------------------------------------------------------

  /** Événements des pas depuis la dernière image (rendu), et ceux transmis à l'audio. */
  const frameEvents: GameEvent[] = [];
  const audioEvents: GameEvent[] = [];
  const wrongWayTracker = new WrongWayTracker();
  let wrongWay = false;
  let phase: RacePhase = state.phase;
  let resultsSent = false;
  let hudElapsed = 0;
  let nextSummary = DEBUG_SUMMARY_INTERVAL;

  const publishHud = (): void => callbacks.onHud(buildHudSnapshot(state, wrongWay));

  const playerAudio = (active: boolean): PlayerAudioState => {
    if (!player) return { ...SILENT_PLAYER };
    const kart = player.kart;
    const maxSpeed = player.tuning.maxSpeed;
    return {
      speed01: maxSpeed > 0 ? clamp(Math.abs(kart.speed) / maxSpeed, 0, 1) : 0,
      drifting: kart.drift.active,
      driftTier: kart.drift.active ? kart.drift.tier : 0,
      boosting: kart.boostTime > 0,
      offroad: kart.offroad,
      active: active && state.phase === 'racing',
    };
  };

  const step = (dt: number): void => {
    // Après l'arrivée, le kart du joueur roule en pilote automatique derrière les résultats : silence,
    // hormis les arrivées.
    const playerDone = player?.finished ?? false;
    for (const event of sim.step(dt, controllers)) {
      frameEvents.push(event);
      if (!playerDone || event.type === 'finish') audioEvents.push(event);
      logEvent(log, state, event);
    }

    if (player && state.phase === 'racing' && !player.finished) {
      wrongWay = wrongWayTracker.update(player, track, dt);
    } else {
      wrongWayTracker.reset();
      wrongWay = false;
    }

    if (state.phase !== phase) {
      phase = state.phase;
      callbacks.onPhase(phase);
      publishHud();
      hudElapsed = 0;
    }
    const results = sim.results;
    if (!resultsSent && results) {
      resultsSent = true;
      log(`Résultats : ${describeResults(results)}`);
      callbacks.onResults(results);
    }
    if (state.phase === 'racing' && state.time >= nextSummary) {
      nextSummary += DEBUG_SUMMARY_INTERVAL;
      if (player) {
        log(
          `t = ${state.time.toFixed(1)} s · rang ${player.rank}/${state.racers.length} · tour ${player.lap}/${state.laps}`,
        );
      }
    }
  };

  const render = (alpha: number, frameDt: number): void => {
    renderer.render(state, alpha, frameDt, frameEvents);
    if (audioEvents.length > 0) audio.handleEvents(audioEvents, state.playerId);
    audio.updatePlayer(playerAudio(true));
    hudElapsed += frameDt;
    if (hudElapsed >= HUD_INTERVAL) {
      hudElapsed = Math.min(hudElapsed - HUD_INTERVAL, HUD_INTERVAL);
      publishHud();
    }
    frameEvents.length = 0;
    audioEvents.length = 0;
  };

  const loop = new FixedStepLoop({
    step,
    render,
    requestFrame: deps.requestFrame,
    cancelFrame: deps.cancelFrame,
    now: deps.now,
    onError: (error) => {
      audio.updatePlayer(playerAudio(false));
      callbacks.onError(error);
    },
  });
  cleanups.push(() => loop.stop());

  // --- Pause, reprise, libération ------------------------------------------

  const pause = (): void => {
    if (disposed || paused) return;
    paused = true;
    loop.stop();
    keyboard.reset();
    touch?.reset();
    audio.updatePlayer(playerAudio(false));
    log('Pause');
    callbacks.onPauseChange(true);
  };

  const resume = (): void => {
    if (disposed || !paused) return;
    paused = false;
    // Touches enfoncées pendant la pause (menu) : oubliées, la répétition les rétablit si besoin.
    keyboard.reset();
    touch?.reset();
    loop.start();
    log('Reprise');
    callbacks.onPauseChange(false);
  };

  /** Pause venue du jeu (touche, onglet masqué) : ignorée sur l'écran des résultats. */
  function requestPause(): void {
    if (state.phase !== 'finished') pause();
  }

  // --- Écouteurs du document ------------------------------------------------

  const doc = canvas.ownerDocument;
  const resize = (): void => renderer.resize(canvas.clientWidth, canvas.clientHeight);
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    cleanups.push(() => observer.disconnect());
  } else {
    const view = doc.defaultView;
    view?.addEventListener('resize', resize);
    cleanups.push(() => view?.removeEventListener('resize', resize));
  }
  resize();

  const onVisibilityChange = (): void => {
    if (doc.hidden) requestPause();
  };
  doc.addEventListener('visibilitychange', onVisibilityChange);
  cleanups.push(() => doc.removeEventListener('visibilitychange', onVisibilityChange));

  // Le son est autorisé tout de suite (on arrive ici par un clic) et, par précaution, au premier geste.
  const resumeAudio = (): void => {
    try {
      void Promise.resolve(audio.resume()).catch(() => undefined);
    } catch {
      // Son refusé : la course reste jouable en silence.
    }
  };
  // Tant que le son ne joue pas, chaque geste le réautorise : sur écran tactile, le navigateur ne
  // l'accepte qu'au relâchement du doigt (pointerup, touchend, click), et il peut le couper en cours
  // de partie (appel, passage à une autre application).
  const onGesture = (): void => {
    if (disposed) return;
    silentLoop?.play();
    if (!audio.running) resumeAudio();
  };
  for (const type of GESTURE_EVENTS) doc.addEventListener(type, onGesture, true);
  cleanups.push(() => {
    for (const type of GESTURE_EVENTS) doc.removeEventListener(type, onGesture, true);
  });

  // --- Handle et démarrage ---------------------------------------------------

  const handle: GameHandle = {
    get paused() {
      return paused;
    },
    pause,
    resume,
    setMuted: (muted) => {
      if (!disposed) audio.setMuted(muted);
    },
    setTouchControl: (action, pressed) => {
      // En pause, les appuis sont ignorés : la reprise repart de commandes relâchées.
      if (!disposed && !paused) touch?.set(action, pressed);
    },
    setTouchSteer: (steer) => {
      if (!disposed && !paused) touch?.setSteer(steer);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      runCleanups(cleanups);
    },
  };

  const info: RaceInfo = {
    trackId: definition.id,
    trackName: definition.name,
    laps: state.laps,
    racers: state.racers.map((racer) => ({
      id: racer.id,
      name: racer.name,
      breed: racer.breed,
      kartColor: racer.kartColor,
      isPlayer: racer.isPlayer,
    })),
    trackOutline: trackOutline(track),
  };
  log(
    `Course prête (${definition.name}) : ${state.racers.length} pilotes, ${state.laps} tour(s), graine ${seed}` +
      (setup.autopilot ? ', pilote automatique' : ''),
  );
  callbacks.onReady(info);
  callbacks.onPhase(state.phase);
  publishHud();
  // Souvent encore dans le geste qui a lancé la course (bouton « Jouer ») : autant essayer tout de suite.
  silentLoop?.play();
  resumeAudio();
  loop.start();
  return handle;
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

const SILENT_PLAYER: PlayerAudioState = {
  speed01: 0,
  drifting: false,
  driftTier: 0,
  boosting: false,
  offroad: false,
  active: false,
};

/** Graine entière 32 bits non signée. */
function randomSeed(random: () => number): number {
  const value = random();
  return Number.isFinite(value) ? Math.floor(value * 0x1_0000_0000) >>> 0 : 0;
}

/** Handle d'une partie qui n'a pas pu démarrer : toutes les méthodes sont sans effet. */
/** Gestes de l'utilisateur qui autorisent le son (le relâchement du doigt compte sur écran tactile). */
const GESTURE_EVENTS = ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'] as const;

function inertHandle(): GameHandle {
  return {
    paused: false,
    pause: () => undefined,
    resume: () => undefined,
    setMuted: () => undefined,
    setTouchControl: () => undefined,
    setTouchSteer: () => undefined,
    dispose: () => undefined,
  };
}

/** Libère dans l'ordre inverse de création ; une libération qui échoue n'empêche pas les suivantes. */
function runCleanups(cleanups: (() => void)[]): void {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    try {
      cleanup?.();
    } catch (error) {
      console.error(`${LOG_PREFIX} Échec de la libération d'une ressource`, error);
    }
  }
}

type Logger = (message: string) => void;

function createLogger(enabled: boolean): Logger {
  return enabled ? (message) => console.info(`${LOG_PREFIX} ${message}`) : () => undefined;
}

const formatSeconds = (seconds: number): string => `${seconds.toFixed(2)} s`;

/** Journal de débogage : départ, tours du joueur, dernier tour, arrivées. */
function logEvent(log: Logger, state: RaceState, event: GameEvent): void {
  switch (event.type) {
    case 'go':
      log('Départ !');
      return;
    case 'lap':
      if (event.racerId === state.playerId) {
        log(`Tour ${event.lap}/${state.laps} (${formatSeconds(state.time)})`);
      }
      return;
    case 'final-lap':
      if (event.racerId === state.playerId) log('Dernier tour !');
      return;
    case 'finish': {
      const racer = state.racers.find((candidate) => candidate.id === event.racerId);
      if (!racer) return;
      const who = racer.isPlayer ? `${racer.name} (joueur)` : racer.name;
      log(`Arrivée : ${who}, rang ${event.rank}, ${formatSeconds(racer.finishTime ?? state.time)}`);
      return;
    }
    default:
      return;
  }
}

function describeResults(results: readonly RaceResultEntry[]): string {
  return results
    .map(
      (entry) =>
        `${entry.rank}. ${entry.name}${entry.isPlayer ? ' (joueur)' : ''} ${formatSeconds(entry.time)}` +
        (entry.estimated ? ' (estimé)' : ''),
    )
    .join(', ');
}
