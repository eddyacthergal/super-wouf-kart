/**
 * Faux moteur de jeu pour les tests Angular : capture les rappels et compte les appels au handle.
 * Aucune dépendance à three.js ni à vitest.
 */
import type {
  CreateGame,
  GameCallbacks,
  GameHandle,
  HudSnapshot,
  RaceInfo,
  RaceResultEntry,
  RaceSetup,
} from '../../game/game-api';

export class FakeGameHandle implements GameHandle {
  paused = false;
  pauseCalls = 0;
  resumeCalls = 0;
  disposeCalls = 0;
  mutedCalls: boolean[] = [];

  constructor(private readonly callbacks: GameCallbacks) {}

  pause(): void {
    this.pauseCalls++;
    if (this.paused) return;
    this.paused = true;
    this.callbacks.onPauseChange(true);
  }

  resume(): void {
    this.resumeCalls++;
    if (!this.paused) return;
    this.paused = false;
    this.callbacks.onPauseChange(false);
  }

  setMuted(muted: boolean): void {
    this.mutedCalls.push(muted);
  }

  dispose(): void {
    this.disposeCalls++;
  }
}

export interface FakeGameRun {
  canvas: HTMLCanvasElement;
  setup: RaceSetup;
  callbacks: GameCallbacks;
  handle: FakeGameHandle;
}

/** Faux chargeur : `loader` se fournit via le jeton GAME_LOADER. */
export class FakeGame {
  readonly runs: FakeGameRun[] = [];
  /** Erreur levée par le chargement (import dynamique qui échoue). */
  loadError: unknown = null;
  /** Erreur levée par createGame (WebGL indisponible…). */
  createError: unknown = null;
  /** Rappels appelés par le jeu pendant sa création (avant que createGame ne rende la main). */
  duringCreate: ((callbacks: GameCallbacks) => void) | null = null;

  readonly createGame: CreateGame = (canvas, setup, callbacks) => {
    if (this.createError !== null) throw this.createError;
    const handle = new FakeGameHandle(callbacks);
    this.runs.push({ canvas, setup, callbacks, handle });
    this.duringCreate?.(callbacks);
    return handle;
  };

  readonly loader = (): Promise<CreateGame> =>
    this.loadError !== null ? Promise.reject(this.loadError) : Promise.resolve(this.createGame);

  get last(): FakeGameRun {
    const run = this.runs.at(-1);
    if (!run) throw new Error('Aucune partie créée.');
    return run;
  }
}

export const FAKE_INFO: RaceInfo = {
  laps: 3,
  racers: [
    { id: 0, name: 'Toi', breed: 'chihuahua', kartColor: '#d7322e', isPlayer: true },
    { id: 1, name: 'Biscotte', breed: 'carlin', kartColor: '#2e6fd7', isPlayer: false },
    { id: 2, name: 'Saucisse', breed: 'teckel', kartColor: '#f0b429', isPlayer: false },
  ],
  trackOutline: [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 60 },
    { x: 0, z: 60 },
  ],
};

export function fakeHud(overrides: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    phase: 'racing',
    countdown: null,
    lap: 1,
    laps: 3,
    rank: 3,
    racerCount: 8,
    raceTime: 65.32,
    item: null,
    itemRolling: false,
    driftTier: 0,
    boosting: false,
    wrongWay: false,
    speedKmh: 87.4,
    dots: [
      { id: 0, x: 10, z: 0 },
      { id: 1, x: 50, z: 0 },
      { id: 2, x: 100, z: 30 },
    ],
    ...overrides,
  };
}

export const FAKE_RESULTS: RaceResultEntry[] = [
  { rank: 1, racerId: 1, name: 'Biscotte', breed: 'carlin', isPlayer: false, time: 120.5, estimated: false },
  { rank: 2, racerId: 0, name: 'Toi', breed: 'chihuahua', isPlayer: true, time: 125.25, estimated: false },
  { rank: 3, racerId: 2, name: 'Saucisse', breed: 'teckel', isPlayer: false, time: 131.07, estimated: true },
];
