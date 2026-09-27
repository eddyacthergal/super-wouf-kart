import { describe, expect, it } from 'vitest';
import { FIXED_DT, ITEMS, KART_RADIUS, ROAD_HALF_WIDTH } from '../core/constants';
import { createRng } from '../core/rng';
import type { GameEvent, ItemEntity, RaceState, RacerState, Rng, TrackQuery } from '../core/types';
import {
  addScaled,
  clone,
  distance,
  dot,
  forwardOf,
  headingOf,
  leftOf,
  sub,
  wrapAngle,
} from '../core/vec2';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import {
  BOX_LATERAL_OFFSETS,
  createItemBoxes,
  stepItems,
  usableItem,
  useItem,
} from './item-system';

/** Circuit quasi rectiligne pour les lancers en ligne droite. */
const STRAIGHT_RADIUS = 2000;
const PROJECTILE_LIMIT = (track: TrackQuery): number =>
  track.wallHalfWidth - ITEMS.projectileRadius;
/** Rotation maximale de la balle exigée par la spécification du module (rad/s). */
const BALL_TURN_RATE = 5;
/** Loin de tout : un pilote placé ici ne gêne plus les objets. */
const FAR_AWAY = { x: 5000, z: 5000 };

function recorder(): { events: GameEvent[]; emit: (event: GameEvent) => void } {
  const events: GameEvent[] = [];
  return { events, emit: (event) => events.push(event) };
}

/** Rng qui renvoie toujours la même valeur (tirages prévisibles). */
function fixedRng(value: number): Rng {
  return {
    next: () => value,
    range: (min, max) => min + (max - min) * value,
    int: (min, max) => Math.floor(min + (max - min + 1) * value),
    pick: <T>(items: readonly T[]): T => items[Math.floor(value * items.length)],
  };
}

/** Point à `ahead` m devant et `left` m à gauche d'une entité, selon son cap. */
const besideEntity = (entity: ItemEntity, ahead: number, left: number) =>
  addScaled(
    addScaled(entity.position, forwardOf(entity.heading), ahead),
    leftOf(entity.heading),
    left,
  );

/** Place un kart sur le circuit à l'abscisse s, dans le sens de la course. */
function placeOnTrack(racer: RacerState, track: TrackQuery, s: number, lateral = 0): void {
  const sample = track.sampleAt(s);
  const kart = racer.kart;
  kart.position = {
    x: sample.position.x + sample.left.x * lateral,
    z: sample.position.z + sample.left.z * lateral,
  };
  kart.prevPosition = clone(kart.position);
  kart.heading = headingOf(sample.tangent);
  kart.prevHeading = kart.heading;
  const projection = track.project(kart.position);
  kart.trackIndex = projection.index;
  kart.lateral = projection.lateral;
  racer.lastS = projection.s;
}

/** Enchaîne des pas jusqu'à ce que `stop` soit vrai ; renvoie le nombre de pas effectués. */
function stepUntil(
  race: RaceState,
  track: TrackQuery,
  emit: (event: GameEvent) => void,
  maxSteps: number,
  stop: () => boolean,
  beforeStep?: (step: number) => void,
): number {
  const rng = createRng(1);
  for (let step = 1; step <= maxSteps; step++) {
    beforeStep?.(step);
    stepItems(race, track, rng, FIXED_DT, emit);
    if (stop()) return step;
  }
  return maxSteps;
}

const hits = (events: GameEvent[]): Extract<GameEvent, { type: 'hit' }>[] =>
  events.filter((event): event is Extract<GameEvent, { type: 'hit' }> => event.type === 'hit');

describe('createItemBoxes', () => {
  it('crée 4 boîtes par rangée, sur la route, avec des ids consécutifs', () => {
    const track: TrackQuery = { ...createCircleTrack(60), itemBoxRows: [20, 150, 280] };
    const boxes = createItemBoxes(track);
    expect(boxes).toHaveLength(12);
    boxes.forEach((box, index) => {
      expect(box.id).toBe(index);
      expect(box.respawn).toBe(0);
      const projection = track.project(box.position);
      expect(Math.abs(projection.lateral)).toBeLessThan(ROAD_HALF_WIDTH);
      expect(projection.lateral).toBeCloseTo(BOX_LATERAL_OFFSETS[index % 4], 6);
      expect(projection.s).toBeCloseTo(track.itemBoxRows[Math.floor(index / 4)], 6);
    });
  });
});

describe('boîtes et roulette', () => {
  it('donne un objet au ramassage puis le rend utilisable après la roulette', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 2);
    race.itemBoxes = createItemBoxes(track);
    const racer = race.racers[0];
    const box = race.itemBoxes[1];
    racer.kart.position = clone(box.position);
    const { events, emit } = recorder();

    stepItems(race, track, createRng(5), FIXED_DT, emit);
    expect(racer.items).not.toEqual([]);
    expect(racer.itemRoulette).toBe(ITEMS.rouletteDuration);
    expect(box.respawn).toBe(ITEMS.boxRespawn);
    expect(events).toEqual([{ type: 'item-box', racerId: 0 }]);

    racer.kart.position = { x: 0, z: 0 };
    const rouletteSteps = Math.round(ITEMS.rouletteDuration / FIXED_DT);
    stepUntil(race, track, emit, rouletteSteps - 2, () => false);
    expect(events.some((event) => event.type === 'item-ready')).toBe(false);
    stepUntil(race, track, emit, 5, () => false);
    expect(racer.itemRoulette).toBe(0);
    expect(events.filter((event) => event.type === 'item-ready')).toEqual([
      { type: 'item-ready', racerId: 0, item: racer.items[0] },
    ]);
  });

  it('une boîte cassée ne redonne pas d’objet à qui en a déjà deux et réapparaît après 3 s', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 2);
    race.itemBoxes = createItemBoxes(track);
    const [holder, other] = race.racers;
    const box = race.itemBoxes[0];
    holder.items = ['bone', 'mud'];
    holder.kart.position = clone(box.position);
    const { events, emit } = recorder();

    stepItems(race, track, createRng(5), FIXED_DT, emit);
    expect(holder.items).toEqual(['bone', 'mud']);
    expect(holder.itemRoulette).toBe(0);
    expect(box.respawn).toBe(ITEMS.boxRespawn);
    expect(events).toEqual([]);

    // Un autre pilote passe sur la boîte cassée : rien à ramasser.
    holder.kart.position = { x: 0, z: 0 };
    other.kart.position = clone(box.position);
    stepUntil(race, track, emit, Math.round(2.9 / FIXED_DT), () => false);
    expect(box.respawn).toBeGreaterThan(0);
    expect(other.items).toEqual([]);

    // La boîte réapparaît ; le pilote toujours présent la ramasse aussitôt.
    stepUntil(race, track, emit, Math.round(0.2 / FIXED_DT), () => other.items.length > 0);
    expect(other.items).not.toEqual([]);
    expect(events).toEqual([{ type: 'item-box', racerId: 1 }]);
  });

  it('tire l’objet selon le rang du pilote parmi tous les pilotes', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 8);
    race.itemBoxes = createItemBoxes(track);
    const leader = race.racers[0];
    const last = race.racers[7];
    leader.kart.position = clone(race.itemBoxes[0].position);
    last.kart.position = clone(race.itemBoxes[4].position);

    // Tirage à mi-hauteur : flaque pour le premier (poids 40|40|5|10|0|0|0|0, seuil à 47,5 dans la
    // flaque), croquette turbo pour le dernier (poids 10|5|20|15|15|8|12|10, seuil à 47,5 dans la
    // croquette, cumul 35 à 50).
    stepItems(race, track, fixedRng(0.5), FIXED_DT, () => undefined);
    expect(leader.items).toEqual(['mud']);
    expect(last.items).toEqual(['kibble-turbo']);
  });

  it.each([
    { gap: ITEMS.boxPickupRadius - 0.05, picked: true },
    { gap: ITEMS.boxPickupRadius + 0.05, picked: false },
  ])('ramasse une boîte à moins de boxPickupRadius (écart $gap m : $picked)', ({ gap, picked }) => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 1);
    race.itemBoxes = createItemBoxes(track);
    const box = race.itemBoxes[0];
    const racer = race.racers[0];
    racer.kart.position = addScaled(
      box.position,
      track.sampleAt(track.itemBoxRows[0]).tangent,
      gap,
    );

    stepItems(race, track, createRng(1), FIXED_DT, () => undefined);
    expect(racer.items.length > 0).toBe(picked);
    expect(box.respawn).toBe(picked ? ITEMS.boxRespawn : 0);
  });

  it('deux pilotes sur la même boîte : celui qui a de la place le reçoit', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 2);
    race.itemBoxes = createItemBoxes(track);
    const [holder, other] = race.racers;
    const box = race.itemBoxes[0];
    const tangent = track.sampleAt(track.itemBoxRows[0]).tangent;
    holder.items = ['bone', 'mud'];
    holder.kart.position = addScaled(box.position, tangent, 1);
    other.kart.position = addScaled(box.position, tangent, -1);
    const { events, emit } = recorder();

    stepItems(race, track, createRng(5), FIXED_DT, emit);
    expect(holder.items).toEqual(['bone', 'mud']);
    expect(other.items).not.toEqual([]);
    expect(box.respawn).toBe(ITEMS.boxRespawn);
    expect(events).toEqual([{ type: 'item-box', racerId: 1 }]);
  });

  it('refuse l’utilisation pendant la roulette', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 2);
    const racer = race.racers[0];
    racer.items = ['bone'];
    racer.itemRoulette = 0.5;
    const { events, emit } = recorder();

    useItem(race, racer, track, false, emit);
    expect(racer.items).toEqual(['bone']);
    expect(race.items).toEqual([]);
    expect(events).toEqual([]);

    racer.items = [];
    racer.itemRoulette = 0;
    useItem(race, racer, track, false, emit);
    expect(events).toEqual([]);
  });

  it('ramasse un second objet, jamais un troisième, dans l’ordre', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    race.itemBoxes = [{ id: 0, position: clone(racer.kart.position), respawn: 0, height: 0 }];
    racer.items = ['mud'];
    const { events, emit } = recorder();
    stepItems(race, track, fixedRng(0), FIXED_DT, emit);
    expect(racer.items).toEqual(['mud', 'bone']);
    expect(racer.itemRoulette).toBe(ITEMS.rouletteDuration);
    expect(events).toContainEqual({ type: 'item-box', racerId: racer.id });

    race.itemBoxes[0].respawn = 0;
    racer.itemRoulette = 0;
    stepItems(race, track, fixedRng(0), FIXED_DT, emit);
    expect(racer.items).toEqual(['mud', 'bone']);
    expect(race.itemBoxes[0].respawn).toBe(ITEMS.boxRespawn);
  });

  it('utilise le premier objet pendant la roulette du second, puis le second avance', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    placeOnTrack(racer, track, 100);
    racer.items = ['kibble-turbo', 'bone'];
    racer.itemRoulette = 0.5;
    const { events, emit } = recorder();
    useItem(race, racer, track, false, emit);
    expect(events).toContainEqual({ type: 'item-use', racerId: racer.id, item: 'kibble-turbo' });
    expect(racer.items).toEqual(['bone']);
    // Seul et encore en roulette : inutilisable.
    useItem(race, racer, track, false, emit);
    expect(racer.items).toEqual(['bone']);
    racer.itemRoulette = 0;
    useItem(race, racer, track, false, emit);
    expect(racer.items).toEqual([]);
  });

  it('usableItem : le premier objet, sauf s’il est seul et en roulette', () => {
    const racer = createTestRace(createCircleTrack(STRAIGHT_RADIUS), 1).racers[0];
    expect(usableItem(racer)).toBeNull();
    racer.items = ['mud'];
    racer.itemRoulette = 0.3;
    expect(usableItem(racer)).toBeNull();
    racer.items = ['mud', 'bone'];
    expect(usableItem(racer)).toBe('mud');
    racer.itemRoulette = 0;
    expect(usableItem(racer)).toBe('mud');
  });
});

describe('os', () => {
  it('lancé devant, touche le kart qui précède', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [thrower, victim] = race.racers;
    placeOnTrack(thrower, track, 100);
    placeOnTrack(victim, track, 130);
    thrower.items = ['bone'];
    thrower.kart.speed = 20;
    victim.kart.speed = 25;
    const { events, emit } = recorder();

    useItem(race, thrower, track, false, emit);
    expect(thrower.items).toEqual([]);
    expect(events).toEqual([{ type: 'item-use', racerId: 0, item: 'bone' }]);
    const bone = race.items[0];
    expect(bone).toMatchObject({
      kind: 'bone',
      ownerId: 0,
      speed: ITEMS.boneSpeed + 20,
      armTime: ITEMS.armTime,
      bounces: 0,
      targetId: null,
      trackIndex: track.project(bone.position).index,
    });
    expect(bone.life).toBe(ITEMS.boneLife);
    expect(bone.id).toBe(1);
    expect(race.nextEntityId).toBe(2);
    // prevPosition est une copie : elle est réécrite en place à chaque pas.
    expect(bone.prevPosition).toEqual(bone.position);
    expect(bone.prevPosition).not.toBe(bone.position);
    expect(bone.heading).toBeCloseTo(thrower.kart.heading, 9);
    const offset = sub(bone.position, thrower.kart.position);
    expect(dot(offset, forwardOf(thrower.kart.heading))).toBeCloseTo(KART_RADIUS + 1.2, 6);

    stepUntil(race, track, emit, 60, () => hits(events).length > 0);
    expect(hits(events)).toEqual([{ type: 'hit', racerId: 1, by: 'bone', ownerId: 0 }]);
    expect(victim.kart.spinTime).toBe(ITEMS.spinDuration);
    expect(victim.kart.speed).toBeCloseTo(25 * ITEMS.spinSpeedFactor);
    expect(victim.hitImmunity).toBe(ITEMS.hitImmunity);
    expect(race.items).toEqual([]);
    expect(thrower.kart.spinTime).toBe(0);
  });

  it('lancé en arrière, part derrière le kart à vitesse réduite', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [thrower, victim] = race.racers;
    placeOnTrack(thrower, track, 130);
    placeOnTrack(victim, track, 100);
    thrower.items = ['bone'];
    thrower.kart.speed = 20;
    const { events, emit } = recorder();

    useItem(race, thrower, track, true, emit);
    const bone = race.items[0];
    expect(bone.speed).toBeCloseTo(0.6 * ITEMS.boneSpeed);
    expect(wrapAngle(bone.heading - (thrower.kart.heading + Math.PI))).toBeCloseTo(0, 9);
    const offset = sub(bone.position, thrower.kart.position);
    expect(dot(offset, forwardOf(thrower.kart.heading))).toBeCloseTo(-(KART_RADIUS + 1.2), 6);

    stepUntil(race, track, emit, 120, () => hits(events).length > 0);
    expect(hits(events)).toEqual([{ type: 'hit', racerId: 1, by: 'bone', ownerId: 0 }]);
    expect(race.items).toEqual([]);
  });

  it('lancé devant en marche arrière, part à la vitesse de base', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const thrower = race.racers[0];
    placeOnTrack(thrower, track, 100);
    thrower.kart.speed = -6;
    thrower.items = ['bone'];

    useItem(race, thrower, track, false, () => undefined);
    expect(race.items[0].speed).toBe(ITEMS.boneSpeed);
  });

  it('lancé contre une haie, apparaît à l’intérieur', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const thrower = race.racers[0];
    placeOnTrack(thrower, track, 100, track.wallHalfWidth - KART_RADIUS);
    thrower.kart.heading += Math.PI / 2; // face à la haie de gauche
    thrower.items = ['bone'];

    useItem(race, thrower, track, false, () => undefined);
    const bone = race.items[0];
    expect(track.project(bone.position).lateral).toBeCloseTo(PROJECTILE_LIMIT(track), 6);
    expect(bone.prevPosition).toEqual(bone.position);
  });

  it('rebondit sur les haies et disparaît au-delà de 3 rebonds', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const thrower = race.racers[0];
    placeOnTrack(thrower, track, 100);
    thrower.kart.heading += 1; // vers la haie de gauche
    thrower.items = ['bone'];
    const { emit } = recorder();
    useItem(race, thrower, track, false, emit);
    const bone = race.items[0];

    const components = (): { along: number; across: number } => {
      const sample = track.project(bone.position).sample;
      const direction = forwardOf(bone.heading);
      return { along: dot(direction, sample.tangent), across: dot(direction, sample.left) };
    };
    const initial = components();
    const directions: number[] = [Math.sign(initial.across)];
    let maxBounces = 0;
    const steps = stepUntil(race, track, emit, Math.round(ITEMS.boneLife / FIXED_DT), () => {
      if (race.items.length === 0) return true;
      expect(Math.abs(track.project(bone.position).lateral)).toBeLessThanOrEqual(
        PROJECTILE_LIMIT(track) + 1e-6,
      );
      if (bone.bounces > maxBounces) {
        maxBounces = bone.bounces;
        const { along, across } = components();
        directions.push(Math.sign(across));
        // Réflexion (et non demi-tour) : la composante le long du circuit est conservée.
        expect(along).toBeCloseTo(initial.along, 1);
        expect(Math.abs(across)).toBeCloseTo(Math.abs(initial.across), 1);
      }
      return false;
    });

    expect(maxBounces).toBe(ITEMS.boneMaxBounces);
    expect(directions).toEqual([1, -1, 1, -1]);
    expect(race.items).toEqual([]);
    // Détruit par le 4ᵉ contact, bien avant la fin de sa durée de vie.
    expect(steps * FIXED_DT).toBeLessThan(ITEMS.boneLife / 2);
  });

  it('ne touche pas son lanceur pendant armTime', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const thrower = race.racers[0];
    placeOnTrack(thrower, track, 100);
    thrower.items = ['mud'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    thrower.kart.position = clone(race.items[0].position);

    const steps = stepUntil(race, track, emit, 60, () => hits(events).length > 0);
    expect(steps * FIXED_DT).toBeGreaterThanOrEqual(ITEMS.armTime - 1e-9);
    expect(hits(events)).toEqual([{ type: 'hit', racerId: 0, by: 'mud', ownerId: 0 }]);
  });
});

describe('balle de tennis', () => {
  it('vise le pilote juste devant, ou personne si le lanceur est premier', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 4);
    const { emit } = recorder();
    const [first, second, third] = race.racers;

    third.items = ['tennis-ball'];
    useItem(race, third, track, false, emit);
    expect(race.items[0].targetId).toBe(second.id);
    expect(race.items[0].life).toBe(ITEMS.ballLife);
    expect(race.items[0].speed).toBe(ITEMS.ballSpeed);

    first.items = ['tennis-ball'];
    useItem(race, first, track, false, emit);
    expect(race.items[1].targetId).toBeNull();
  });

  it('ignore un pilote arrivé : vise le plus proche devant encore en course, sinon personne', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 5);
    const { emit } = recorder();
    const [first, second, third, fourth] = race.racers;

    // Le 3ᵉ (juste devant) et le 2ᵉ sont arrivés : la balle vise le 1ᵉʳ, toujours en course.
    third.finished = true;
    second.finished = true;
    fourth.items = ['tennis-ball'];
    useItem(race, fourth, track, false, emit);
    expect(race.items[0].targetId).toBe(first.id);

    // Tous les pilotes devant sont arrivés : aucune cible.
    first.finished = true;
    fourth.items = ['tennis-ball'];
    useItem(race, fourth, track, false, emit);
    expect(race.items[1].targetId).toBeNull();
  });

  it('rattrape sa cible sur un circuit courbe', () => {
    const track = createCircleTrack(40);
    const race = createTestRace(track, 2);
    const [target, thrower] = race.racers;
    placeOnTrack(thrower, track, 0, -2);
    let targetS = 45;
    placeOnTrack(target, track, targetS, 3);
    thrower.items = ['tennis-ball'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    const ball = race.items[0];
    expect(ball.targetId).toBe(target.id);

    const steps = stepUntil(
      race,
      track,
      emit,
      Math.round(6 / FIXED_DT),
      () => {
        if (race.items.length > 0) {
          expect(Math.abs(track.project(ball.position).lateral)).toBeLessThanOrEqual(
            PROJECTILE_LIMIT(track) + 1e-6,
          );
        }
        return hits(events).length > 0;
      },
      () => {
        targetS += 15 * FIXED_DT;
        placeOnTrack(target, track, targetS, 3);
      },
    );

    expect(hits(events)).toEqual([{ type: 'hit', racerId: 0, by: 'tennis-ball', ownerId: 1 }]);
    expect(steps * FIXED_DT).toBeLessThan(4);
    expect(race.items).toEqual([]);
  });

  it('tourne d’au plus 5 rad/s vers une cible proche, du côté de la cible, puis la rattrape', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [target, thrower] = race.racers;
    placeOnTrack(thrower, track, 100);
    placeOnTrack(target, track, 90, 3); // derrière la balle, à gauche, à moins de 25 m
    thrower.items = ['tennis-ball'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    thrower.kart.position = clone(FAR_AWAY);
    const ball = race.items[0];
    const initialHeading = ball.heading;

    stepItems(race, track, createRng(1), FIXED_DT, emit);
    // Cible à gauche : le cap augmente (tourner à gauche), limité à 5 rad/s.
    expect(wrapAngle(ball.heading - initialHeading)).toBeCloseTo(BALL_TURN_RATE * FIXED_DT, 9);

    stepUntil(race, track, emit, Math.round(3 / FIXED_DT), () => hits(events).length > 0);
    expect(hits(events)).toEqual([{ type: 'hit', racerId: 0, by: 'tennis-ball', ownerId: 1 }]);
  });

  it('loin de sa cible, suit le circuit au décalage latéral de la cible', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [target, thrower] = race.racers;
    placeOnTrack(thrower, track, 100);
    placeOnTrack(target, track, 400, 6);
    thrower.items = ['tennis-ball'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    thrower.kart.position = clone(FAR_AWAY);
    const ball = race.items[0];

    stepUntil(race, track, emit, Math.round(1.5 / FIXED_DT), () => false);
    expect(distance(ball.position, target.kart.position)).toBeGreaterThan(25);
    expect(track.project(ball.position).lateral).toBeCloseTo(6, 0);
    expect(hits(events)).toEqual([]);
  });

  it('lancée vers une haie, glisse le long sans la traverser ni rebondir', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const thrower = race.racers[0];
    placeOnTrack(thrower, track, 100, 7);
    thrower.kart.heading += 1.2; // vers la haie de gauche
    thrower.items = ['tennis-ball'];
    const { emit } = recorder();
    useItem(race, thrower, track, false, emit);
    thrower.kart.position = clone(FAR_AWAY);
    const ball = race.items[0];

    let maxLateral = 0;
    stepUntil(race, track, emit, 60, () => {
      maxLateral = Math.max(maxLateral, Math.abs(track.project(ball.position).lateral));
      return false;
    });
    expect(maxLateral).toBeCloseTo(PROJECTILE_LIMIT(track), 6);
    expect(ball.bounces).toBe(0);
    // Elle a quitté la haie (le recentrage × 0,9 est progressif) et repart vers l'intérieur.
    const projection = track.project(ball.position);
    expect(projection.lateral).toBeLessThan(PROJECTILE_LIMIT(track) - 1);
    expect(dot(forwardOf(ball.heading), projection.sample.left)).toBeLessThan(0);
  });

  it('ne vise pas à travers une haie une cible proche à vol d’oiseau mais loin sur le circuit', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [target, thrower] = race.racers;
    placeOnTrack(thrower, track, 100);
    thrower.items = ['tennis-ball'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    thrower.kart.position = clone(FAR_AWAY);
    const ball = race.items[0];

    // Cible d'un couloir voisin : à 12 m devant la balle et 6 m à sa gauche, mais 300 m plus loin
    // le long du circuit, sur la droite de sa propre route.
    target.kart.position = besideEntity(ball, 12, 6);
    target.kart.trackIndex = track.project(track.sampleAt(400).position).index;
    target.kart.lateral = -6;

    stepUntil(race, track, emit, 30, () => false);
    expect(hits(events)).toEqual([]);
    expect(track.project(ball.position).lateral).toBeLessThan(-2);
  });

  it.each([
    { radius: 60, direction: 'left' as const },
    { radius: 16, direction: 'right' as const },
  ])(
    'sans cible, suit la route sans sortir des haies puis expire (rayon $radius, $direction)',
    ({ radius, direction }) => {
      const track = createCircleTrack(radius, direction);
      const race = createTestRace(track, 1);
      const thrower = race.racers[0];
      placeOnTrack(thrower, track, 0, 5);
      thrower.items = ['tennis-ball'];
      const { events, emit } = recorder();
      useItem(race, thrower, track, false, emit);
      const ball = race.items[0];
      expect(ball.targetId).toBeNull();
      // Le lanceur s'écarte pour que la balle, qui boucle le circuit, ne le retrouve pas.
      thrower.kart.position = { x: 5000, z: 5000 };

      let travelled = 0;
      let lastS = track.project(ball.position).s;
      stepUntil(race, track, emit, Math.round(3 / FIXED_DT), () => {
        const projection = track.project(ball.position);
        expect(Math.abs(projection.lateral)).toBeLessThanOrEqual(PROJECTILE_LIMIT(track) + 1e-6);
        travelled +=
          wrapAngle(((projection.s - lastS) / track.length) * 2 * Math.PI) *
          (track.length / (2 * Math.PI));
        lastS = projection.s;
        return false;
      });
      // L'essentiel de la vitesse sert à avancer le long du circuit, et la balle s'est recentrée.
      expect(travelled).toBeGreaterThan(0.8 * ITEMS.ballSpeed * 3);
      expect(Math.abs(track.project(ball.position).lateral)).toBeLessThan(2);

      stepUntil(
        race,
        track,
        emit,
        Math.round((ITEMS.ballLife - 3 + 0.1) / FIXED_DT),
        () => race.items.length === 0,
      );
      expect(race.items).toEqual([]);
      expect(hits(events)).toEqual([]);
    },
  );
});

describe('flaque de boue', () => {
  it('déposée derrière, fait tourner le pilote qui suit', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [dropper, follower] = race.racers;
    placeOnTrack(dropper, track, 100);
    let followerS = 80;
    placeOnTrack(follower, track, followerS);
    dropper.items = ['mud'];
    dropper.kart.speed = 20;
    const { events, emit } = recorder();

    useItem(race, dropper, track, false, emit);
    const mud = race.items[0];
    expect(mud).toMatchObject({ kind: 'mud', speed: 0, life: ITEMS.mudLife, ownerId: 0 });
    const offset = sub(mud.position, dropper.kart.position);
    expect(dot(offset, forwardOf(dropper.kart.heading))).toBeCloseTo(-(KART_RADIUS + 1.8), 6);

    const start = clone(mud.position);
    stepUntil(
      race,
      track,
      emit,
      120,
      () => hits(events).length > 0,
      () => {
        followerS += 20 * FIXED_DT;
        placeOnTrack(follower, track, followerS);
        expect(distance(mud.position, start)).toBe(0);
      },
    );
    expect(hits(events)).toEqual([{ type: 'hit', racerId: 1, by: 'mud', ownerId: 0 }]);
    expect(follower.kart.spinTime).toBe(ITEMS.spinDuration);
    expect(race.items).toEqual([]);
  });

  it('un os qui touche une flaque détruit les deux', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [thrower, dropper] = race.racers;
    placeOnTrack(dropper, track, 120 + KART_RADIUS + 1.8);
    dropper.items = ['mud'];
    const { events, emit } = recorder();
    useItem(race, dropper, track, false, emit);
    placeOnTrack(dropper, track, 400);

    placeOnTrack(thrower, track, 100);
    thrower.items = ['bone'];
    useItem(race, thrower, track, false, emit);
    expect(race.items).toHaveLength(2);

    const steps = stepUntil(race, track, emit, 60, () => race.items.length === 0);
    expect(steps).toBeLessThan(60);
    expect(hits(events)).toEqual([]);
  });

  it('une balle qui touche une flaque détruit les deux', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const thrower = race.racers[0];
    placeOnTrack(thrower, track, 120 + KART_RADIUS + 1.8);
    thrower.items = ['mud'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    placeOnTrack(thrower, track, 100);
    thrower.items = ['tennis-ball'];
    useItem(race, thrower, track, false, emit);

    const steps = stepUntil(race, track, emit, 60, () => race.items.length === 0);
    expect(steps).toBeLessThan(60);
    expect(hits(events)).toEqual([]);
  });
});

describe('rayons de contact', () => {
  const track = createCircleTrack(STRAIGHT_RADIUS);
  const projectileReach = KART_RADIUS + ITEMS.projectileRadius;
  const mudReach = KART_RADIUS + ITEMS.mudRadius;
  const cancelReach = ITEMS.projectileRadius + ITEMS.mudRadius;

  /** Course à deux pilotes ; le pilote 0 lance `item` depuis s = 100 puis s'éloigne. */
  function launch(item: 'bone' | 'mud'): {
    race: RaceState;
    entity: ItemEntity;
    other: RacerState;
  } {
    const race = createTestRace(track, 2);
    const [owner, other] = race.racers;
    placeOnTrack(owner, track, 100);
    owner.items = [item];
    useItem(race, owner, track, false, () => undefined);
    owner.kart.position = clone(FAR_AWAY);
    return { race, entity: race.items[0], other };
  }

  it.each([
    { offset: projectileReach - 0.05, hit: true },
    { offset: projectileReach + 0.05, hit: false },
  ])(
    'un os touche un kart à moins de KART_RADIUS + projectileRadius de sa trajectoire ($offset m : $hit)',
    ({ offset, hit }) => {
      const { race, entity, other } = launch('bone');
      other.kart.position = besideEntity(entity, 10, offset);
      const { events, emit } = recorder();

      stepUntil(race, track, emit, 30, () => false);
      expect(hits(events)).toHaveLength(hit ? 1 : 0);
    },
  );

  it.each([
    { offset: mudReach - 0.05, hit: true },
    { offset: mudReach + 0.05, hit: false },
  ])(
    'une flaque touche un kart à moins de KART_RADIUS + mudRadius ($offset m : $hit)',
    ({ offset, hit }) => {
      const { race, entity, other } = launch('mud');
      other.kart.position = besideEntity(entity, 0, offset);
      const { events, emit } = recorder();

      stepItems(race, track, createRng(1), FIXED_DT, emit);
      expect(hits(events)).toHaveLength(hit ? 1 : 0);
    },
  );

  it.each([
    { offset: cancelReach - 0.05, cancelled: true },
    { offset: cancelReach + 0.05, cancelled: false },
  ])(
    'un os et une flaque s’annulent à moins de projectileRadius + mudRadius ($offset m : $cancelled)',
    ({ offset, cancelled }) => {
      const { race, entity: bone, other } = launch('bone');
      other.items = ['mud'];
      useItem(race, other, track, false, () => undefined);
      other.kart.position = clone(FAR_AWAY);
      const mud = race.items[1];
      mud.position = besideEntity(bone, 10, offset);
      mud.prevPosition = clone(mud.position);

      stepUntil(
        race,
        track,
        () => undefined,
        30,
        () => false,
      );
      expect(race.items).toHaveLength(cancelled ? 0 : 2);
    },
  );
});

describe('os en or', () => {
  it('chaque appui donne un turbo pendant 7 s, puis l’os disparaît et la réserve avance', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    placeOnTrack(racer, track, 100);
    racer.items = ['golden-bone', 'mud'];
    const { events, emit } = recorder();
    useItem(race, racer, track, false, emit);
    expect(racer.goldenBoneTime).toBe(ITEMS.goldenBoneDuration);
    expect(racer.kart.boostTime).toBe(ITEMS.goldenBoneTurboDuration);
    expect(racer.items).toEqual(['golden-bone', 'mud']);
    racer.kart.boostTime = 0;
    stepUntil(race, track, emit, 60, () => false);
    useItem(race, racer, track, false, emit);
    expect(racer.kart.boostTime).toBe(ITEMS.goldenBoneTurboDuration);
    expect(events.filter((e) => e.type === 'boost')).toHaveLength(2);
    stepUntil(
      race,
      track,
      emit,
      Math.round(ITEMS.goldenBoneDuration / FIXED_DT),
      () => racer.goldenBoneTime === 0,
    );
    expect(racer.items).toEqual(['mud']);
  });

  it('os en or actif et un objet en réserve : pas de troisième objet', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const [racer] = race.racers;
    racer.items = ['golden-bone', 'mud'];
    racer.goldenBoneTime = 5;
    race.itemBoxes = [{ id: 0, position: clone(racer.kart.position), respawn: 0, height: 0 }];
    stepItems(race, track, fixedRng(0), FIXED_DT, () => undefined);
    expect(racer.items).toEqual(['golden-bone', 'mud']);
  });
});

describe('sifflet', () => {
  it('arrête 1 s les pilotes mieux classés, pas les autres', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 4);
    const [first, second, thrower, last] = race.racers;
    [first.rank, second.rank, thrower.rank, last.rank] = [1, 2, 3, 4];
    thrower.items = ['whistle'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    expect(first.kart.stunTime).toBe(ITEMS.whistleStun);
    expect(second.kart.stunTime).toBe(ITEMS.whistleStun);
    expect(last.kart.stunTime).toBe(0);
    expect(thrower.kart.stunTime).toBe(0);
    const stuns = events.filter(
      (e): e is Extract<GameEvent, { type: 'stun' }> => e.type === 'stun',
    );
    expect(stuns.map((e) => e.racerId).sort()).toEqual([first.id, second.id].sort());
  });

  it('utilisé par le premier : personne n’est arrêté, l’objet est consommé', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 3);
    const [leader, ...others] = race.racers;
    leader.rank = 1;
    leader.items = ['whistle'];
    useItem(race, leader, track, false, () => undefined);
    expect(leader.items).toEqual([]);
    for (const other of others) expect(other.kart.stunTime).toBe(0);
  });
});

describe('super-collier', () => {
  it('rend insensible aux os et au sifflet pendant 6 s', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [thrower, victim] = race.racers;
    placeOnTrack(thrower, track, 100);
    placeOnTrack(victim, track, 130);
    victim.items = ['super-collar'];
    useItem(race, victim, track, false, () => undefined);
    expect(victim.kart.collarTime).toBe(ITEMS.collarDuration);
    thrower.items = ['bone'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    stepUntil(race, track, emit, 90, () => false);
    expect(hits(events)).toEqual([]);
    [victim.rank, thrower.rank] = [1, 2];
    thrower.items = ['whistle'];
    useItem(race, thrower, track, false, emit);
    expect(victim.kart.stunTime).toBe(0);
  });
});

describe('écureuil', () => {
  function squirrelRace(count: number) {
    const track = createCircleTrack(300);
    const race = createTestRace(track, count);
    race.racers.forEach((racer, i) => {
      placeOnTrack(racer, track, 400 - i * 60, i % 2 === 0 ? 4 : -4);
      racer.rank = i + 1;
    });
    return { track, race };
  }

  it('fonce sur le premier, quel que soit son couloir, et le fait tourner 1,5 s', () => {
    const { track, race } = squirrelRace(4);
    const [leader, second, , thrower] = race.racers;
    thrower.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    stepUntil(race, track, emit, 600, () => hits(events).length > 0);
    expect(hits(events)).toEqual([
      { type: 'hit', racerId: leader.id, by: 'squirrel', ownerId: thrower.id },
    ]);
    expect(leader.kart.spinTime).toBeCloseTo(ITEMS.squirrelSpin, 1);
    expect(second.kart.spinTime).toBe(0);
    expect(race.items).toHaveLength(0);
  });

  it('lancé par le premier, vise le deuxième', () => {
    const { track, race } = squirrelRace(3);
    const [leader, second] = race.racers;
    leader.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, leader, track, false, emit);
    stepUntil(race, track, emit, 900, () => hits(events).length > 0);
    // Le deuxième est 60 m derrière : l'écureuil fait demi-tour au lieu de refaire un tour.
    expect(hits(events)[0].racerId).toBe(second.id);
  });

  it('le super-collier protège : l’écureuil disparaît sans effet', () => {
    const { track, race } = squirrelRace(3);
    const [leader, , thrower] = race.racers;
    leader.kart.collarTime = 100;
    thrower.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    stepUntil(race, track, emit, 600, () => race.items.length === 0);
    expect(hits(events)).toEqual([]);
    expect(leader.kart.spinTime).toBe(0);
  });

  it('change de cible si le premier franchit l’arrivée, disparaît s’il n’y a plus personne', () => {
    const { track, race } = squirrelRace(3);
    const [leader, second, thrower] = race.racers;
    thrower.items = ['squirrel'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    leader.finished = true;
    stepUntil(race, track, emit, 900, () => hits(events).length > 0);
    expect(hits(events)[0].racerId).toBe(second.id);

    const solo = squirrelRace(2);
    const [finished, owner] = solo.race.racers;
    finished.finished = true;
    owner.items = ['squirrel'];
    useItem(solo.race, owner, solo.track, false, () => undefined);
    stepUntil(
      solo.race,
      solo.track,
      () => undefined,
      30,
      () => false,
    );
    expect(solo.race.items).toHaveLength(0);
  });
});

describe('croquette turbo', () => {
  it('déclenche un boost immédiat sans créer d’entité', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 2);
    const racer = race.racers[1];
    racer.items = ['kibble-turbo'];
    const { events, emit } = recorder();

    useItem(race, racer, track, false, emit);
    expect(racer.kart.boostTime).toBe(ITEMS.turboDuration);
    expect(racer.kart.boostStrength).toBe(ITEMS.turboStrength);
    expect(race.items).toEqual([]);
    expect(events).toEqual([
      { type: 'item-use', racerId: 1, item: 'kibble-turbo' },
      { type: 'boost', racerId: 1, source: 'item' },
    ]);
  });
});

describe('invulnérabilité', () => {
  it('un os traverse un pilote invulnérable, dont l’immunité décroît', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [thrower, victim] = race.racers;
    placeOnTrack(thrower, track, 100);
    placeOnTrack(victim, track, 110);
    victim.hitImmunity = 1.5;
    thrower.items = ['bone'];
    const { events, emit } = recorder();
    useItem(race, thrower, track, false, emit);
    const bone = race.items[0];

    stepUntil(race, track, emit, 30, () => false);
    expect(hits(events)).toEqual([]);
    expect(race.items).toEqual([bone]);
    expect(track.project(bone.position).s).toBeGreaterThan(115);
    expect(victim.hitImmunity).toBeCloseTo(1, 6);
  });

  it('une flaque reste en place sous un pilote invulnérable puis le touche', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 2);
    const [dropper, victim] = race.racers;
    placeOnTrack(dropper, track, 100);
    dropper.items = ['mud'];
    const { events, emit } = recorder();
    useItem(race, dropper, track, false, emit);
    placeOnTrack(dropper, track, 300);
    victim.kart.position = clone(race.items[0].position);
    victim.hitImmunity = 1;

    stepUntil(race, track, emit, 30, () => false);
    expect(hits(events)).toEqual([]);
    expect(race.items).toHaveLength(1);

    const steps = stepUntil(race, track, emit, 60, () => hits(events).length > 0);
    expect((30 + steps) * FIXED_DT).toBeCloseTo(1, 1);
    expect(hits(events)).toEqual([{ type: 'hit', racerId: 1, by: 'mud', ownerId: 0 }]);
    expect(race.items).toEqual([]);
  });
});

describe('durée de vie', () => {
  it('supprime les entités expirées', () => {
    const track = createCircleTrack(STRAIGHT_RADIUS);
    const race = createTestRace(track, 1);
    const racer = race.racers[0];
    placeOnTrack(racer, track, 100);
    racer.items = ['mud'];
    const { emit } = recorder();
    useItem(race, racer, track, false, emit);

    stepUntil(race, track, emit, Math.round((ITEMS.mudLife - 0.1) / FIXED_DT), () => false);
    expect(race.items).toHaveLength(1);
    stepUntil(race, track, emit, Math.round(0.2 / FIXED_DT), () => false);
    expect(race.items).toEqual([]);
  });
});

describe('objets — relief', () => {
  it('boîtes et objets lancés prennent la hauteur de la piste sous eux', () => {
    const track = createCircleTrack(2000, 'left', { height: 4, grade: 0.05 });
    const boxes = createItemBoxes(track);
    for (const box of boxes) {
      const projection = track.project(box.position);
      expect(box.height).toBeCloseTo(track.surfaceAt(projection.s, projection.lateral).height, 3);
    }
  });

  it('un os lancé suit la hauteur de la piste en avançant', () => {
    const track = createCircleTrack(2000, 'left', { height: 4, grade: 0.05 });
    const race = createTestRace(track, 1);
    const [thrower] = race.racers;
    placeOnTrack(thrower, track, 100);
    thrower.items = ['bone'];
    thrower.kart.speed = 20;
    const { emit } = recorder();
    useItem(race, thrower, track, false, emit);
    thrower.kart.position = { ...FAR_AWAY };
    for (let i = 0; i < 60; i++) stepItems(race, track, fixedRng(0.5), FIXED_DT, emit);
    const bone = race.items[0];
    const projection = track.project(bone.position);
    expect(bone.height).toBeCloseTo(track.surfaceAt(projection.s, projection.lateral).height, 3);
    expect(bone.height).toBeGreaterThan(4 + 0.05 * 100);
  });
});
