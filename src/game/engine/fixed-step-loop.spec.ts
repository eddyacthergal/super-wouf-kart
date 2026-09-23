import { describe, expect, it, vi } from 'vitest';
import { FIXED_DT } from '../core/constants';
import { createRng } from '../core/rng';
import { FixedStepLoop, type FixedStepLoopOptions } from './fixed-step-loop';

/** Pas exactement représentable en binaire (15,625 ms) : pas d'erreur d'arrondi dans les comptes. */
const DT = 1 / 64;
const DT_MS = 1000 * DT;

/** Horloge et requestAnimationFrame factices, pilotés à la main. */
function createFakeScheduler() {
  let time = 1000;
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    now: (): number => time,
    requestFrame: (callback: FrameRequestCallback): number => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number): void => {
      callbacks.delete(handle);
    },
    /** Avance l'horloge sans exécuter de frame (onglet masqué, boucle à l'arrêt). */
    advance(ms: number): void {
      time += ms;
    },
    /** Avance l'horloge puis exécute les frames programmées. */
    frame(ms: number): void {
      time += ms;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(time);
    },
    get pendingFrames(): number {
      return callbacks.size;
    },
  };
}

function setup(overrides: Partial<FixedStepLoopOptions> = {}) {
  const scheduler = createFakeScheduler();
  const steps: number[] = [];
  const renders: { alpha: number; frameDt: number }[] = [];
  const loop = new FixedStepLoop({
    step: (dt) => steps.push(dt),
    render: (alpha, frameDt) => renders.push({ alpha, frameDt }),
    dt: DT,
    requestFrame: scheduler.requestFrame,
    cancelFrame: scheduler.cancelFrame,
    now: scheduler.now,
    ...overrides,
  });
  return { loop, scheduler, steps, renders };
}

describe('FixedStepLoop', () => {
  it('ne fait rien avant start() et programme une seule frame au démarrage', () => {
    const { loop, scheduler, steps } = setup();
    expect(loop.running).toBe(false);
    expect(scheduler.pendingFrames).toBe(0);
    loop.start();
    expect(loop.running).toBe(true);
    expect(scheduler.pendingFrames).toBe(1);
    expect(steps).toHaveLength(0);
  });

  it('simule autant de pas que le temps écoulé en contient et interpole le reste', () => {
    const { loop, scheduler, steps, renders } = setup();
    loop.start();

    scheduler.frame(DT_MS);
    expect(steps).toEqual([DT]);
    expect(renders[0]).toEqual({ alpha: 0, frameDt: DT });

    scheduler.frame(2.5 * DT_MS);
    expect(steps).toHaveLength(3);
    expect(renders[1].alpha).toBeCloseTo(0.5, 9);

    // 0,5 pas en réserve + 0,75 pas : un seul pas, reste 0,25.
    scheduler.frame(0.75 * DT_MS);
    expect(steps).toHaveLength(4);
    expect(renders[2].alpha).toBeCloseTo(0.25, 9);
    expect(renders[2].frameDt).toBeCloseTo(0.75 * DT, 9);

    // Frame plus courte qu'un pas : aucun pas, mais un rendu.
    scheduler.frame(0.5 * DT_MS);
    expect(steps).toHaveLength(4);
    expect(renders).toHaveLength(4);
    expect(renders[3].alpha).toBeCloseTo(0.75, 9);
    expect(scheduler.pendingFrames).toBe(1);
  });

  it('utilise FIXED_DT et un plafond de 5 pas par défaut', () => {
    const { loop, scheduler, steps } = setup({ dt: undefined });
    loop.start();
    scheduler.frame(40); // 2,4 pas
    expect(steps).toEqual([FIXED_DT, FIXED_DT]);
    scheduler.frame(200); // 12 pas en théorie
    expect(steps).toHaveLength(2 + 5);
  });

  it('garde alpha dans [0, 1[ et le bon nombre de pas sur des frames irrégulières', () => {
    const { loop, scheduler, steps, renders } = setup({ maxStepsPerFrame: 100 });
    const rng = createRng(7);
    loop.start();
    let elapsedMs = 0;
    for (let i = 0; i < 500; i++) {
      const ms = rng.range(0, 70);
      elapsedMs += ms;
      scheduler.frame(ms);
    }
    for (const { alpha } of renders) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
    const expectedSteps = elapsedMs / DT_MS;
    expect(Math.abs(steps.length - expectedSteps)).toBeLessThan(1);
  });

  it('respecte maxStepsPerFrame et jette le retard au lieu de le rattraper', () => {
    const { loop, scheduler, steps, renders } = setup({ maxStepsPerFrame: 3 });
    loop.start();
    scheduler.frame(6.4 * DT_MS);
    expect(steps).toHaveLength(3);
    expect(renders[0].alpha).toBeGreaterThanOrEqual(0);
    expect(renders[0].alpha).toBeLessThan(1);

    // Frame suivante normale : un seul pas, pas de rattrapage des 3,4 pas perdus.
    scheduler.frame(DT_MS);
    expect(steps).toHaveLength(4);
  });

  it('plafonne une très longue frame à 0,25 s', () => {
    const { loop, scheduler, steps, renders } = setup({ maxStepsPerFrame: 1000 });
    loop.start();
    scheduler.frame(10_000);
    expect(steps).toHaveLength(0.25 / DT);
    expect(renders[0].frameDt).toBe(0.25);
  });

  it('ignore un temps qui recule', () => {
    const { loop, scheduler, steps, renders } = setup();
    loop.start();
    scheduler.frame(-50);
    expect(steps).toHaveLength(0);
    expect(renders[0]).toEqual({ alpha: 0, frameDt: 0 });
  });

  it('start() est idempotent', () => {
    const { loop, scheduler, steps } = setup();
    loop.start();
    loop.start();
    expect(scheduler.pendingFrames).toBe(1);
    scheduler.frame(DT_MS);
    loop.start();
    expect(scheduler.pendingFrames).toBe(1);
    expect(steps).toHaveLength(1);
  });

  it('stop() annule la frame programmée et est idempotent', () => {
    const { loop, scheduler, steps, renders } = setup();
    loop.start();
    scheduler.frame(DT_MS);
    expect(scheduler.pendingFrames).toBe(1);
    loop.stop();
    loop.stop();
    expect(loop.running).toBe(false);
    expect(scheduler.pendingFrames).toBe(0);
    scheduler.frame(10 * DT_MS);
    expect(steps).toHaveLength(1);
    expect(renders).toHaveLength(1);
  });

  it('une frame annulée trop tard ne fait rien après stop()', () => {
    const scheduler = createFakeScheduler();
    const step = vi.fn();
    const loop = new FixedStepLoop({
      step,
      render: () => undefined,
      dt: DT,
      requestFrame: scheduler.requestFrame,
      cancelFrame: () => undefined, // n'annule rien
      now: scheduler.now,
    });
    loop.start();
    loop.stop();
    scheduler.frame(10 * DT_MS);
    expect(step).not.toHaveBeenCalled();
    expect(scheduler.pendingFrames).toBe(0);
  });

  it('ne rattrape pas le temps passé à l’arrêt lors d’un redémarrage', () => {
    const { loop, scheduler, steps, renders } = setup();
    loop.start();
    scheduler.frame(1.5 * DT_MS);
    expect(steps).toHaveLength(1);
    loop.stop();

    scheduler.advance(5000);
    loop.start();
    expect(loop.running).toBe(true);
    scheduler.frame(DT_MS);
    // Un seul pas et aucune réserve conservée d'avant l'arrêt.
    expect(steps).toHaveLength(2);
    expect(renders.at(-1)?.alpha).toBe(0);
  });

  it('s’arrête au milieu d’une frame si step() appelle stop()', () => {
    const scheduler = createFakeScheduler();
    const render = vi.fn();
    let count = 0;
    const loop: FixedStepLoop = new FixedStepLoop({
      step: () => {
        count++;
        if (count === 2) loop.stop();
      },
      render,
      dt: DT,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      now: scheduler.now,
    });
    loop.start();
    scheduler.frame(4 * DT_MS);
    expect(count).toBe(2);
    expect(render).not.toHaveBeenCalled();
    expect(scheduler.pendingFrames).toBe(0);
  });

  it('repart proprement si step() arrête puis relance la boucle (pause et reprise)', () => {
    const scheduler = createFakeScheduler();
    const alphas: number[] = [];
    let count = 0;
    const loop: FixedStepLoop = new FixedStepLoop({
      step: () => {
        count++;
        if (count === 1) {
          loop.stop();
          loop.start();
        }
      },
      render: (alpha) => alphas.push(alpha),
      dt: DT,
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      now: scheduler.now,
    });
    loop.start();
    scheduler.frame(3 * DT_MS);
    // La frame interrompue ne simule ni ne dessine plus rien ; une seule frame reste programmée.
    expect(count).toBe(1);
    expect(alphas).toEqual([]);
    expect(loop.running).toBe(true);
    expect(scheduler.pendingFrames).toBe(1);

    // La nouvelle course du temps part de zéro : alpha jamais négatif.
    scheduler.frame(1.5 * DT_MS);
    expect(count).toBe(2);
    expect(alphas).toHaveLength(1);
    expect(alphas[0]).toBeCloseTo(0.5, 9);
  });

  it('survit à une horloge qui renvoie NaN une fois', () => {
    let glitch = false;
    const scheduler = createFakeScheduler();
    const { loop, steps, renders } = setup({
      requestFrame: scheduler.requestFrame,
      cancelFrame: scheduler.cancelFrame,
      now: () => (glitch ? Number.NaN : scheduler.now()),
    });
    loop.start();
    scheduler.frame(DT_MS);
    glitch = true;
    scheduler.frame(DT_MS);
    glitch = false;
    expect(renders[1]).toEqual({ alpha: 0, frameDt: 0 });
    scheduler.frame(DT_MS);
    scheduler.frame(DT_MS);
    // L'accumulateur n'est pas empoisonné : la simulation continue.
    expect(steps.length).toBeGreaterThanOrEqual(3);
    for (const { alpha } of renders) expect(Number.isFinite(alpha)).toBe(true);
  });

  it.each(['step', 'render'] as const)(
    'une exception dans %s arrête la boucle et appelle onError',
    (failing) => {
      const failure = new Error('boum');
      const onError = vi.fn();
      const throwing = (): void => {
        throw failure;
      };
      const { loop, scheduler, steps } = setup(
        failing === 'step' ? { step: throwing, onError } : { render: throwing, onError },
      );
      loop.start();
      expect(() => scheduler.frame(2 * DT_MS)).not.toThrow();
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
      expect(loop.running).toBe(false);
      expect(scheduler.pendingFrames).toBe(0);
      scheduler.frame(2 * DT_MS);
      expect(onError).toHaveBeenCalledTimes(1);
      if (failing === 'render') expect(steps).toHaveLength(2);
    },
  );

  it('journalise l’erreur sans la relancer quand onError est absent', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { loop, scheduler } = setup({
        step: () => {
          throw new Error('boum');
        },
      });
      loop.start();
      expect(() => scheduler.frame(DT_MS)).not.toThrow();
      expect(loop.running).toBe(false);
      expect(consoleError).toHaveBeenCalledOnce();
    } finally {
      consoleError.mockRestore();
    }
  });

  it('refuse un pas ou un plafond invalide', () => {
    expect(() => setup({ dt: 0 })).toThrow(RangeError);
    expect(() => setup({ dt: -DT })).toThrow(RangeError);
    expect(() => setup({ dt: Number.NaN })).toThrow(RangeError);
    expect(() => setup({ dt: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => setup({ maxStepsPerFrame: 0 })).toThrow(RangeError);
    expect(() => setup({ maxStepsPerFrame: Number.NaN })).toThrow(RangeError);
  });
});
