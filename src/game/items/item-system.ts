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
  ItemKind,
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
/** Rapprochement latéral de l'écureuil vers sa cible sur ses derniers mètres (1/s) et distance (m). */
const SQUIRREL_HOMING_RATE = 6;
const SQUIRREL_HOMING_DISTANCE = 20;

const ENTITY_LIFE: Readonly<Record<ItemEntityKind, number>> = {
  bone: ITEMS.boneLife,
  'tennis-ball': ITEMS.ballLife,
  mud: ITEMS.mudLife,
  squirrel: ITEMS.squirrelLife,
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
        height: track.surfaceAt(s, offset).height,
      });
    }
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Utilisation d'un objet
// ---------------------------------------------------------------------------

/** Objet utilisable maintenant : le premier de la file, sauf s'il est seul et encore en roulette. */
export function usableItem(racer: RacerState): ItemKind | null {
  const first = racer.items[0];
  if (first === undefined) return null;
  if (racer.itemRoulette > 0 && racer.items.length === 1) return null;
  return first;
}

export function useItem(
  race: RaceState,
  racer: RacerState,
  track: TrackQuery,
  backwards: boolean,
  emit: EmitEvent,
): void {
  const item = usableItem(racer);
  if (item === null) return;
  // L'os en or reste dans la case pendant sa durée : chaque appui redonne un turbo.
  if (item === 'golden-bone') {
    if (racer.goldenBoneTime <= 0) racer.goldenBoneTime = ITEMS.goldenBoneDuration;
    emit({ type: 'item-use', racerId: racer.id, item });
    applyBoost(racer.kart, ITEMS.goldenBoneTurboDuration, ITEMS.goldenBoneTurboStrength);
    emit({ type: 'boost', racerId: racer.id, source: 'item' });
    return;
  }
  racer.items.shift();
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
      emit({ type: 'boost', racerId: racer.id, source: 'item' });
      break;
    case 'whistle':
      // Tous les pilotes mieux classés s'arrêtent net pour écouter (sauf sous super-collier).
      for (const other of race.racers) {
        if (
          other.id === racer.id ||
          other.finished ||
          other.rank >= racer.rank ||
          other.kart.collarTime > 0
        )
          continue;
        other.kart.stunTime = ITEMS.whistleStun;
        emit({ type: 'stun', racerId: other.id, ownerId: racer.id });
      }
      break;
    case 'super-collar':
      racer.kart.collarTime = ITEMS.collarDuration;
      break;
    case 'squirrel': {
      const target = squirrelTarget(race, racer.id);
      spawnEntity(
        race,
        racer,
        track,
        'squirrel',
        ahead(throwDistance),
        kart.heading,
        ITEMS.squirrelSpeed,
        target?.id ?? null,
      );
      break;
    }
  }
}

/**
 * Vrai s'il existe un pilote mieux classé que `racer`, encore en course et non protégé par le
 * super-collier : seule cible réelle du sifflet et de la balle. Un pilote mieux classé mais
 * arrivé, comme un rival sous super-collier, ne justifie pas l'usage de l'objet.
 */
export function hasRivalAhead(race: RaceState, racer: RacerState): boolean {
  return race.racers.some(
    (other) =>
      other.id !== racer.id &&
      !other.finished &&
      other.rank < racer.rank &&
      other.kart.collarTime <= 0,
  );
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

/**
 * Cible de l'écureuil : le pilote encore en course le mieux classé parmi ceux mieux classés que
 * le lanceur. Si le lanceur est déjà en tête (aucun pilote, arrivé ou non, n'est mieux classé),
 * viser le meilleur autre pilote encore en course, pour une défense. Sinon — les seuls pilotes
 * mieux classés que le lanceur sont arrivés — aucune cible réelle : ne pas viser un pilote qui,
 * lui, est derrière le lanceur.
 */
export function squirrelTarget(race: RaceState, ownerId: number): RacerState | null {
  const owner = race.racers.find((racer) => racer.id === ownerId);
  if (owner === undefined) return null;
  let rival: RacerState | null = null;
  for (const other of race.racers) {
    if (other.id === ownerId || other.finished) continue;
    if (rival === null || other.rank < rival.rank) rival = other;
  }
  if (rival === null) return null;
  if (rival.rank < owner.rank) return rival;
  return owner.rank === 1 ? rival : null;
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
  const height = track.surfaceAt(projection.s, projection.lateral).height;
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
    height,
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
  collideSquirrels(race, track, emit);
  collideWithRacers(race, emit);
  collideProjectilesWithMud(race);
  removeDeadEntities(race);
}

function updateRacerTimers(race: RaceState, dt: number, emit: EmitEvent): void {
  for (const racer of race.racers) {
    racer.hitImmunity = Math.max(0, racer.hitImmunity - dt);
    if (racer.itemRoulette > 0) {
      racer.itemRoulette = Math.max(0, racer.itemRoulette - dt);
      const last = racer.items.at(-1);
      if (racer.itemRoulette === 0 && last !== undefined) {
        emit({ type: 'item-ready', racerId: racer.id, item: last });
      }
    }
    if (racer.goldenBoneTime > 0) {
      racer.goldenBoneTime = Math.max(0, racer.goldenBoneTime - dt);
      if (racer.goldenBoneTime === 0 && racer.items[0] === 'golden-bone') racer.items.shift();
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
      if (racer.items.length < ITEMS.maxHeld && racer.itemRoulette <= 0) {
        receiver = racer;
        break;
      }
    }
    if (!touched) continue;
    box.respawn = ITEMS.boxRespawn;
    if (receiver !== null) {
      receiver.items.push(rollItem(receiver.rank, race.racers.length, rng));
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
    else if (entity.kind === 'squirrel') moveSquirrel(entity, race, track, dt);
  }
}

/** Os : ligne droite, rebonds sur les haies, détruit au-delà du nombre de rebonds autorisé. */
function moveBone(entity: ItemEntity, track: TrackQuery, dt: number): void {
  advance(entity, dt);
  const projection = track.project(entity.position, entity.trackIndex);
  entity.trackIndex = projection.index;
  entity.height = track.surfaceAt(projection.s, projection.lateral).height;
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
  entity.height = track.surfaceAt(projection.s, projection.lateral).height;
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

/** Distance (m) le long du circuit, vers l'avant, de l'abscisse s jusqu'à l'échantillon `index`. */
function aheadGap(track: TrackQuery, s: number, index: number): number {
  const delta = track.samples[index].s - s;
  return ((delta % track.length) + track.length) % track.length;
}

/**
 * L'écureuil suit la ligne médiane par son abscisse, par le plus court chemin (vers l'avant ou vers
 * l'arrière), sans rebond ni haie, et rejoint le couloir de sa cible sur ses derniers mètres.
 */
function moveSquirrel(entity: ItemEntity, race: RaceState, track: TrackQuery, dt: number): void {
  const target = squirrelTarget(race, entity.ownerId);
  entity.targetId = target?.id ?? null;
  if (target === null) {
    entity.life = 0;
    return;
  }
  const here = track.project(entity.position, entity.trackIndex);
  const forward = aheadGap(track, here.s, target.kart.trackIndex);
  const direction = forward <= track.length / 2 ? 1 : -1;
  const remaining = Math.min(forward, track.length - forward);
  const s = here.s + direction * ITEMS.squirrelSpeed * dt;
  const near = remaining < SQUIRREL_HOMING_DISTANCE;
  const aim = near ? target.kart.lateral : 0;
  // Près du but, le latéral rejoint celui de la cible au plus tard quand l'abscisse l'atteint :
  // sans cette accélération, une cible qui arrive de face peut être croisée avec un fort écart
  // latéral encore présent.
  const homingFraction = near
    ? Math.min(
        1,
        Math.max(SQUIRREL_HOMING_RATE * dt, (ITEMS.squirrelSpeed * dt) / Math.max(remaining, 1e-6)),
      )
    : Math.min(1, dt);
  const lateral = here.lateral + (aim - here.lateral) * homingFraction;
  const sample = track.sampleAt(s);
  entity.position = addScaled(sample.position, sample.left, lateral);
  entity.heading = headingOf(sample.tangent) + (direction < 0 ? Math.PI : 0);
  entity.trackIndex = track.project(entity.position, here.index).index;
  entity.height = track.surfaceAt(s, lateral).height;
}

/**
 * L'écureuil attrape sa cible quand leurs abscisses et leurs couloirs se rejoignent (le
 * super-collier protège) ; sinon il continue (il fera demi-tour de lui-même au besoin).
 */
function collideSquirrels(race: RaceState, track: TrackQuery, emit: EmitEvent): void {
  for (const entity of race.items) {
    if (entity.kind !== 'squirrel' || entity.life <= 0 || entity.targetId === null) continue;
    const target = race.racers.find((racer) => racer.id === entity.targetId);
    if (!target) continue;
    const here = track.project(entity.position, entity.trackIndex);
    const gap = aheadGap(track, here.s, target.kart.trackIndex);
    if (gap > ITEMS.squirrelCatch && gap < track.length - ITEMS.squirrelCatch) continue;
    if (Math.abs(here.lateral - target.kart.lateral) > ITEMS.squirrelCatchLateral) continue;
    entity.life = 0;
    if (target.kart.collarTime > 0) continue;
    applySpinOut(target.kart);
    target.kart.spinTime = ITEMS.squirrelSpin;
    target.hitImmunity = ITEMS.hitImmunity;
    emit({ type: 'hit', racerId: target.id, by: 'squirrel', ownerId: entity.ownerId });
  }
}

function collideWithRacers(race: RaceState, emit: EmitEvent): void {
  for (const entity of race.items) {
    if (entity.life <= 0 || entity.kind === 'squirrel') continue;
    const hitRadiusSq = (KART_RADIUS + entityRadius(entity.kind)) ** 2;
    for (const racer of race.racers) {
      if (racer.id === entity.ownerId && entity.armTime > 0) continue;
      // Pilote invulnérable (ou sous super-collier) : les projectiles le traversent, la flaque reste en place.
      if (racer.hitImmunity > 0 || racer.kart.collarTime > 0) continue;
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
    if (projectile.kind === 'mud' || projectile.kind === 'squirrel' || projectile.life <= 0)
      continue;
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
