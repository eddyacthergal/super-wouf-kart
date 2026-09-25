import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAudioState } from './audio/audio-engine';
import {
  NEUTRAL_INPUT,
  type DriverInput,
  type GameEvent,
  type RacePhase,
  type RaceState,
} from './core/types';
import {
  createGameWithDeps,
  type AudioLike,
  type GameDeps,
  type KeyboardLike,
  type RendererLike,
} from './game';
import type {
  GameCallbacks,
  GameHandle,
  HudSnapshot,
  RaceInfo,
  RaceResultEntry,
  RaceSetup,
} from './game-api';

// ---------------------------------------------------------------------------
// Doublures
// ---------------------------------------------------------------------------

class FakeRenderer implements RendererLike {
  renderCount = 0;
  lastState: RaceState | null = null;
  /** Événements reçus, avec la phase au moment du rendu. */
  readonly received: { phase: RacePhase; playerFinished: boolean; event: GameEvent }[] = [];
  readonly resizes: [number, number][] = [];
  disposeCalls = 0;
  failWith: unknown = null;

  render(state: RaceState, _alpha: number, _frameDt: number, events: readonly GameEvent[]): void {
    if (this.failWith !== null) throw this.failWith;
    this.renderCount++;
    this.lastState = state;
    const playerFinished = state.racers[state.playerId]?.finished ?? false;
    for (const event of events) this.received.push({ phase: state.phase, playerFinished, event });
  }

  resize(width: number, height: number): void {
    this.resizes.push([width, height]);
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

class FakeAudio implements AudioLike {
  running = false;
  resumeCalls = 0;
  readonly mutedCalls: boolean[] = [];
  /** Lots d'événements reçus (copiés : le jeu réutilise son tableau), avec l'état du joueur. */
  readonly batches: { playerFinishedBefore: boolean; events: GameEvent[] }[] = [];
  readonly players: PlayerAudioState[] = [];
  disposeCalls = 0;
  playerFinished: () => boolean = () => false;

  resume(): Promise<void> {
    this.resumeCalls++;
    return Promise.resolve();
  }

  setMuted(muted: boolean): void {
    this.mutedCalls.push(muted);
  }

  handleEvents(events: readonly GameEvent[]): void {
    this.batches.push({ playerFinishedBefore: this.playerFinished(), events: [...events] });
  }

  updatePlayer(state: PlayerAudioState): void {
    this.players.push(state);
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

class FakeKeyboard implements KeyboardLike {
  attachCalls = 0;
  detachCalls = 0;
  resetCalls = 0;
  readCalls = 0;

  constructor(readonly onPauseRequest: () => void) {}

  attach(): void {
    this.attachCalls++;
  }

  detach(): void {
    this.detachCalls++;
  }

  reset(): void {
    this.resetCalls++;
  }

  readDriverInput(): DriverInput {
    this.readCalls++;
    return { ...NEUTRAL_INPUT, throttle: true };
  }
}

/** requestAnimationFrame manuel et horloge pilotée par le test. */
class ManualFrames {
  time = 0;
  private nextId = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  readonly requestFrame = (callback: FrameRequestCallback): number => {
    const id = this.nextId++;
    this.callbacks.set(id, callback);
    return id;
  };

  readonly cancelFrame = (id: number): void => {
    this.callbacks.delete(id);
  };

  readonly now = (): number => this.time;

  get pending(): number {
    return this.callbacks.size;
  }

  /** Avance l'horloge de `ms` puis exécute les frames programmées. */
  frame(ms = 1000 / 60): void {
    this.time += ms;
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback(this.time);
  }

  frames(count: number, ms?: number): void {
    for (let i = 0; i < count; i++) this.frame(ms);
  }
}

interface Recorder {
  callbacks: GameCallbacks;
  log: string[];
  huds: HudSnapshot[];
  phases: RacePhase[];
  results: RaceResultEntry[][];
  pauses: boolean[];
  errors: unknown[];
  info: RaceInfo | null;
}

function recorder(): Recorder {
  const rec: Recorder = {
    log: [],
    huds: [],
    phases: [],
    results: [],
    pauses: [],
    errors: [],
    info: null,
    callbacks: {
      onReady: (info) => {
        rec.info = info;
        rec.log.push('ready');
      },
      onHud: (hud) => {
        rec.huds.push(hud);
        rec.log.push('hud');
      },
      onPhase: (phase) => {
        rec.phases.push(phase);
        rec.log.push(`phase:${phase}`);
      },
      onResults: (results) => {
        rec.results.push(results);
        rec.log.push('results');
      },
      onPauseChange: (paused) => {
        rec.pauses.push(paused);
        rec.log.push(`pause:${paused}`);
      },
      onError: (error) => {
        rec.errors.push(error);
        rec.log.push('error');
      },
    },
  };
  return rec;
}

interface Harness {
  canvas: HTMLCanvasElement;
  renderer: FakeRenderer;
  audio: FakeAudio;
  keyboards: FakeKeyboard[];
  frames: ManualFrames;
  rec: Recorder;
  deps: GameDeps;
  readonly keyboard: FakeKeyboard;
}

function harness(): Harness {
  const renderer = new FakeRenderer();
  const audio = new FakeAudio();
  const keyboards: FakeKeyboard[] = [];
  const frames = new ManualFrames();
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 450 });
  const deps: GameDeps = {
    createRenderer: () => renderer,
    createAudio: () => audio,
    createKeyboard: ({ onPauseRequest }) => {
      const keyboard = new FakeKeyboard(onPauseRequest);
      keyboards.push(keyboard);
      return keyboard;
    },
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    now: frames.now,
    random: () => 0.25,
  };
  return {
    canvas,
    renderer,
    audio,
    keyboards,
    frames,
    rec: recorder(),
    deps,
    get keyboard(): FakeKeyboard {
      const keyboard = keyboards[0];
      if (!keyboard) throw new Error('Aucun clavier créé.');
      return keyboard;
    },
  };
}

const SETUP: RaceSetup = {
  playerBreed: 'jack-russell',
  playerSkins: { head: null, neck: null, body: null },
  seed: 7,
  muted: false,
  reducedMotion: false,
};

/** Parties créées par le test en cours, libérées après chaque test (écouteurs du document). */
const games: GameHandle[] = [];

function start(h: Harness, overrides: Partial<RaceSetup> = {}): GameHandle {
  const game = createGameWithDeps(h.canvas, { ...SETUP, ...overrides }, h.rec.callbacks, h.deps);
  games.push(game);
  return game;
}

/** Frame de 250 ms : la boucle simule alors son maximum de 5 pas (course accélérée). */
const FAST_FRAME_MS = 250;

/** Vrai si le joueur a franchi l'arrivée, d'après le dernier état rendu. */
function playerFinished(h: Harness): boolean {
  const state = h.renderer.lastState;
  return state ? (state.racers[state.playerId]?.finished ?? false) : false;
}

/** Enchaîne des frames accélérées jusqu'aux résultats (au plus `maxFrames`). */
function runUntilResults(h: Harness, maxFrames = 4000): void {
  let frames = 0;
  while (h.rec.results.length === 0 && frames++ < maxFrames) h.frames.frame(FAST_FRAME_MS);
}

afterEach(() => {
  for (const game of games.splice(0)) game.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createGameWithDeps — démarrage', () => {
  it('appelle onReady puis onPhase(countdown) puis publie un premier HUD, et lance la boucle', () => {
    const h = harness();
    start(h);
    expect(h.rec.log).toEqual(['ready', 'phase:countdown', 'hud']);
    expect(h.rec.info?.laps).toBe(3);
    expect(h.rec.info?.racers).toHaveLength(8);
    expect(h.rec.info?.racers.filter((racer) => racer.isPlayer)).toHaveLength(1);
    expect(h.rec.info?.trackOutline.length).toBeGreaterThan(20);
    expect(h.rec.huds[0]).toMatchObject({
      phase: 'countdown',
      countdown: 3,
      lap: 1,
      laps: 3,
      rank: 8,
      racerCount: 8,
    });
    expect(h.frames.pending).toBe(1);
  });

  it('applique le réglage muet, autorise le son, attache le clavier et dimensionne le rendu', () => {
    const h = harness();
    start(h, { muted: true });
    expect(h.audio.mutedCalls).toEqual([true]);
    expect(h.audio.resumeCalls).toBe(1);
    expect(h.keyboards).toHaveLength(1);
    expect(h.keyboard.attachCalls).toBe(1);
    expect(h.renderer.resizes).toContainEqual([800, 450]);
  });

  it('respecte le nombre de tours demandé', () => {
    const h = harness();
    start(h, { laps: 1 });
    expect(h.rec.info?.laps).toBe(1);
    expect(h.rec.huds[0].laps).toBe(1);
  });

  it('même graine, même plateau', () => {
    const a = harness();
    const b = harness();
    start(a, { seed: 42 });
    start(b, { seed: 42 });
    expect(a.rec.info).toEqual(b.rec.info);
  });

  it('le joueur est piloté au clavier, sauf en pilote automatique (le clavier reste attaché pour la pause)', () => {
    const manual = harness();
    start(manual);
    manual.frames.frames(3);
    expect(manual.keyboard.readCalls).toBeGreaterThan(0);

    const auto = harness();
    start(auto, { autopilot: true });
    auto.frames.frames(3);
    expect(auto.keyboard.attachCalls).toBe(1);
    expect(auto.keyboard.readCalls).toBe(0);
  });
});

describe('createGameWithDeps — commandes tactiles', () => {
  /** Kart du joueur d'après le dernier état rendu. */
  const playerKart = (h: Harness) => {
    const state = h.renderer.lastState;
    if (!state) throw new Error('Aucun rendu.');
    return state.racers[state.playerId].kart;
  };

  /** Frames accélérées jusqu'au départ (fin du compte à rebours). */
  const untilRacing = (h: Harness): void => {
    let frames = 0;
    while (h.rec.phases.at(-1) !== 'racing' && frames++ < 200) h.frames.frame(FAST_FRAME_MS);
    expect(h.rec.phases.at(-1)).toBe('racing');
  };

  it('joystick et boutons à l’écran s’ajoutent au clavier : direction analogique, frein qui l’emporte sur les gaz', () => {
    const h = harness();
    const game = start(h, { touchControls: true });
    untilRacing(h);

    game.setTouchSteer(-1);
    h.frames.frames(20);
    expect(playerKart(h).steer).toBeLessThan(-0.9);
    game.setTouchSteer(0.5);
    h.frames.frames(20);
    expect(playerKart(h).steer).toBeCloseTo(0.5, 2);
    game.setTouchSteer(0);
    h.frames.frames(20);
    expect(Math.abs(playerKart(h).steer)).toBeLessThan(0.05);

    h.frames.frames(40);
    const cruising = playerKart(h).speed;
    expect(cruising).toBeGreaterThan(5);
    // Le clavier factice tient les gaz : le frein tactile doit quand même ralentir le kart.
    game.setTouchControl('brake', true);
    h.frames.frames(20);
    expect(playerKart(h).speed).toBeLessThan(cruising - 3);
  });

  it('sans commandes tactiles, ou en pause, les appuis sont ignorés', () => {
    const keyboardOnly = harness();
    const game = start(keyboardOnly);
    untilRacing(keyboardOnly);
    game.setTouchSteer(-1);
    keyboardOnly.frames.frames(20);
    expect(playerKart(keyboardOnly).steer).toBe(0);

    const paused = harness();
    const touchGame = start(paused, { touchControls: true });
    untilRacing(paused);
    touchGame.pause();
    touchGame.setTouchSteer(-1);
    touchGame.resume();
    paused.frames.frames(20);
    expect(playerKart(paused).steer).toBe(0);
  });
});

describe('createGameWithDeps — boucle', () => {
  it('rend chaque frame et publie le HUD environ toutes les 100 ms', () => {
    const h = harness();
    start(h);
    h.frames.frames(60);
    expect(h.renderer.renderCount).toBe(60);
    // Un HUD au démarrage + ~10 par seconde.
    expect(h.rec.huds.length).toBeGreaterThanOrEqual(9);
    expect(h.rec.huds.length).toBeLessThanOrEqual(12);
  });

  it('transmet au rendu les événements des pas, une seule fois, puis vide le tableau', () => {
    const h = harness();
    start(h);
    h.frames.frames(4 * 60);
    const types = h.renderer.received.map((entry) => entry.event.type);
    expect(types.filter((type) => type === 'countdown')).toHaveLength(3);
    expect(types.filter((type) => type === 'go')).toHaveLength(1);
    expect(
      h.audio.batches.flatMap((batch) => batch.events).filter((event) => event.type === 'go'),
    ).toHaveLength(1);
  });

  it('module les sons continus du joueur (actifs seulement en course)', () => {
    const h = harness();
    start(h);
    h.frames.frames(30);
    expect(h.audio.players.at(-1)).toMatchObject({ active: false, speed01: 0 });
    h.frames.frames(4 * 60);
    const last = h.audio.players.at(-1);
    expect(last?.active).toBe(true);
    expect(last?.speed01).toBeGreaterThan(0);
    expect(last?.speed01).toBeLessThanOrEqual(1);
  });

  it('course accélérée en pilote automatique : countdown → racing → finished, résultats une seule fois, sons filtrés après l’arrivée', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const h = harness();
    start(h, { autopilot: true, laps: 1, debug: true });
    // État du joueur AVANT les pas de chaque frame : les sons d'une frame où il était déjà arrivé sont filtrés.
    let finishedBeforeFrame = false;
    h.audio.playerFinished = () => finishedBeforeFrame;
    const frame = (): void => {
      finishedBeforeFrame = playerFinished(h);
      h.frames.frame(FAST_FRAME_MS);
    };

    let frames = 0;
    while (h.rec.results.length === 0 && frames++ < 4000) frame();
    expect(h.rec.results).toHaveLength(1);
    expect(h.rec.phases).toEqual(['countdown', 'racing', 'finished']);
    // L'arrivée est publiée tout de suite : phase puis résultats.
    expect(h.rec.log.filter((entry) => entry.startsWith('phase') || entry === 'results')).toEqual([
      'phase:countdown',
      'phase:racing',
      'phase:finished',
      'results',
    ]);

    const results = h.rec.results[0];
    expect(results).toHaveLength(8);
    expect(results.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const playerResult = results.find((entry) => entry.isPlayer);
    expect(playerResult?.estimated).toBe(false);

    // La course continue derrière l'écran des résultats, sans nouveaux résultats.
    for (let i = 0; i < 200; i++) frame();
    expect(h.rec.results).toHaveLength(1);
    expect(h.rec.phases).toEqual(['countdown', 'racing', 'finished']);
    expect(h.rec.huds.at(-1)?.phase).toBe('finished');

    // Après l'arrivée du joueur, l'audio ne reçoit plus que des arrivées ; le rendu, lui, reçoit tout.
    const afterFinish = h.audio.batches
      .filter((batch) => batch.playerFinishedBefore)
      .flatMap((batch) => batch.events);
    expect(afterFinish.every((event) => event.type === 'finish')).toBe(true);
    const renderedAfter = h.renderer.received.filter(
      (entry) => entry.playerFinished && entry.event.type !== 'finish',
    );
    expect(renderedAfter.length).toBeGreaterThan(0);
    expect(h.audio.players.at(-1)?.active).toBe(false);

    // Journal de débogage lu par le banc de vérification.
    const messages = info.mock.calls.map((call) => String(call[0]));
    expect(messages.every((message) => message.startsWith('[WoufKart] '))).toBe(true);
    expect(messages.some((message) => message.includes('Départ'))).toBe(true);
    expect(
      messages.some((message) => message.includes('Arrivée') && message.includes('(joueur)')),
    ).toBe(true);
    expect(messages.some((message) => message.startsWith('[WoufKart] Résultats'))).toBe(true);
    expect(messages.some((message) => /rang \d\/8 · tour 1\/1/.test(message))).toBe(true);
  }, 60_000);

  it('sans debug, rien n’est journalisé', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const h = harness();
    start(h, { autopilot: true });
    h.frames.frames(100, FAST_FRAME_MS);
    expect(info).not.toHaveBeenCalled();
  });

  it('une erreur dans la boucle est transmise à onError et arrête la boucle', () => {
    const h = harness();
    start(h);
    h.frames.frames(2);
    const failure = new Error('rendu cassé');
    h.renderer.failWith = failure;
    h.frames.frame();
    expect(h.rec.errors).toEqual([failure]);
    expect(h.frames.pending).toBe(0);
  });
});

describe('createGameWithDeps — pause, reprise, libération', () => {
  it('pause et reprise idempotentes, avec onPauseChange et boucle arrêtée', () => {
    const h = harness();
    const game = start(h);
    h.frames.frames(5);
    const resets = h.keyboard.resetCalls;

    game.pause();
    expect(game.paused).toBe(true);
    expect(h.rec.pauses).toEqual([true]);
    expect(h.frames.pending).toBe(0);
    expect(h.keyboard.resetCalls).toBe(resets + 1);
    expect(h.audio.players.at(-1)?.active).toBe(false);

    game.pause();
    expect(h.rec.pauses).toEqual([true]);

    const renders = h.renderer.renderCount;
    h.frames.frames(10);
    expect(h.renderer.renderCount).toBe(renders);

    game.resume();
    expect(game.paused).toBe(false);
    expect(h.rec.pauses).toEqual([true, false]);
    expect(h.frames.pending).toBe(1);
    game.resume();
    expect(h.rec.pauses).toEqual([true, false]);
    h.frames.frame();
    expect(h.renderer.renderCount).toBe(renders + 1);
  });

  it('la touche pause met en pause mais ne reprend pas', () => {
    const h = harness();
    const game = start(h);
    h.keyboard.onPauseRequest();
    expect(game.paused).toBe(true);
    h.keyboard.onPauseRequest();
    expect(game.paused).toBe(true);
    expect(h.rec.pauses).toEqual([true]);
  });

  it('met en pause quand la page est masquée', () => {
    const h = harness();
    const game = start(h);
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      expect(game.paused).toBe(false);
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      Reflect.deleteProperty(document, 'hidden');
    }
    expect(game.paused).toBe(true);
    expect(h.rec.pauses).toEqual([true]);
  });

  it('réautorise le son à chaque geste tant qu’il ne joue pas, relâchement du doigt compris', () => {
    const h = harness();
    const game = start(h);
    expect(h.audio.resumeCalls).toBe(1);
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('pointerup'));
    document.dispatchEvent(new Event('touchend'));
    expect(h.audio.resumeCalls).toBe(4);
    // Le son joue : plus besoin de le réautoriser.
    h.audio.running = true;
    document.dispatchEvent(new Event('click'));
    document.dispatchEvent(new Event('keydown'));
    expect(h.audio.resumeCalls).toBe(4);
    // Coupé par le navigateur (autre application) : le prochain geste le relance.
    h.audio.running = false;
    document.dispatchEvent(new Event('click'));
    expect(h.audio.resumeCalls).toBe(5);
    expect(game.paused).toBe(false);
  });

  it('setMuted est relayé à l’audio', () => {
    const h = harness();
    const game = start(h);
    game.setMuted(true);
    game.setMuted(false);
    expect(h.audio.mutedCalls).toEqual([false, true, false]);
  });

  it('suit la taille du canvas avec un ResizeObserver, déconnecté à la libération', () => {
    const observers: FakeResizeObserver[] = [];
    class FakeResizeObserver {
      readonly observed: Element[] = [];
      disconnected = false;
      constructor(readonly callback: () => void) {
        observers.push(this);
      }
      observe(target: Element): void {
        this.observed.push(target);
      }
      unobserve(): void {}
      disconnect(): void {
        this.disconnected = true;
      }
    }
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const h = harness();
    const game = start(h);
    expect(observers).toHaveLength(1);
    expect(observers[0].observed).toEqual([h.canvas]);

    Object.defineProperty(h.canvas, 'clientWidth', { configurable: true, value: 1024 });
    Object.defineProperty(h.canvas, 'clientHeight', { configurable: true, value: 600 });
    observers[0].callback();
    expect(h.renderer.resizes.at(-1)).toEqual([1024, 600]);

    game.dispose();
    expect(observers[0].disconnected).toBe(true);
  });

  it('dispose libère tout une seule fois ; le handle devient inerte', () => {
    const h = harness();
    const game = start(h);
    h.frames.frames(3);
    game.dispose();
    expect(h.frames.pending).toBe(0);
    expect(h.keyboard.detachCalls).toBe(1);
    expect(h.renderer.disposeCalls).toBe(1);
    expect(h.audio.disposeCalls).toBe(1);

    game.dispose();
    expect(h.keyboard.detachCalls).toBe(1);
    expect(h.renderer.disposeCalls).toBe(1);
    expect(h.audio.disposeCalls).toBe(1);

    game.pause();
    game.resume();
    expect(h.rec.pauses).toEqual([]);
    expect(h.frames.pending).toBe(0);
    const resumes = h.audio.resumeCalls;
    document.dispatchEvent(new Event('keydown'));
    expect(h.audio.resumeCalls).toBe(resumes);
  });

  it('après l’arrivée, la touche pause est ignorée (écran des résultats)', () => {
    const h = harness();
    const game = start(h, { autopilot: true, laps: 1 });
    runUntilResults(h);
    expect(h.rec.results).toHaveLength(1);
    h.keyboard.onPauseRequest();
    expect(game.paused).toBe(false);
    // L'interface peut toujours demander la pause explicitement.
    game.pause();
    expect(game.paused).toBe(true);
  }, 60_000);
});

describe('createGameWithDeps — échec du rendu', () => {
  it('signale l’erreur, libère ce qui a été créé et renvoie un handle inerte', () => {
    const h = harness();
    const failure = new Error('WebGL indisponible');
    h.deps.createRenderer = () => {
      throw failure;
    };
    const game = start(h);

    expect(h.rec.errors).toEqual([failure]);
    expect(h.rec.log).toEqual(['error']);
    expect(h.frames.pending).toBe(0);
    // Rien d'autre n'a été créé (ou tout a été libéré).
    for (const keyboard of h.keyboards) expect(keyboard.detachCalls).toBe(keyboard.attachCalls);

    expect(game.paused).toBe(false);
    game.pause();
    game.resume();
    game.setMuted(true);
    game.dispose();
    game.dispose();
    expect(h.rec.pauses).toEqual([]);
    expect(h.audio.mutedCalls).toEqual([]);
  });

  it('libère le rendu déjà créé si la suite de l’assemblage échoue', () => {
    const h = harness();
    const failure = new Error('clavier indisponible');
    h.deps.createKeyboard = () => {
      throw failure;
    };
    start(h);
    expect(h.rec.errors).toEqual([failure]);
    expect(h.renderer.disposeCalls).toBe(1);
    expect(h.audio.disposeCalls).toBe(1);
    expect(h.frames.pending).toBe(0);
  });
});
