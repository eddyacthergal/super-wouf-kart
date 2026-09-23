/**
 * Système d'objets : boîtes, roulette, lancers, déplacement des projectiles,
 * pièges et impacts. Simulation 2D pure (aucune dépendance à three.js).
 */
import { ITEMS, KART_RADIUS } from '../core/constants';
import { applyBoost, applySpinOut } from '../core/kart-state';
import type {
  EmitEvent,
  ItemBoxState,
  ItemEntity,
  ItemEntityKind,
  RaceState,
  RacerState,
  Rng,
  TrackProjection,
  TrackQuery,
} from '../core/types';
import {
  addScaled,
  clamp,
  clone,
  distanceSq,
  dot,
  forwardOf,
  headingOf,
  wrapAngle,
  type Vec2,
} from '../core/vec2';
import { rollItem } from './item-rules';

/** Décalages latéraux des 4 boîtes d'une rangée (m, + = gauche). */
export const BOX_LATERAL_OFFSETS: readonly number[] = [-4.5, -1.5, 1.5, 4.5];

/** Distance entre le bord du kart et un projectile lancé (m). */
const THROW_OFFSET = 1.2;
/** Distance entre le bord du kart et une flaque déposée (m). */
const DROP_OFFSET = 1.8;
/** Fraction de la vitesse d'un os lancé en arrière. */
const BONE_BACKWARD_SPEED_FACTOR = 0.6;
/** En deçà de cette distance (m), la balle vise directement sa cible. */
const BALL_LOCK_DISTANCE = 25;
/**
 * Écart d'abscisse (m) au-delà duquel la cible est dans un autre couloir : la spec garantit seulement
 * 27 m entre deux points séparés de plus de 60 m d'abscisse, soit quelques mètres d'une haie à l'autre.
 * La balle ne vise alors pas directement à travers la haie.
 */
const BALL_LOCK_MAX_TRACK_GAP = 60;
/** Anticipation (m) de la balle le long du circuit quand elle ne voit pas sa cible. */
const BALL_LOOKAHEAD = 10;
/** Vitesse de rotation maximale de la balle (rad/s). */
const BALL_TURN_RATE = 5;
/** Sans cible, la balle se recentre doucement vers la ligne médiane. */
const BALL_CENTERING = 0.9;

const ENTITY_LIFE: Readonly<Record<ItemEntityKind, number>> = {
  bone: ITEMS.boneLife,
  'tennis-ball': ITEMS.ballLife,
  mud: ITEMS.mudLife,
};

const entityRadius = (kind: ItemEntityKind): number =>
  kind === 'mud' ? ITEMS.mudRadius : ITEMS.projectileRadius;

// ---------------------------------------------------------------------------
// Boîtes
// ---------------------------------------------------------------------------

export function createItemBoxes(track: TrackQuery): ItemBoxState[] {
  const boxes: ItemBoxState[] = [];
  for (const s of track.itemBoxRows) {
    const sample = track.sampleAt(s);
    for (const offset of BOX_LATERAL_OFFSETS) {
      boxes.push({
        id: boxes.length,
        position: addScaled(sample.position, sample.left, offset),
        respawn: 0,
      });
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Utilisation d'un objet
// ---------------------------------------------------------------------------

export function useItem(
  race: RaceState,
  racer: RacerState,
  track: TrackQuery,
  backwards: boolean,
  emit: EmitEvent,
): void {
  const item = racer.item;
  if (item === null || racer.itemRoulette > 0) return;
  racer.item = null;
  emit({ type: 'item-use', racerId: racer.id, item });

  const kart = racer.kart;
  const forward = forwardOf(kart.heading);
  /** Point à `distance` m devant le kart (négatif : derrière). */
  const ahead = (distance: number): Vec2 => addScaled(kart.position, forward, distance);
  const throwDistance = KART_RADIUS + THROW_OFFSET;

  switch (item) {
    case 'bone': {
      const position = ahead(backwards ? -throwDistance : throwDistance);
      const heading = backwards ? kart.heading + Math.PI : kart.heading;
      const speed = backwards
        ? BONE_BACKWARD_SPEED_FACTOR * ITEMS.boneSpeed
        : ITEMS.boneSpeed + Math.max(0, kart.speed);
      spawnEntity(race, racer, track, 'bone', position, heading, speed, null);
      break;
    }
    case 'tennis-ball': {
      const target = ballTarget(race, racer);
      spawnEntity(
        race,
        racer,
        track,
        'tennis-ball',
        ahead(throwDistance),
        kart.heading,
        ITEMS.ballSpeed,
        target?.id ?? null,
      );
      break;
    }
    case 'mud':
      spawnEntity(
        race,
        racer,
        track,
        'mud',
        ahead(-(KART_RADIUS + DROP_OFFSET)),
        kart.heading,
        0,
        null,
      );
      break;
    case 'kibble-turbo':
      applyBoost(kart, ITEMS.turboDuration, ITEMS.turboStrength);
      emit({ type: 'boost', racerId: racer.id, source: 'item', tier: 0 });
      break;
  }
}

/**
 * Cible de la balle : le pilote encore en course le plus proche devant au classement
 * (rang inférieur le plus grand). Les pilotes arrivés sont ignorés ; null si personne devant.
 */
function ballTarget(race: RaceState, racer: RacerState): RacerState | null {
  let target: RacerState | null = null;
  for (const other of race.racers) {
    if (other.id === racer.id || other.finished || other.rank >= racer.rank) continue;
    if (target === null || other.rank > target.rank) target = other;
  }
  return target;
}

function spawnEntity(
  race: RaceState,
  racer: RacerState,
  track: TrackQuery,
  kind: ItemEntityKind,
  position: Vec2,
  heading: number,
  speed: number,
  targetId: number | null,
): void {
  const projection = track.project(position, racer.kart.trackIndex);
  // Un kart collé à une haie ne doit pas poser un objet dans la haie.
  clampInsideWalls(position, projection, track.wallHalfWidth - entityRadius(kind));
  race.items.push({
    id: race.nextEntityId++,
    kind,
    ownerId: racer.id,
    position,
    prevPosition: clone(position),
    heading: wrapAngle(heading),
    speed,
    life: ENTITY_LIFE[kind],
    bounces: 0,
    targetId,
    trackIndex: projection.index,
    armTime: ITEMS.armTime,
  });
}

// ---------------------------------------------------------------------------
// Pas de simulation
// ---------------------------------------------------------------------------

export function stepItems(
  race: RaceState,
  track: TrackQuery,
  rng: Rng,
  dt: number,
  emit: EmitEvent,
): void {
  updateRacerTimers(race, dt, emit);
  updateBoxes(race, rng, dt, emit);
  moveEntities(race, track, dt);
  collideWithRacers(race, emit);
  collideProjectilesWithMud(race);
  removeDeadEntities(race);
}

function updateRacerTimers(race: RaceState, dt: number, emit: EmitEvent): void {
  for (const racer of race.racers) {
    racer.hitImmunity = Math.max(0, racer.hitImmunity - dt);
    if (racer.itemRoulette > 0) {
      racer.itemRoulette = Math.max(0, racer.itemRoulette - dt);
      if (racer.itemRoulette === 0 && racer.item !== null) {
        emit({ type: 'item-ready', racerId: racer.id, item: racer.item });
      }
    }
  }
}

function updateBoxes(race: RaceState, rng: Rng, dt: number, emit: EmitEvent): void {
  const pickupSq = ITEMS.boxPickupRadius ** 2;
  for (const box of race.itemBoxes) {
    box.respawn = Math.max(0, box.respawn - dt);
    if (box.respawn > 0) continue;
    // La boîte casse au premier contact ; si plusieurs pilotes la touchent dans le même pas,
    // l'objet revient à l'un de ceux qui peuvent le recevoir (et non au premier du tableau).
    let touched = false;
    let receiver: RacerState | null = null;
    for (const racer of race.racers) {
      if (distanceSq(box.position, racer.kart.position) >= pickupSq) continue;
      touched = true;
      if (racer.item === null && racer.itemRoulette <= 0) {
        receiver = racer;
        break;
      }
    }
    if (!touched) continue;
    box.respawn = ITEMS.boxRespawn;
    if (receiver !== null) {
      receiver.item = rollItem(receiver.rank, race.racers.length, rng);
      receiver.itemRoulette = ITEMS.rouletteDuration;
      emit({ type: 'item-box', racerId: receiver.id });
    }
  }
}

function moveEntities(race: RaceState, track: TrackQuery, dt: number): void {
  for (const entity of race.items) {
    entity.prevPosition.x = entity.position.x;
    entity.prevPosition.z = entity.position.z;
    entity.life -= dt;
    entity.armTime = Math.max(0, entity.armTime - dt);
    if (entity.kind === 'bone') moveBone(entity, track, dt);
    else if (entity.kind === 'tennis-ball') moveBall(entity, race, track, dt);
  }
}

/** Os : ligne droite, rebonds sur les haies, détruit au-delà du nombre de rebonds autorisé. */
function moveBone(entity: ItemEntity, track: TrackQuery, dt: number): void {
  advance(entity, dt);
  const projection = track.project(entity.position, entity.trackIndex);
  entity.trackIndex = projection.index;
  const side = clampInsideWalls(
    entity.position,
    projection,
    track.wallHalfWidth - ITEMS.projectileRadius,
  );
  if (side === 0) return;

  // Normale sortante de la haie touchée ; on ne réfléchit que si l'os s'en approche.
  const left = projection.sample.left;
  const normal = { x: left.x * side, z: left.z * side };
  const velocity = forwardOf(entity.heading);
  const outward = dot(velocity, normal);
  if (outward <= 0) return;
  entity.bounces++;
  if (entity.bounces > ITEMS.boneMaxBounces) {
    entity.life = 0;
    return;
  }
  entity.heading = headingOf(addScaled(velocity, normal, -2 * outward));
}

/** Balle : vise sa cible quand elle est proche, sinon suit le circuit ; glisse le long des haies. */
function moveBall(entity: ItemEntity, race: RaceState, track: TrackQuery, dt: number): void {
  const here = track.project(entity.position, entity.trackIndex);
  const target = resolveTarget(entity, race);

  let aim: Vec2;
  if (
    target !== null &&
    distanceSq(target.kart.position, entity.position) < BALL_LOCK_DISTANCE ** 2 &&
    trackGap(track, here.s, target.kart.trackIndex) < BALL_LOCK_MAX_TRACK_GAP
  ) {
    aim = target.kart.position;
  } else {
    const ahead = track.sampleAt(here.s + BALL_LOOKAHEAD);
    const lateral = target !== null ? target.kart.lateral : here.lateral * BALL_CENTERING;
    // Viser un point en avant coupe les virages d'environ L·Δψ/2 (Δψ : rotation de la tangente
    // sur l'anticipation L) : on décale la visée d'autant vers l'extérieur pour rester sur la ligne voulue.
    const turn = wrapAngle(headingOf(ahead.tangent) - headingOf(here.sample.tangent));
    aim = addScaled(ahead.position, ahead.left, lateral - (BALL_LOOKAHEAD * turn) / 2);
  }

  const desired = headingOf({ x: aim.x - entity.position.x, z: aim.z - entity.position.z });
  const maxTurn = BALL_TURN_RATE * dt;
  entity.heading = wrapAngle(
    entity.heading + clamp(wrapAngle(desired - entity.heading), -maxTurn, maxTurn),
  );

  advance(entity, dt);
  const projection = track.project(entity.position, here.index);
  entity.trackIndex = projection.index;
  clampInsideWalls(entity.position, projection, track.wallHalfWidth - ITEMS.projectileRadius);
}

/**
 * Écart d'abscisse (m, bouclé) entre `s` et l'échantillon `index` (celui du kart visé, tenu à jour par stepKart).
 * Un indice invalide donne 0 : on s'en remet alors à la seule distance.
 */
function trackGap(track: TrackQuery, s: number, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= track.samples.length) return 0;
  const half = track.length / 2;
  const delta = track.samples[index].s - s;
  return Math.abs(((((delta + half) % track.length) + track.length) % track.length) - half);
}

/** Cible encore valide de la balle ; une cible disparue ou arrivée est abandonnée. */
function resolveTarget(entity: ItemEntity, race: RaceState): RacerState | null {
  if (entity.targetId === null) return null;
  for (const racer of race.racers) {
    if (racer.id === entity.targetId && !racer.finished) return racer;
  }
  entity.targetId = null;
  return null;
}

function collideWithRacers(race: RaceState, emit: EmitEvent): void {
  for (const entity of race.items) {
    if (entity.life <= 0) continue;
    const hitRadiusSq = (KART_RADIUS + entityRadius(entity.kind)) ** 2;
    for (const racer of race.racers) {
      if (racer.id === entity.ownerId && entity.armTime > 0) continue;
      // Pilote invulnérable : les projectiles le traversent, la flaque reste en place.
      if (racer.hitImmunity > 0) continue;
      if (sweptDistanceSq(racer.kart.position, entity) >= hitRadiusSq) continue;
      applySpinOut(racer.kart);
      racer.hitImmunity = ITEMS.hitImmunity;
      emit({ type: 'hit', racerId: racer.id, by: entity.kind, ownerId: entity.ownerId });
      entity.life = 0;
      break;
    }
  }
}

function collideProjectilesWithMud(race: RaceState): void {
  const contactSq = (ITEMS.projectileRadius + ITEMS.mudRadius) ** 2;
  for (const projectile of race.items) {
    if (projectile.kind === 'mud' || projectile.life <= 0) continue;
    for (const mud of race.items) {
      if (mud.kind !== 'mud' || mud.life <= 0) continue;
      if (sweptDistanceSq(mud.position, projectile) >= contactSq) continue;
      projectile.life = 0;
      mud.life = 0;
      break;
    }
  }
}

/** Retire en place les entités détruites ou expirées (life ≤ 0). */
function removeDeadEntities(race: RaceState): void {
  let kept = 0;
  for (const entity of race.items) {
    if (entity.life > 0) race.items[kept++] = entity;
  }
  race.items.length = kept;
}

// ---------------------------------------------------------------------------
// Outils géométriques
// ---------------------------------------------------------------------------

function advance(entity: ItemEntity, dt: number): void {
  const step = entity.speed * dt;
  entity.position.x += Math.sin(entity.heading) * step;
  entity.position.z += Math.cos(entity.heading) * step;
}

/**
 * Ramène `position` (modifiée en place) à au plus `limit` de la ligne médiane.
 * Renvoie le côté corrigé (+1 = haie de gauche, -1 = haie de droite) ou 0 si rien à faire.
 */
function clampInsideWalls(position: Vec2, projection: TrackProjection, limit: number): -1 | 0 | 1 {
  const overshoot = Math.abs(projection.lateral) - limit;
  if (overshoot <= 0) return 0;
  const side = projection.lateral > 0 ? 1 : -1;
  const left = projection.sample.left;
  position.x -= left.x * side * overshoot;
  position.z -= left.z * side * overshoot;
  return side;
}

/**
 * Carré de la distance entre un point et le trajet de l'entité pendant le pas
 * (segment prevPosition → position), pour qu'un projectile rapide ne traverse pas un kart.
 */
function sweptDistanceSq(point: Vec2, entity: ItemEntity): number {
  const a = entity.prevPosition;
  const b = entity.position;
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t =
    lengthSq > 1e-12 ? clamp(((point.x - a.x) * abx + (point.z - a.z) * abz) / lengthSq, 0, 1) : 0;
  const dx = a.x + abx * t - point.x;
  const dz = a.z + abz * t - point.z;
  return dx * dx + dz * dz;
}
