import { DestroyRef, InjectionToken, Service, inject, signal } from '@angular/core';
import type { RacePhase } from '../../game/core/types';
import type {
  CreateGame,
  GameCallbacks,
  GameHandle,
  HudSnapshot,
  RaceInfo,
  RaceResultEntry,
  RaceSetup,
  TouchAction,
} from '../../game/game-api';

/**
 * Chargeur du moteur de jeu. L'import dynamique garde three.js hors du bundle initial ;
 * les tests fournissent un faux chargeur.
 */
export const GAME_LOADER = new InjectionToken<() => Promise<CreateGame>>('GAME_LOADER', {
  factory: () => () => import('../../game/game').then((m) => m.createGame),
});

/** Message d'erreur lisible (en français) à partir d'une erreur quelconque du jeu. */
export function describeGameError(error: unknown, stage: 'load' | 'run'): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/webgl/i.test(text)) {
    return 'Ton navigateur ne peut pas afficher la 3D (WebGL indisponible). Essaie un navigateur récent ou active l’accélération matérielle.';
  }
  if (stage === 'load') {
    return 'Impossible de charger le jeu. Vérifie ta connexion internet, puis réessaie.';
  }
  return 'Oups ! Une erreur inattendue a interrompu la course.';
}

/** Pilote une partie : chargement du moteur, état publié en signals, pause, son et arrêt. */
@Service()
export class GameSessionService {
  private readonly loadGame = inject(GAME_LOADER);

  private readonly infoState = signal<RaceInfo | null>(null);
  private readonly hudState = signal<HudSnapshot | null>(null);
  private readonly phaseState = signal<RacePhase | null>(null);
  private readonly resultsState = signal<RaceResultEntry[] | null>(null);
  private readonly pausedState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loadingState = signal(false);

  readonly info = this.infoState.asReadonly();
  readonly hud = this.hudState.asReadonly();
  readonly phase = this.phaseState.asReadonly();
  readonly results = this.resultsState.asReadonly();
  readonly paused = this.pausedState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loading = this.loadingState.asReadonly();

  private handle: GameHandle | null = null;
  /** Incrémenté à chaque arrêt : les rappels et chargements d'une partie terminée sont ignorés. */
  private generation = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Lance une nouvelle partie dans `canvas` (la partie en cours est d'abord arrêtée). */
  async start(canvas: HTMLCanvasElement, setup: RaceSetup): Promise<void> {
    this.stop();
    const generation = this.generation;
    this.loadingState.set(true);

    let createGame: CreateGame;
    try {
      createGame = await this.loadGame();
    } catch (error) {
      if (generation === this.generation) this.fail(error, 'load');
      return;
    }
    if (generation !== this.generation) return;

    try {
      const handle = createGame(canvas, setup, this.callbacksFor(generation));
      if (generation !== this.generation) {
        // Arrêt (ou erreur signalée) pendant la création : on libère aussitôt la partie orpheline.
        handle.dispose();
        return;
      }
      this.handle = handle;
      this.pausedState.set(handle.paused);
      // `loading` repasse à faux avec onReady (éventuellement déjà reçu pendant la création).
    } catch (error) {
      if (generation === this.generation) this.fail(error, 'run');
    }
  }

  /** Recommence une course avec les mêmes réglages (ou d'autres). */
  restart(canvas: HTMLCanvasElement, setup: RaceSetup): Promise<void> {
    return this.start(canvas, setup);
  }

  pause(): void {
    this.handle?.pause();
  }

  resume(): void {
    this.handle?.resume();
  }

  setMuted(muted: boolean): void {
    this.handle?.setMuted(muted);
  }

  /** Relaie l'appui ou le relâchement d'un bouton tactile à la partie en cours. */
  setTouchControl(action: TouchAction, pressed: boolean): void {
    this.handle?.setTouchControl(action, pressed);
  }

  /** Arrête la partie, libère ses ressources et réinitialise l'état publié. */
  stop(): void {
    this.generation++;
    const handle = this.handle;
    this.handle = null;
    try {
      handle?.dispose();
    } catch (error) {
      console.error('[WoufKart] Échec de la libération de la partie', error);
    }
    this.infoState.set(null);
    this.hudState.set(null);
    this.phaseState.set(null);
    this.resultsState.set(null);
    this.pausedState.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  private fail(error: unknown, stage: 'load' | 'run'): void {
    console.error('[WoufKart]', error);
    this.stop();
    this.errorState.set(describeGameError(error, stage));
  }

  private callbacksFor(generation: number): GameCallbacks {
    const live = (): boolean => generation === this.generation;
    return {
      onReady: (info) => {
        if (!live()) return;
        this.infoState.set(info);
        this.loadingState.set(false);
      },
      onHud: (snapshot) => {
        if (live()) this.hudState.set(snapshot);
      },
      onPhase: (phase) => {
        if (live()) this.phaseState.set(phase);
      },
      onResults: (results) => {
        if (live()) this.resultsState.set(results);
      },
      onPauseChange: (paused) => {
        if (live()) this.pausedState.set(paused);
      },
      onError: (error) => {
        if (live()) this.fail(error, 'run');
      },
    };
  }
}
