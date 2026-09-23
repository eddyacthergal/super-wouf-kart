/**
 * Boucle de jeu à pas fixe : la simulation avance par pas constants (FIXED_DT),
 * le rendu tourne à la fréquence de l'écran et interpole avec `alpha`.
 * Aucune dépendance au DOM à l'import : requestAnimationFrame et performance.now()
 * ne sont lus qu'à l'usage, et seulement si rien d'autre n'est fourni (tests en Node).
 */
import { FIXED_DT } from '../core/constants';

/** Plafond par défaut du nombre de pas simulés par frame (onglet masqué, grosse latence). */
const DEFAULT_MAX_STEPS_PER_FRAME = 5;
/** Durée maximale prise en compte pour une frame (s) : au-delà, le temps est perdu. */
const MAX_FRAME_SECONDS = 0.25;

export interface FixedStepLoopOptions {
  /** Avance la simulation d'un pas de `dt` secondes. */
  step(dt: number): void;
  /**
   * Dessine une frame. `alpha` ∈ [0, 1[ : fraction du pas suivant déjà écoulée (interpolation) ;
   * `frameDt` : durée réelle de la frame (s), plafonnée.
   */
  render(alpha: number, frameDt: number): void;
  /** Pas de simulation (s), FIXED_DT par défaut. */
  dt?: number;
  /** Nombre maximal de pas par frame, 5 par défaut ; l'excédent de temps est jeté. */
  maxStepsPerFrame?: number;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
  /** Horloge en millisecondes, performance.now() par défaut. */
  now?: () => number;
  /** Appelé si step ou render lève une exception ; la boucle est alors arrêtée. */
  onError?: (error: unknown) => void;
}

export class FixedStepLoop {
  private readonly options: FixedStepLoopOptions;
  private readonly dt: number;
  private readonly maxStepsPerFrame: number;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly now: () => number;

  private isRunning = false;
  /** Incrémenté à chaque start() : une frame sait si la boucle a été relancée pendant qu'elle tournait. */
  private runId = 0;
  private frameHandle: number | null = null;
  private lastTime = 0;
  private accumulator = 0;

  constructor(options: FixedStepLoopOptions) {
    this.options = options;
    this.dt = options.dt ?? FIXED_DT;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? DEFAULT_MAX_STEPS_PER_FRAME;
    if (!(this.dt > 0 && Number.isFinite(this.dt))) {
      throw new RangeError(`FixedStepLoop : dt doit être fini et > 0 (reçu ${this.dt})`);
    }
    if (!(this.maxStepsPerFrame >= 1)) {
      throw new RangeError(
        `FixedStepLoop : maxStepsPerFrame doit être ≥ 1 (reçu ${this.maxStepsPerFrame})`,
      );
    }
    this.requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
    this.cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
    this.now = options.now ?? (() => performance.now());
  }

  get running(): boolean {
    return this.isRunning;
  }

  /** Démarre la boucle (sans effet si elle tourne déjà) ; le temps passé à l'arrêt est ignoré. */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.runId++;
    this.accumulator = 0;
    this.lastTime = this.now();
    this.scheduleFrame();
  }

  /** Arrête la boucle et annule la frame programmée (sans effet si elle est déjà arrêtée). */
  stop(): void {
    this.isRunning = false;
    if (this.frameHandle !== null) {
      this.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
  }

  private scheduleFrame(): void {
    if (this.frameHandle === null) this.frameHandle = this.requestFrame(this.onFrame);
  }

  private readonly onFrame = (): void => {
    this.frameHandle = null;
    if (!this.isRunning) return;

    const time = this.now();
    const elapsed = (time - this.lastTime) / 1000;
    // Temps qui recule ou horloge invalide (NaN) : frame de durée nulle, sans empoisonner l'accumulateur.
    const frameDt = elapsed > 0 ? Math.min(elapsed, MAX_FRAME_SECONDS) : 0;
    if (Number.isFinite(time)) this.lastTime = time;
    this.accumulator += frameDt;

    const runId = this.runId;
    try {
      let steps = 0;
      while (this.accumulator >= this.dt && steps < this.maxStepsPerFrame) {
        // Décompté avant step() : un redémarrage pendant le pas repart d'un accumulateur propre.
        this.accumulator -= this.dt;
        steps++;
        this.options.step(this.dt);
        // step() peut arrêter (fin de partie, dispose) ou relancer la boucle (pause puis reprise) :
        // cette frame n'a plus lieu d'être, la nouvelle est déjà programmée si besoin.
        if (!this.isRunning || this.runId !== runId) return;
      }
      // Plafond atteint : le retard est jeté, seule la fraction de pas reste (pas de spirale de la mort).
      if (this.accumulator >= this.dt) this.accumulator %= this.dt;
      this.options.render(this.accumulator / this.dt, frameDt);
    } catch (error) {
      this.stop();
      this.reportError(error);
      return;
    }

    if (this.isRunning) this.scheduleFrame();
  };

  private reportError(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else console.error('[WoufKart] Boucle de jeu arrêtée après une erreur', error);
  }
}
