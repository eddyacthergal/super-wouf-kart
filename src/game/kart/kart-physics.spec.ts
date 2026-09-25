import { describe, expect, it } from 'vitest';
import { DRIFT, FIXED_DT, KART_RADIUS, PHYSICS, ROAD_HALF_WIDTH } from '../core/constants';
import { applyBoost, applySpinOut, createKartState } from '../core/kart-state';
import { NEUTRAL_INPUT, type DriverInput, type KartEvent, type KartState, type KartTuning, type TrackQuery } from '../core/types';
import { addScaled, clamp, dot, headingOf, leftOf, scale, sub, wrapAngle } from '../core/vec2';
import { createCircleTrack } from '../testing/fake-track';
import { TEST_TUNING } from '../testing/fixtures';
import { stepKart } from './kart-physics';
import { tuningFromStats } from './tuning';

/** Quasi-ligne droite (cercle de 2 km tournant à gauche). */
const STRAIGHT = createCircleTrack(2000);
/** Même tracé sans haies, pour dériver en rond librement. */
const OPEN: TrackQuery = { ...createCircleTrack(2000), wallHalfWidth: Number.POSITIVE_INFINITY };
const WALL_LIMIT = STRAIGHT.wallHalfWidth - KART_RADIUS;

type Controls = Partial<DriverInput> | ((kart: KartState) => Partial<DriverInput>);

/** Kart posé sur le circuit à l'abscisse s, orienté selon la tangente (+ décalage de cap). */
function kartOn(track: TrackQuery, s: number, lateral = 0, speed = 0, headingOffset = 0): KartState {
  const sample = track.sampleAt(s);
  const kart = createKartState(addScaled(sample.position, sample.left, lateral), headingOf(sample.tangent) + headingOffset);
  const projection = track.project(kart.position);
  kart.trackIndex = projection.index;
  kart.lateral = projection.lateral;
  kart.speed = speed;
  return kart;
}

/** Un pas de simulation ; renvoie les événements émis. */
function step(kart: KartState, controls: Partial<DriverInput>, track = STRAIGHT, tuning: KartTuning = TEST_TUNING): KartEvent[] {
  const events: KartEvent[] = [];
  stepKart(kart, { ...NEUTRAL_INPUT, ...controls }, tuning, track, FIXED_DT, (event) => events.push(event));
  return events;
}

/** Simule `seconds` secondes ; `observe` est appelé après chaque pas (t = temps écoulé). */
function run(
  kart: KartState,
  seconds: number,
  controls: Controls,
  options: { track?: TrackQuery; tuning?: KartTuning; observe?: (t: number, events: KartEvent[]) => void } = {},
): KartEvent[] {
  const all: KartEvent[] = [];
  const steps = Math.round(seconds / FIXED_DT);
  for (let i = 1; i <= steps; i++) {
    const input = typeof controls === 'function' ? controls(kart) : controls;
    const events = step(kart, input, options.track, options.tuning);
    all.push(...events);
    options.observe?.(i * FIXED_DT, events);
  }
  return all;
}

const ofType = <T extends KartEvent['type']>(events: KartEvent[], type: T): Extract<KartEvent, { type: T }>[] =>
  events.filter((event): event is Extract<KartEvent, { type: T }> => event.type === type);

/** Pilote simple : vise un point en avant sur la ligne (décalée de `targetLateral`). */
function followLine(kart: KartState, track: TrackQuery, targetLateral = 0): number {
  const projection = track.project(kart.position, kart.trackIndex);
  const ahead = track.sampleAt(projection.s + 6 + Math.abs(kart.speed) * 0.3);
  const aim = addScaled(ahead.position, ahead.left, targetLateral);
  const error = wrapAngle(headingOf(sub(aim, kart.position)) - kart.heading);
  // Erreur positive = cible à gauche = cap à augmenter = braquer à gauche (steer < 0).
  return clamp(-2.5 * error, -1, 1);
}

describe('stepKart — vitesse', () => {
  it('atteint 90 % de la vitesse max en moins de 4 s sans jamais la dépasser', () => {
    const kart = kartOn(STRAIGHT, 0);
    let reachedAt = Number.POSITIVE_INFINITY;
    let top = 0;
    run(kart, 10, (k) => ({ throttle: true, steer: followLine(k, STRAIGHT) }), {
      observe: (t) => {
        top = Math.max(top, kart.speed);
        if (kart.speed >= 0.9 * TEST_TUNING.maxSpeed) reachedAt = Math.min(reachedAt, t);
      },
    });
    expect(reachedAt).toBeLessThanOrEqual(4);
    expect(top).toBeLessThanOrEqual(TEST_TUNING.maxSpeed + 1e-9);
    expect(kart.speed).toBeCloseTo(TEST_TUNING.maxSpeed, 3);
  });

  it('même la race la plus lente à accélérer atteint 90 % en moins de 4 s', () => {
    const tuning = tuningFromStats({ speed: 5, acceleration: 1, weight: 3, handling: 3 });
    const kart = kartOn(STRAIGHT, 0);
    run(kart, 4, { throttle: true }, { tuning });
    expect(kart.speed).toBeGreaterThanOrEqual(0.9 * tuning.maxSpeed);
  });

  it('freine puis recule, limité à -reverseMaxSpeed', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    run(kart, 20 / PHYSICS.brakeDeceleration - 0.05, { brake: true });
    expect(kart.speed).toBeGreaterThan(0);
    expect(kart.speed).toBeLessThan(2);
    let lowest = 0;
    run(kart, 5, { brake: true }, { observe: () => (lowest = Math.min(lowest, kart.speed)) });
    expect(kart.speed).toBeCloseTo(-PHYSICS.reverseMaxSpeed, 9);
    expect(lowest).toBeGreaterThanOrEqual(-PHYSICS.reverseMaxSpeed);
  });

  it('frein + gaz = frein', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    step(kart, { brake: true, throttle: true });
    expect(kart.speed).toBeCloseTo(20 - PHYSICS.brakeDeceleration * FIXED_DT, 9);
  });

  it('en roue libre, le kart ralentit jusqu’à l’arrêt', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    run(kart, 1, {});
    expect(kart.speed).toBeCloseTo(20 - PHYSICS.coastDeceleration, 6);
    run(kart, 10, {});
    expect(kart.speed).toBe(0);
  });
});

describe('stepKart — direction', () => {
  it('steer +1 (droite) fait diminuer le cap et part à droite', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    const start = kart.position;
    const heading0 = kart.heading;
    run(kart, 0.5, { throttle: true, steer: 1 });
    expect(wrapAngle(kart.heading - heading0)).toBeLessThan(-0.3);
    expect(dot(sub(kart.position, start), leftOf(heading0))).toBeLessThan(0);
  });

  it('steer -1 (gauche) fait augmenter le cap et part à gauche', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    const start = kart.position;
    const heading0 = kart.heading;
    run(kart, 0.5, { throttle: true, steer: -1 });
    expect(wrapAngle(kart.heading - heading0)).toBeGreaterThan(0.3);
    expect(dot(sub(kart.position, start), leftOf(heading0))).toBeGreaterThan(0);
  });

  it('le volant converge vers la consigne', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    step(kart, { steer: 1 });
    expect(kart.steer).toBeCloseTo(PHYSICS.steerResponse * FIXED_DT, 9);
    run(kart, 0.5, { steer: 3 });
    expect(kart.steer).toBe(1);
  });

  it('ne tourne pas à l’arrêt', () => {
    const kart = kartOn(STRAIGHT, 0);
    const heading0 = kart.heading;
    run(kart, 1, { steer: 1 });
    expect(wrapAngle(kart.heading - heading0)).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])('une consigne de braquage invalide (%d) vaut tout droit', (steer) => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    const heading0 = kart.heading;
    run(kart, 0.2, { throttle: true, steer });
    expect(kart.steer).toBe(0);
    expect(wrapAngle(kart.heading - heading0)).toBeCloseTo(0, 12);
    expect(Number.isFinite(kart.position.x) && Number.isFinite(kart.position.z)).toBe(true);
  });

  it('en marche arrière, le sens de rotation s’inverse', () => {
    const kart = kartOn(STRAIGHT, 0, 0, -PHYSICS.reverseMaxSpeed);
    const heading0 = kart.heading;
    run(kart, 0.5, { brake: true, steer: 1 });
    expect(wrapAngle(kart.heading - heading0)).toBeGreaterThan(0);
  });
});

describe('stepKart — dérapage', () => {
  it('ne démarre pas sous la vitesse minimale', () => {
    const kart = kartOn(STRAIGHT, 0, 0, DRIFT.minSpeed - 1);
    const events = run(kart, 0.5, { drift: true, steer: 1 });
    expect(kart.drift.active).toBe(false);
    expect(ofType(events, 'drift-start')).toHaveLength(0);
  });

  it.each([
    [1, 1],
    [-1, -1],
  ] as const)('démarre dans le sens du braquage (steer %d)', (steer, direction) => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    const events = step(kart, { throttle: true, drift: true, steer });
    expect(kart.drift).toEqual({ active: true, direction, charge: 0, tier: 0 });
    expect(kart.hopTime).toBe(DRIFT.hopDuration);
    expect(events).toEqual([{ type: 'drift-start' }]);
  });

  it('atteint les paliers 1, 2 et 3 aux temps prévus', () => {
    const kart = kartOn(OPEN, 0, 0, 25);
    step(kart, { throttle: true, drift: true, steer: 1 }, OPEN);
    const reached: { tier: number; t: number }[] = [];
    run(kart, 3, { throttle: true, drift: true, steer: 0 }, {
      track: OPEN,
      observe: (t, events) => ofType(events, 'drift-tier').forEach(({ tier }) => reached.push({ tier, t })),
    });
    expect(reached.map(({ tier }) => tier)).toEqual([1, 2, 3]);
    reached.forEach(({ t }, i) => expect(Math.abs(t - DRIFT.tierThresholds[i])).toBeLessThanOrEqual(FIXED_DT + 1e-9));
    expect(kart.drift.tier).toBe(3);
  });

  it.each([
    [1, 1, 1.5],
    [1, -1, 1],
    [-1, -1, 1.5],
    [-1, 1, 1],
  ] as const)('dérapage %d, braquage %d : charge à la vitesse ×%d (le contre-braquage ne ralentit pas)', (direction, steer, rate) => {
    const kart = kartOn(OPEN, 0, 0, 25);
    step(kart, { throttle: true, drift: true, steer: direction }, OPEN);
    let firstTierAt = 0;
    run(kart, 1, { throttle: true, drift: true, steer }, {
      track: OPEN,
      observe: (t, events) => {
        if (!firstTierAt && ofType(events, 'drift-tier').length) firstTierAt = t;
      },
    });
    expect(Math.abs(firstTierAt - DRIFT.tierThresholds[0] / rate)).toBeLessThanOrEqual(FIXED_DT + 1e-9);
  });

  it('un grand pas qui franchit plusieurs paliers les signale tous, dans l’ordre', () => {
    const kart = kartOn(OPEN, 0, 0, 25);
    step(kart, { throttle: true, drift: true, steer: 1 }, OPEN);
    const events: KartEvent[] = [];
    stepKart(kart, { ...NEUTRAL_INPUT, throttle: true, drift: true }, TEST_TUNING, OPEN, 3, (event) => events.push(event));
    expect(events).toEqual([
      { type: 'drift-tier', tier: 1 },
      { type: 'drift-tier', tier: 2 },
      { type: 'drift-tier', tier: 3 },
    ]);
    expect(kart.drift.tier).toBe(3);
  });

  it('seuils de départ : vitesse ≥ minSpeed incluse, |steer| > 0,2 strict', () => {
    const atMinSpeed = kartOn(OPEN, 0, 0, DRIFT.minSpeed);
    step(atMinSpeed, { drift: true, steer: 1 }, OPEN);
    expect(atMinSpeed.drift.active).toBe(true);
    const weakSteer = kartOn(OPEN, 0, 0, 20);
    step(weakSteer, { drift: true, steer: -0.2 }, OPEN);
    expect(weakSteer.drift.active).toBe(false);
    step(weakSteer, { drift: true, steer: -0.25 }, OPEN);
    expect(weakSteer.drift).toMatchObject({ active: true, direction: -1 });
  });

  it('appui trop lent pour déraper : simple saut, sans événement', () => {
    const kart = kartOn(OPEN, 0, 0, DRIFT.minSpeed - 1);
    const events = step(kart, { drift: true, steer: 1 }, OPEN);
    expect(kart.drift.active).toBe(false);
    expect(kart.hopTime).toBe(DRIFT.hopDuration);
    expect(events).toEqual([]);
  });

  it('relâcher au palier 2 donne un boost de 1,1 s', () => {
    const kart = kartOn(OPEN, 0, 0, 25);
    step(kart, { throttle: true, drift: true, steer: 1 }, OPEN);
    run(kart, 2, { throttle: true, drift: true, steer: 0 }, { track: OPEN });
    expect(kart.drift.tier).toBe(2);
    const events = step(kart, { throttle: true }, OPEN);
    expect(events).toEqual([{ type: 'boost', source: 'drift', tier: 2 }]);
    expect(kart.boostTime).toBeCloseTo(DRIFT.boostDurations[2], 9);
    expect(kart.boostStrength).toBe(DRIFT.boostStrength);
    expect(kart.drift).toEqual({ active: false, direction: 0, charge: 0, tier: 0 });
  });

  it('relâcher avant le palier 1 ne donne rien', () => {
    const kart = kartOn(OPEN, 0, 0, 25);
    // Braquage dans le sens du dérapage : charge ×1,5 ; on relâche à 80 % du premier seuil.
    run(kart, (0.8 * DRIFT.tierThresholds[0]) / 1.5, { throttle: true, drift: true, steer: 1 }, { track: OPEN });
    const events = step(kart, { throttle: true }, OPEN);
    expect(events).toEqual([]);
    expect(kart.boostTime).toBe(0);
    expect(kart.drift.active).toBe(false);
  });

  it('s’annule sans boost sous 70 % de la vitesse minimale', () => {
    const kart = kartOn(OPEN, 0, 0, 25);
    run(kart, 1, { throttle: true, drift: true, steer: 1 }, { track: OPEN });
    expect(kart.drift.tier).toBeGreaterThan(0);
    let cancelSpeed = Number.NaN;
    const events = run(kart, 1.5, { brake: true, drift: true, steer: 1 }, {
      track: OPEN,
      observe: () => {
        if (!kart.drift.active && Number.isNaN(cancelSpeed)) cancelSpeed = kart.speed;
      },
    });
    expect(kart.drift.active).toBe(false);
    expect(cancelSpeed).toBeLessThan(0.7 * DRIFT.minSpeed);
    expect(cancelSpeed).toBeGreaterThan(0.7 * DRIFT.minSpeed - PHYSICS.brakeDeceleration * FIXED_DT * 2);
    expect(ofType(events, 'boost')).toHaveLength(0);
    step(kart, {}, OPEN);
    expect(kart.boostTime).toBe(0);
  });

  it('touche sans braquage : simple saut, une seule fois tant qu’elle reste maintenue', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    let hops = 0;
    let previousHop = 0;
    const events = run(kart, 1.5, { throttle: true, drift: true }, {
      observe: () => {
        if (kart.hopTime > previousHop) hops++;
        previousHop = kart.hopTime;
      },
    });
    expect(hops).toBe(1);
    expect(kart.drift.active).toBe(false);
    expect(kart.hopTime).toBe(0);
    expect(events).toEqual([]);
    // Nouvel appui : nouveau saut.
    step(kart, { throttle: true });
    step(kart, { throttle: true, drift: true });
    expect(kart.hopTime).toBe(DRIFT.hopDuration);
  });

  it.each([1, -1] as const)('le dérapage (sens %d) tourne dans son sens, plus ou moins serré selon le braquage', (direction) => {
    const turnWith = (steer: number): number => {
      const kart = kartOn(OPEN, 0, 0, 25);
      step(kart, { throttle: true, drift: true, steer: direction }, OPEN);
      expect(kart.drift.direction).toBe(direction);
      const heading0 = kart.heading;
      run(kart, 0.25, { throttle: true, drift: true, steer }, { track: OPEN });
      return wrapAngle(kart.heading - heading0);
    };
    const wide = turnWith(-direction);
    const tight = turnWith(direction);
    // Dérapage à droite (+1) : le cap diminue ; à gauche (-1) : il augmente.
    expect(Math.sign(wide)).toBe(-direction);
    expect(Math.abs(tight)).toBeGreaterThan(Math.abs(wide));
    expect(wide).toBeCloseTo(-direction * TEST_TUNING.turnRate * DRIFT.steerMin * 0.25, 6);
    expect(tight).toBeCloseTo(-direction * TEST_TUNING.turnRate * DRIFT.steerMax * 0.25, 6);
  });

  it.each([1, -1] as const)('pose visuelle (sens %d) : le kart glisse nez vers l’intérieur, selon le braquage, puis revient à 0', (direction) => {
    const kart = kartOn(OPEN, 0, 0, 25);
    step(kart, { throttle: true, drift: true, steer: direction }, OPEN);
    run(kart, 1, { throttle: true, drift: true, steer: 0 }, { track: OPEN });
    expect(kart.visualYaw).toBeCloseTo(-direction * DRIFT.visualYaw, 3);
    run(kart, 1, { throttle: true, drift: true, steer: direction }, { track: OPEN });
    expect(kart.visualYaw).toBeCloseTo(-direction * (DRIFT.visualYaw + DRIFT.visualYawSteer), 3);
    run(kart, 1, { throttle: true, drift: true, steer: -direction }, { track: OPEN });
    expect(kart.visualYaw).toBeCloseTo(-direction * (DRIFT.visualYaw - DRIFT.visualYawSteer), 3);
    // Glisse nettement visible (plus de 20°) quel que soit le braquage.
    expect(Math.abs(kart.visualYaw)).toBeGreaterThan((20 * Math.PI) / 180);
    run(kart, 1.5, { throttle: true }, { track: OPEN });
    expect(Math.abs(kart.visualYaw)).toBeLessThan(1e-3);
  });
});

describe('stepKart — boost', () => {
  it('relève la vitesse max et agit comme un gaz maintenu', () => {
    const kart = kartOn(STRAIGHT, 0, 0, TEST_TUNING.maxSpeed);
    applyBoost(kart, DRIFT.boostDurations[2], DRIFT.boostStrength);
    let top = 0;
    run(kart, DRIFT.boostDurations[2], {}, { observe: () => (top = Math.max(top, kart.speed)) });
    expect(top).toBeGreaterThan(TEST_TUNING.maxSpeed + 3);
    expect(top).toBeLessThanOrEqual(TEST_TUNING.maxSpeed * DRIFT.boostStrength + 1e-9);
    step(kart, { throttle: true });
    expect(kart.boostTime).toBe(0);
    expect(kart.boostStrength).toBe(1);
    run(kart, 3, { throttle: true });
    expect(kart.speed).toBeCloseTo(TEST_TUNING.maxSpeed, 6);
  });

  it('au-dessus du max effectif, la vitesse redescend en douceur', () => {
    const kart = kartOn(STRAIGHT, 0, 0, TEST_TUNING.maxSpeed + 6);
    step(kart, { throttle: true });
    expect(kart.speed).toBeCloseTo(TEST_TUNING.maxSpeed + 6 - 12 * FIXED_DT, 9);
  });

  it('au-dessus du max effectif, lâcher les gaz ne ralentit pas moins vite que les garder', () => {
    const start = TEST_TUNING.maxSpeed * DRIFT.boostStrength;
    const coasting = kartOn(STRAIGHT, 0, 0, start);
    const throttling = kartOn(STRAIGHT, 0, 0, start);
    step(coasting, {});
    step(throttling, { throttle: true });
    expect(coasting.speed).toBeCloseTo(throttling.speed, 9);
    // Revenu sous le max, la roue libre normale (coastDeceleration) reprend.
    run(coasting, 1, {});
    expect(coasting.speed).toBeLessThan(TEST_TUNING.maxSpeed);
    const speed = coasting.speed;
    step(coasting, {});
    expect(coasting.speed).toBeCloseTo(speed - PHYSICS.coastDeceleration * FIXED_DT, 9);
  });
});

describe('stepKart — bas-côté', () => {
  const offroadLateral = (ROAD_HALF_WIDTH + WALL_LIMIT) / 2;

  it('réduit la vitesse max hors de la route', () => {
    const kart = kartOn(STRAIGHT, 0, offroadLateral);
    run(kart, 8, (k) => ({ throttle: true, steer: followLine(k, STRAIGHT, offroadLateral) }));
    expect(kart.offroad).toBe(true);
    expect(kart.wallContact).toBe(false);
    expect(kart.speed).toBeCloseTo(TEST_TUNING.maxSpeed * TEST_TUNING.offroadFactor, 1);
  });

  it.each([true, false])('un kart rapide qui quitte la route ralentit progressivement (gaz : %s)', (throttle) => {
    const kart = kartOn(STRAIGHT, 0, offroadLateral, TEST_TUNING.maxSpeed);
    step(kart, { throttle: true });
    expect(kart.offroad).toBe(true);
    step(kart, { throttle });
    expect(kart.speed).toBeCloseTo(TEST_TUNING.maxSpeed - 12 * FIXED_DT, 9);
  });

  it('ne ralentit pas pendant un boost', () => {
    const kart = kartOn(STRAIGHT, 0, offroadLateral, TEST_TUNING.maxSpeed * TEST_TUNING.offroadFactor);
    step(kart, { throttle: true });
    expect(kart.offroad).toBe(true);
    applyBoost(kart, 1, DRIFT.boostStrength);
    run(kart, 1, (k) => ({ throttle: true, steer: followLine(k, STRAIGHT, offroadLateral) }));
    expect(kart.offroad).toBe(true);
    expect(kart.speed).toBeGreaterThan(TEST_TUNING.maxSpeed);
  });
});

describe('stepKart — haies', () => {
  it.each([
    ['extérieur (droite)', -1],
    ['intérieur (gauche)', 1],
  ] as const)('un kart lancé perpendiculairement vers l’%s reste contenu', (_label, side) => {
    const kart = kartOn(STRAIGHT, 100, 0, TEST_TUNING.maxSpeed);
    const sample = STRAIGHT.sampleAt(100);
    kart.heading = headingOf(scale(sample.left, side));
    let speedBeforeImpact = 0;
    let speedAfterImpact = 0;
    let contactSteps = 0;
    const observe = (): void => {
      expect(Math.abs(kart.lateral)).toBeLessThanOrEqual(WALL_LIMIT + 1e-6);
      expect(Math.abs(STRAIGHT.project(kart.position).lateral)).toBeLessThanOrEqual(WALL_LIMIT + 1e-6);
      if (kart.wallContact) {
        contactSteps++;
        if (!speedAfterImpact) speedAfterImpact = kart.speed;
      } else if (!speedAfterImpact) {
        speedBeforeImpact = kart.speed;
      }
    };
    // Choc tout droit ; dès que le kart longe la haie, il braque vers elle (steer +1 = droite) et la frotte.
    let aligned = false;
    const controls = (k: KartState): Partial<DriverInput> => {
      const tangentHeading = headingOf(STRAIGHT.project(k.position).sample.tangent);
      aligned ||= k.wallContact && Math.abs(wrapAngle(k.heading - tangentHeading)) < 0.01;
      return { throttle: true, steer: aligned ? -side * 0.4 : 0 };
    };
    const events = run(kart, 3.5, controls, { observe });
    const walls = ofType(events, 'wall');
    expect(walls).toHaveLength(1);
    expect(walls[0].intensity).toBeGreaterThan(0.8);
    // Un choc de face conserve wallSpeedRetention (la perte ne se cumule pas pas après pas).
    expect(speedAfterImpact).toBeCloseTo(speedBeforeImpact * PHYSICS.wallSpeedRetention, 0);
    expect(contactSteps).toBeGreaterThan(60);
    expect(Math.sign(kart.lateral)).toBe(side);
    // Le cap a été ramené le long de la haie, dans le sens de la course.
    expect(Math.abs(wrapAngle(kart.heading - headingOf(STRAIGHT.project(kart.position).sample.tangent)))).toBeLessThan(0.1);
    expect(kart.speed).toBeGreaterThan(5);
  });

  it('un choc rasant coûte peu et aligne le kart le long de la haie', () => {
    const kart = kartOn(STRAIGHT, 100, -WALL_LIMIT + 0.05, 25, -0.05);
    let speedBefore = kart.speed;
    let events: KartEvent[] = [];
    for (let i = 0; i < 30 && !kart.wallContact; i++) {
      speedBefore = kart.speed;
      events = step(kart, { throttle: true });
    }
    expect(kart.wallContact).toBe(true);
    const walls = ofType(events, 'wall');
    expect(walls).toHaveLength(1);
    expect(walls[0].intensity).toBeLessThan(0.1);
    // Perte ≈ 40 % × (2 × 0,05 + 0,2) = 12 %.
    expect(kart.speed).toBeGreaterThan(speedBefore * 0.87);
    const tangentHeading = headingOf(STRAIGHT.project(kart.position).sample.tangent);
    expect(Math.abs(wrapAngle(kart.heading - tangentHeading))).toBeLessThan(1e-9);
  });

  it('en marche arrière contre la haie, le kart n’est pas retourné', () => {
    const kart = kartOn(STRAIGHT, 100, -WALL_LIMIT + 0.5, -PHYSICS.reverseMaxSpeed, 0.5);
    const tangentHeading = headingOf(STRAIGHT.sampleAt(100).tangent);
    let touched = false;
    run(kart, 1, { brake: true }, { observe: () => (touched ||= kart.wallContact) });
    expect(touched).toBe(true);
    expect(Math.abs(wrapAngle(kart.heading - tangentHeading))).toBeLessThan(0.5);
  });

  it('un nouveau choc (après avoir quitté la haie, ou fort en la frottant) émet un nouvel événement', () => {
    /** Cap perpendiculaire vers la haie extérieure (droite), à l'abscisse actuelle du kart. */
    const outward = (kart: KartState): number => headingOf(scale(STRAIGHT.project(kart.position).sample.left, -1));
    const kart = kartOn(STRAIGHT, 100, 0, TEST_TUNING.maxSpeed);
    kart.heading = outward(kart);
    expect(ofType(run(kart, 1, { throttle: true }), 'wall')).toHaveLength(1);
    expect(kart.wallContact).toBe(true);

    // Choc fort pendant le contact : signalé et coûteux.
    kart.heading = outward(kart);
    kart.speed = 25;
    const strong = ofType(step(kart, { brake: true }), 'wall');
    expect(kart.wallContact).toBe(true);
    expect(strong).toHaveLength(1);
    expect(strong[0].intensity).toBeGreaterThan(0.3);
    expect(kart.speed).toBeCloseTo((25 - PHYSICS.brakeDeceleration * FIXED_DT) * PHYSICS.wallSpeedRetention, 6);

    // Le kart s'éloigne, puis revient frôler la haie : nouveau contact, donc nouvel événement même faible.
    kart.heading = wrapAngle(outward(kart) + Math.PI);
    run(kart, 0.1, { throttle: true });
    expect(kart.wallContact).toBe(false);
    kart.heading = headingOf(STRAIGHT.project(kart.position).sample.tangent) - 0.15;
    const graze = ofType(run(kart, 2, { throttle: true }), 'wall');
    expect(graze).toHaveLength(1);
    expect(graze[0].intensity).toBeLessThan(0.3);
  });

  describe.each(['left', 'right'] as const)('sur le cercle de 60 m (virage à %s)', (direction) => {
    const track = createCircleTrack(60, direction);
    it.each([
      ['gauche', 1],
      ['droite', -1],
    ] as const)('un kart lancé vers la haie de %s la touche de ce côté et reste contenu', (_label, side) => {
      const kart = kartOn(track, 50, 0, TEST_TUNING.maxSpeed);
      kart.heading = headingOf(scale(track.sampleAt(50).left, side));
      let contactLateral = Number.NaN;
      let stepsSinceContact = -1;
      let headingError = Number.NaN;
      const events = run(kart, 1, { throttle: true }, {
        track,
        observe: () => {
          expect(Math.abs(track.project(kart.position).lateral)).toBeLessThanOrEqual(WALL_LIMIT + 1e-6);
          if (stepsSinceContact < 0 && kart.wallContact) {
            contactLateral = kart.lateral;
            stepsSinceContact = 0;
          } else if (stepsSinceContact >= 0 && ++stepsSinceContact === 10) {
            headingError = Math.abs(wrapAngle(kart.heading - headingOf(track.project(kart.position).sample.tangent)));
          }
        },
      });
      // lateral > 0 = gauche, quel que soit le sens du virage.
      expect(contactLateral).toBeCloseTo(side * WALL_LIMIT, 9);
      expect(ofType(events, 'wall').length).toBeGreaterThanOrEqual(1);
      // Peu après le choc, le kart est ramené dans le sens de la course.
      expect(headingError).toBeLessThan(0.15);
    });
  });

  it('un kart qui longe la haie en s’en éloignant ne perd pas de vitesse', () => {
    const kart = kartOn(STRAIGHT, 100, -WALL_LIMIT - 0.3, 20, 0.2);
    const events = step(kart, {});
    expect(kart.wallContact).toBe(true);
    expect(kart.lateral).toBeCloseTo(-WALL_LIMIT, 9);
    expect(kart.speed).toBeCloseTo(20 - PHYSICS.coastDeceleration * FIXED_DT, 9);
    expect(events).toEqual([]);
  });
});

describe('stepKart — tête-à-queue', () => {
  it('ignore les commandes, freine et tourne visuellement, puis rend la main', () => {
    const kart = kartOn(STRAIGHT, 0, 0, TEST_TUNING.maxSpeed);
    step(kart, { throttle: true, drift: true, steer: 1 });
    expect(kart.drift.active).toBe(true);
    applySpinOut(kart);
    const heading0 = kart.heading;
    let previousSpeed = kart.speed;
    let maxYaw = 0;
    const spinEvents = run(kart, 0.95, { throttle: true, drift: true, steer: 1 }, {
      observe: () => {
        expect(kart.heading).toBe(heading0);
        expect(kart.speed).toBeLessThanOrEqual(previousSpeed);
        expect(kart.drift.active).toBe(false);
        expect(kart.steer).toBe(0);
        previousSpeed = kart.speed;
        maxYaw = Math.max(maxYaw, Math.abs(kart.visualYaw));
      },
    });
    expect(spinEvents).toEqual([]);
    expect(kart.speed).toBe(0);
    expect(maxYaw).toBeGreaterThan(2);
    run(kart, 1.5, {});
    expect(kart.spinTime).toBe(0);
    expect(Math.abs(kart.visualYaw)).toBeLessThan(0.01);
    run(kart, 1, { throttle: true, steer: 1 });
    expect(kart.speed).toBeGreaterThan(5);
    expect(wrapAngle(kart.heading - heading0)).toBeLessThan(0);
  });
});

describe('stepKart — interpolation', () => {
  it('mémorise la position et le cap du début de pas', () => {
    const kart = kartOn(STRAIGHT, 0, 0, 20);
    run(kart, 0.2, { throttle: true, steer: 0.5 });
    const position = { ...kart.position };
    const heading = kart.heading;
    step(kart, { throttle: true, steer: 0.5 });
    expect(kart.prevPosition).toEqual(position);
    expect(kart.prevHeading).toBe(heading);
    expect(kart.prevPosition).not.toBe(kart.position);
    expect(kart.position).not.toEqual(position);
  });
});

describe.each(['left', 'right'] as const)('stepKart — un tour complet (virage à %s)', (direction) => {
  it('un pilote simple boucle le cercle de 60 m sans toucher les haies', () => {
    const track = createCircleTrack(60, direction);
    const kart = kartOn(track, 0);
    let travelled = 0;
    let turned = 0;
    let lastS = track.project(kart.position).s;
    let wallSteps = 0;
    let maxLateral = 0;
    const events: KartEvent[] = [];
    for (let i = 0; i < 60 * 30 && travelled < track.length; i++) {
      events.push(...step(kart, { throttle: true, steer: followLine(kart, track) }, track));
      const s = track.project(kart.position).s;
      travelled += wrapAngle(((s - lastS) / track.length) * 2 * Math.PI) * (track.length / (2 * Math.PI));
      lastS = s;
      turned += wrapAngle(kart.heading - kart.prevHeading);
      if (kart.wallContact) wallSteps++;
      maxLateral = Math.max(maxLateral, Math.abs(kart.lateral));
    }
    expect(travelled).toBeGreaterThanOrEqual(track.length);
    expect(wallSteps).toBe(0);
    expect(ofType(events, 'wall')).toHaveLength(0);
    expect(maxLateral).toBeLessThan(ROAD_HALF_WIDTH);
    // Virage à gauche = cap qui augmente (un tour ≈ +2π), à droite = cap qui diminue.
    expect(Math.sign(turned)).toBe(direction === 'left' ? 1 : -1);
    expect(Math.abs(turned)).toBeGreaterThan(1.8 * Math.PI);
    expect(kart.speed).toBeGreaterThan(0.9 * TEST_TUNING.maxSpeed);
  });
});
