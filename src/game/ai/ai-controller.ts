/**
 * Pilote IA. À chaque pas : projection sur le circuit, point visé en avant (poursuite pure),
 * vitesse limitée avant les virages serrés, dérapage dans les longs virages, évitement du kart
 * de devant, sortie de blocage, demi-tour à contre-sens et usage des objets.
 *
 * Conventions : steer +1 = droite (le cap diminue) ; lateral > 0 et courbure > 0 = gauche.
 */
import { DRIFT, PHYSICS } from '../core/constants';
import type { Rng } from '../core/rng';
import {
  NEUTRAL_INPUT,
  type DriverContext,
  type DriverController,
  type DriverInput,
  type ItemKind,
  type KartState,
  type RaceState,
  type RacerState,
  type TrackProjection,
  type TrackQuery,
} from '../core/types';
import { approach, clamp, wrapAngle, type Vec2 } from '../core/vec2';
import type { AiPersonality } from './personality';

// Point visé : s + TARGET_BASE_DISTANCE + vitesse × TARGET_SPEED_FACTOR.
const TARGET_BASE_DISTANCE = 10;
const TARGET_SPEED_FACTOR = 0.55;
/** Fenêtre (m) de la courbure moyenne qui décide de l'intérieur du prochain virage. */
const INSIDE_WINDOW = 30;
/** Décalage vers l'intérieur par unité de courbure (m²), et son maximum (m). */
const INSIDE_GAIN = 120;
const INSIDE_MAX = 4;
/** Décalage maximal vers l'intérieur quand l'IA compte déraper : le dérapage tourne fort, il lui faut de la marge. */
const DRIFT_INSIDE_MAX = 1.5;
/** Marge (m) entre le couloir visé et le bord de la route. */
const LANE_EDGE_MARGIN = 2;
/** Marge (m) côté intérieur du virage : la poursuite coupe l'entrée des virages d'un à deux mètres. */
const LANE_INSIDE_MARGIN = 3;
/** Vitesse (m/s) à laquelle le couloir visé se déplace (évite les à-coups). */
const LANE_SHIFT_RATE = 6;

const AVOID_DISTANCE = 9;
const AVOID_HALF_ANGLE = 0.5;
const AVOID_SHIFT = 3;

/** Vitesse de virage admissible ≈ √(CORNER_GRIP / |κ|) × skill. */
const CORNER_GRIP = 26;
const CURVATURE_EPSILON = 1e-4;
/** Fenêtre (m) d'anticipation des virages : BRAKE_WINDOW_BASE + vitesse × BRAKE_WINDOW_SPEED_FACTOR. */
const BRAKE_WINDOW_BASE = 15;
const BRAKE_WINDOW_SPEED_FACTOR = 1.2;
/** Au-dessus de l'admissible on lâche les gaz ; au-delà de cette marge (m/s) on freine. */
const BRAKE_MARGIN = 2;

const DRIFT_WINDOW = 25;
const DRIFT_ENTER_CURVATURE = 1 / 45;
const DRIFT_EXIT_CURVATURE = 1 / 70;
/** Fenêtres (m) de sortie : virage qui se termine (palier visé atteint) / virage terminé. */
const DRIFT_EXIT_WINDOW = 20;
const DRIFT_END_WINDOW = 8;
/**
 * Virage « long » : il doit rester assez de virage pour charger le palier 1, sinon le dérapage ne
 * rapporte aucun boost. Le saut peut retarder la charge et la poursuite voit la sortie environ une
 * demi-anticipation plus tôt, d'où la longueur requise :
 * vitesse × (premier seuil + durée du saut) + DRIFT_EXIT_LOOKAHEAD_SHARE × anticipation.
 */
const DRIFT_EXIT_LOOKAHEAD_SHARE = 0.5;
/** Longueur maximale (m) de virage examinée. */
const DRIFT_MAX_CURVE_SCAN = 80;
const DRIFT_SPEED_MARGIN = 2;
/**
 * Rotation de référence (fraction du turnRate) sur laquelle l'IA règle ses dérapages : elle ne dérape
 * que dans les virages serrés, même si la physique permet de déraper plus large (DRIFT.steerMin).
 */
const DRIFT_PLAN_TURN = 0.45;
/**
 * Le virage (et la poursuite) doivent demander au moins cette fraction de la rotation de référence,
 * sinon le kart tournerait trop et quitterait sa ligne.
 */
const DRIFT_FEASIBILITY = 0.9;
/** En dessous de cette fraction de la rotation de référence, le dérapage tournerait bien trop : on relâche. */
const DRIFT_OVERTURN = 0.5;
const DRIFT_START_STEER = 0.25;
/**
 * Écart (m) au couloir visé toléré pour commencer un dérapage, puis pour le poursuivre. La poursuite
 * coupe naturellement l'entrée des virages d'un à deux mètres.
 */
const DRIFT_START_LANE_ERROR = 2.5;
const DRIFT_MAX_LANE_ERROR = 3.5;
/**
 * Au-delà de cette erreur de cap (rad), la trajectoire est perdue : on relâche. En virage, la cible
 * est naturellement vue de biais (≈ demi-angle de l'arc), d'où une borne large.
 */
const DRIFT_MAX_ERROR = 0.9;
/** Distance minimale (m) au bord de la route pendant un dérapage. */
const DRIFT_EDGE_MARGIN = 1;
/** Délai laissé au saut avant que le dérapage ne s'active. */
const DRIFT_START_GRACE = DRIFT.hopDuration + 0.15;
const DRIFT_COOLDOWN = 0.6;

const STUCK_SPEED = 2;
const STUCK_DELAY = 1.5;
const REVERSE_DURATION = 1;

/** dot(avant, tangente) sous lequel on est à contre-sens, et au-dessus duquel le demi-tour est fini. */
const WRONG_WAY_ALIGNMENT = -0.3;
const U_TURN_EXIT_ALIGNMENT = 0.5;
/** Presque à l'envers (rad) : on tourne vers le milieu de la route plutôt que par le plus court. */
const U_TURN_AMBIGUOUS_ERROR = 2.8;
/** Vitesse (m/s) tenue pendant un demi-tour, pour un rayon de braquage court. */
const U_TURN_MIN_SPEED = 7;
const U_TURN_MAX_SPEED = 9;

const TURBO_MAX_CURVATURE = 1 / 80;
const BONE_RANGE = 25;
const BONE_HALF_ANGLE = 0.25;
const MUD_RANGE = 15;
/** Délais aléatoires (s) avant d'utiliser l'objet faute d'occasion. */
const ITEM_DELAY = {
  bone: { min: 4, max: 8 },
  ball: { min: 0.5, max: 2 },
  mud: { min: 3, max: 10 },
} as const;
/** Réduction maximale du délai de l'os pour une IA agressive. */
const BONE_AGGRESSION_SHORTENING = 0.5;
/** Nouvel essai si l'objet n'a pas été consommé (garantit un front montant). */
const ITEM_RETRY_DELAY = 0.5;

type DriftPhase = 'idle' | 'starting' | 'drifting';

export class AiController implements DriverController {
  /** Couloir visé lissé (m, + = gauche). */
  private lane: number;
  private stuckTime = 0;
  private reverseTime = 0;
  private reverseSteer = 0;
  /** Braquage verrouillé pendant un demi-tour ; 0 = pas de demi-tour. */
  private uTurnSteer = 0;
  private inDriftCurve = false;
  private driftWanted = false;
  private driftPhase: DriftPhase = 'idle';
  /** Côté du braquage vers l'intérieur du virage en cours de dérapage (-1 gauche, +1 droite). */
  private driftSide = 0;
  private driftTimer = 0;
  private driftCooldown = 0;
  private trackedItem: ItemKind | null = null;
  private itemTime = 0;
  private itemDelay = 0;
  private itemRetry = 0;

  constructor(
    readonly racerId: number,
    private readonly personality: AiPersonality,
    private readonly rng: Rng,
  ) {
    this.lane = personality.laneOffset;
  }

  update({ racer, race, track, dt }: DriverContext): DriverInput {
    if (race.phase === 'countdown') {
      this.resetManeuvers();
      return { ...NEUTRAL_INPUT };
    }
    const kart = racer.kart;
    const speed = kart.speed;
    const projection = track.project(kart.position, kart.trackIndex);
    const { headingError, pursuit } = this.aim(racer, race, track, projection, dt);
    const brakeWindow = BRAKE_WINDOW_BASE + Math.max(0, speed) * BRAKE_WINDOW_SPEED_FACTOR;
    const cornerCurvature = maxAbsCurvature(track, projection.index, brakeWindow);
    this.driftCooldown = Math.max(0, this.driftCooldown - dt);

    let input: DriverInput;
    let busy = true;
    if (kart.spinTime > 0) {
      // Tête-à-queue : aucun contrôle possible, les manœuvres en cours sont abandonnées.
      this.resetManeuvers();
      input = { ...NEUTRAL_INPUT };
    } else if (this.updateStuck(speed, headingError, dt)) {
      input = { throttle: false, brake: true, steer: this.reverseSteer, drift: false, useItem: false };
    } else if (this.updateWrongWay(kart, projection, headingError)) {
      input = {
        throttle: speed < U_TURN_MIN_SPEED,
        brake: speed > U_TURN_MAX_SPEED,
        steer: this.uTurnSteer,
        drift: false,
        useItem: false,
      };
    } else {
      busy = false;
      const cornerSpeed = Math.sqrt(CORNER_GRIP / Math.max(cornerCurvature, CURVATURE_EPSILON)) * this.personality.skill;
      let steer = Math.abs(headingError) > Math.PI / 2 ? -Math.sign(headingError) : clamp(pursuit, -1, 1);
      // En marche arrière, le braquage agit à l'envers sur le cap.
      if (speed < 0) steer = -steer;
      const drift = this.updateDrift(racer, track, projection, cornerCurvature, headingError, pursuit, dt);
      input = {
        throttle: speed <= cornerSpeed,
        brake: speed > cornerSpeed + BRAKE_MARGIN,
        steer: drift ? this.driftSteer(kart, pursuit, steer) : steer,
        drift,
        useItem: false,
      };
    }
    input.useItem = this.updateItems(racer, race, cornerCurvature, busy, dt);
    // Frein maintenu = os lancé vers l'arrière (spec §4) : on relâche le frein le temps du lancer.
    if (input.useItem && racer.item === 'bone') input.brake = false;
    return input;
  }

  /**
   * Point visé : couloir personnel + intérieur du prochain virage, décalé si un kart gêne.
   * Renvoie l'erreur de cap (+ = cible à gauche) et la consigne de poursuite pure : l'arc tangent
   * au cap qui passe par la cible (courbure 2 sin(err) / d), en fraction du taux de rotation
   * (+ = droite, non bornée). Contrairement à un gain fixe sur l'erreur (qui coupe les virages
   * serrés jusqu'à sortir de la route), elle suit exactement un arc en régime établi.
   */
  private aim(
    racer: RacerState,
    race: RaceState,
    track: TrackQuery,
    projection: TrackProjection,
    dt: number,
  ): { headingError: number; pursuit: number } {
    const kart = racer.kart;
    const insideBias = meanCurvature(track, projection.index, INSIDE_WINDOW) * INSIDE_GAIN;
    const insideMax = this.driftWanted || this.driftPhase !== 'idle' ? DRIFT_INSIDE_MAX : INSIDE_MAX;
    let lane = this.personality.laneOffset + clamp(insideBias, -insideMax, insideMax);
    const blocker = nearestRacerAhead(race, racer, AVOID_DISTANCE, AVOID_HALF_ANGLE);
    if (blocker !== null) lane += bearingTo(kart, blocker.kart.position) > 0 ? -AVOID_SHIFT : AVOID_SHIFT;

    const target = track.sampleAt(projection.s + lookAhead(kart.speed));
    const edge = Math.max(0, target.halfWidth - LANE_EDGE_MARGIN);
    const insideEdge = Math.max(0, target.halfWidth - LANE_INSIDE_MARGIN);
    const upper = insideBias > 0 ? insideEdge : edge;
    const lower = insideBias < 0 ? -insideEdge : -edge;
    this.lane = approach(this.lane, clamp(lane, lower, upper), LANE_SHIFT_RATE * dt);

    const dx = target.position.x + target.left.x * this.lane - kart.position.x;
    const dz = target.position.z + target.left.z * this.lane - kart.position.z;
    const headingError = wrapAngle(Math.atan2(dx, dz) - kart.heading);
    const turnSpeed = Math.max(Math.abs(kart.speed), PHYSICS.minTurnSpeed);
    const pursuit = (-2 * Math.sin(headingError) * turnSpeed) / (Math.max(1, Math.hypot(dx, dz)) * racer.tuning.turnRate);
    return { headingError, pursuit };
  }

  /** Blocage (vitesse faible trop longtemps) : marche arrière braquage inversé. Vrai pendant la manœuvre. */
  private updateStuck(speed: number, headingError: number, dt: number): boolean {
    if (this.reverseTime > 0) {
      this.reverseTime -= dt;
      return true;
    }
    this.stuckTime = speed < STUCK_SPEED ? this.stuckTime + dt : 0;
    if (this.stuckTime <= STUCK_DELAY) return false;
    this.stuckTime = 0;
    this.reverseTime = REVERSE_DURATION;
    // En reculant, braquer à l'opposé fait pivoter le nez vers la cible.
    this.reverseSteer = headingError >= 0 ? 1 : -1;
    this.uTurnSteer = 0;
    this.resetDrift();
    return true;
  }

  /** Contre-sens : braquage fort verrouillé jusqu'à ce que le kart soit revenu dans le bon sens. */
  private updateWrongWay(kart: KartState, projection: TrackProjection, headingError: number): boolean {
    const tangent = projection.sample.tangent;
    const alignment = Math.sin(kart.heading) * tangent.x + Math.cos(kart.heading) * tangent.z;
    if (this.uTurnSteer === 0) {
      if (alignment >= WRONG_WAY_ALIGNMENT) return false;
      if (Math.abs(headingError) > U_TURN_AMBIGUOUS_ERROR) {
        // Dos à la course : la gauche du pilote est la droite de la route, on tourne vers le milieu.
        this.uTurnSteer = projection.lateral > 0 ? -1 : 1;
      } else {
        this.uTurnSteer = headingError > 0 ? -1 : 1;
      }
      this.resetDrift();
      return true;
    }
    if (alignment > U_TURN_EXIT_ALIGNMENT) {
      this.uTurnSteer = 0;
      return false;
    }
    return true;
  }

  /** Dérapage dans les longs virages serrés ; renvoie l'état de la touche. La trajectoire reste prioritaire. */
  private updateDrift(
    racer: RacerState,
    track: TrackQuery,
    projection: TrackProjection,
    cornerCurvature: number,
    headingError: number,
    pursuit: number,
    dt: number,
  ): boolean {
    // Un seul tirage par virage serré, dès qu'il entre dans la fenêtre d'anticipation : le couloir
    // visé a ainsi le temps de s'écarter de l'intérieur avant le dérapage.
    if (!this.inDriftCurve && cornerCurvature > DRIFT_ENTER_CURVATURE) {
      this.inDriftCurve = true;
      this.driftWanted = this.rng.next() < this.personality.driftSkill;
    } else if (this.inDriftCurve && cornerCurvature < DRIFT_EXIT_CURVATURE) {
      this.inDriftCurve = false;
      this.driftWanted = false;
    }
    const kart = racer.kart;
    const curvature = meanCurvature(track, projection.index, DRIFT_WINDOW);
    const minDriftTurn = DRIFT_PLAN_TURN * DRIFT_FEASIBILITY;
    const edgeLimit = projection.sample.halfWidth - DRIFT_EDGE_MARGIN;
    const laneError = Math.abs(projection.lateral - this.lane);

    if (this.driftPhase === 'idle') {
      const side = curvature > 0 ? -1 : 1;
      const requiredCurve =
        kart.speed * (DRIFT.tierThresholds[0] + DRIFT.hopDuration) + DRIFT_EXIT_LOOKAHEAD_SHARE * lookAhead(kart.speed);
      const start =
        this.driftWanted &&
        Math.abs(curvature) > DRIFT_ENTER_CURVATURE &&
        this.driftCooldown <= 0 &&
        kart.speed > DRIFT.minSpeed + DRIFT_SPEED_MARGIN &&
        (kart.speed * Math.abs(curvature)) / racer.tuning.turnRate >= minDriftTurn &&
        pursuit * side >= minDriftTurn &&
        kart.steer * side > DRIFT_START_STEER &&
        laneError < DRIFT_START_LANE_ERROR &&
        Math.abs(projection.lateral) < edgeLimit &&
        curveLengthAhead(track, projection.index, -side, DRIFT_EXIT_CURVATURE, DRIFT_MAX_CURVE_SCAN) >= requiredCurve;
      if (!start) return false;
      this.driftPhase = 'starting';
      this.driftSide = side;
      this.driftTimer = 0;
      this.driftWanted = false;
      return true;
    }

    if (this.driftPhase === 'starting') {
      this.driftTimer += dt;
      if (!kart.drift.active) {
        if (this.driftTimer <= DRIFT_START_GRACE) return true;
        this.resetDrift();
        return false;
      }
      this.driftPhase = 'drifting';
    }

    if (!kart.drift.active) {
      // Dérapage annulé par la physique (vitesse trop basse, impact).
      this.resetDrift();
      return false;
    }
    const side = kart.drift.direction !== 0 ? kart.drift.direction : this.driftSide;
    const curveAhead = -side * meanCurvature(track, projection.index, DRIFT_EXIT_WINDOW);
    const curveNow = -side * meanCurvature(track, projection.index, DRIFT_END_WINDOW);
    const release =
      Math.abs(headingError) > DRIFT_MAX_ERROR ||
      laneError > DRIFT_MAX_LANE_ERROR ||
      pursuit * side < DRIFT_PLAN_TURN * DRIFT_OVERTURN ||
      Math.abs(projection.lateral) > edgeLimit ||
      curveNow < DRIFT_EXIT_CURVATURE ||
      (kart.drift.tier >= this.personality.targetTier && curveAhead < DRIFT_EXIT_CURVATURE);
    if (release) {
      this.resetDrift();
      return false;
    }
    return true;
  }

  /**
   * Braquage en dérapage. Pendant le saut : braquage franc vers l'intérieur. Ensuite, la rotation
   * vaut entre steerMin (contre-braquage) et steerMax (serré) × turnRate : on choisit la position
   * du volant qui donne la rotation demandée par la poursuite.
   */
  private driftSteer(kart: KartState, pursuit: number, steer: number): number {
    if (!kart.drift.active) return this.driftSide * Math.max(this.driftSide * steer, DRIFT_START_STEER * 2);
    const side = kart.drift.direction !== 0 ? kart.drift.direction : this.driftSide;
    const wanted = pursuit * side;
    const wheel = (2 * (wanted - DRIFT.steerMin)) / (DRIFT.steerMax - DRIFT.steerMin) - 1;
    return clamp(wheel, -1, 1) * side;
  }

  /** Décide de l'usage de l'objet ; vrai sur un seul pas (front montant). */
  private updateItems(racer: RacerState, race: RaceState, cornerCurvature: number, busy: boolean, dt: number): boolean {
    this.itemRetry = Math.max(0, this.itemRetry - dt);
    const item = racer.itemRoulette > 0 ? null : racer.item;
    if (item !== this.trackedItem) {
      this.trackedItem = item;
      this.itemTime = 0;
      this.itemDelay = item === null ? 0 : this.drawItemDelay(item);
    }
    if (item === null) return false;
    this.itemTime += dt;
    if (busy || racer.finished || this.itemRetry > 0 || !this.wantsToUse(item, racer, race, cornerCurvature)) return false;
    this.itemRetry = ITEM_RETRY_DELAY;
    return true;
  }

  private wantsToUse(item: ItemKind, racer: RacerState, race: RaceState, cornerCurvature: number): boolean {
    const waited = this.itemTime >= this.itemDelay;
    switch (item) {
      case 'kibble-turbo':
        return cornerCurvature < TURBO_MAX_CURVATURE;
      case 'bone':
        return waited || nearestRacerAhead(race, racer, BONE_RANGE, BONE_HALF_ANGLE) !== null;
      case 'tennis-ball':
        return waited && racer.rank > 1;
      case 'mud':
        return waited || hasRacerBehind(race, racer, MUD_RANGE);
    }
  }

  private drawItemDelay(item: ItemKind): number {
    switch (item) {
      case 'bone': {
        const shortening = 1 - BONE_AGGRESSION_SHORTENING * this.personality.aggression;
        return this.rng.range(ITEM_DELAY.bone.min, ITEM_DELAY.bone.max) * shortening;
      }
      case 'tennis-ball':
        return this.rng.range(ITEM_DELAY.ball.min, ITEM_DELAY.ball.max);
      case 'mud':
        return this.rng.range(ITEM_DELAY.mud.min, ITEM_DELAY.mud.max);
      case 'kibble-turbo':
        return 0;
    }
  }

  private resetDrift(): void {
    if (this.driftPhase !== 'idle') this.driftCooldown = DRIFT_COOLDOWN;
    this.driftPhase = 'idle';
  }

  private resetManeuvers(): void {
    this.stuckTime = 0;
    this.reverseTime = 0;
    this.uTurnSteer = 0;
    this.resetDrift();
  }
}

/** Distance (m) entre la projection du kart et le point visé, le long du circuit. */
function lookAhead(speed: number): number {
  return TARGET_BASE_DISTANCE + Math.max(0, speed) * TARGET_SPEED_FACTOR;
}

/** Nombre d'échantillons couvrant `distance` mètres (au moins 1, au plus un tour). */
function sampleSpan(track: TrackQuery, distance: number): number {
  const count = track.samples.length;
  return clamp(Math.round((distance * count) / track.length), 1, count);
}

/** Courbure moyenne signée sur `distance` mètres à partir de l'échantillon `index`. */
function meanCurvature(track: TrackQuery, index: number, distance: number): number {
  const samples = track.samples;
  const span = sampleSpan(track, distance);
  let sum = 0;
  for (let k = 0; k < span; k++) sum += samples[(index + k) % samples.length].curvature;
  return sum / span;
}

/** Plus forte courbure, en valeur absolue, sur `distance` mètres à partir de l'échantillon `index`. */
function maxAbsCurvature(track: TrackQuery, index: number, distance: number): number {
  const samples = track.samples;
  const span = sampleSpan(track, distance);
  let max = 0;
  for (let k = 0; k < span; k++) max = Math.max(max, Math.abs(samples[(index + k) % samples.length].curvature));
  return max;
}

/**
 * Longueur (m) du virage qui se poursuit dans le sens `sign` (+1 gauche, -1 droite) à partir de
 * l'échantillon `index` : échantillons consécutifs de courbure signée > `minCurvature`, au plus `maxDistance`.
 */
function curveLengthAhead(track: TrackQuery, index: number, sign: number, minCurvature: number, maxDistance: number): number {
  const samples = track.samples;
  const span = sampleSpan(track, maxDistance);
  let k = 0;
  while (k < span && samples[(index + k) % samples.length].curvature * sign > minCurvature) k++;
  return (k * track.length) / samples.length;
}

/** Angle (rad, + = à gauche) sous lequel le kart voit `point`. */
function bearingTo(kart: KartState, point: Vec2): number {
  return wrapAngle(Math.atan2(point.x - kart.position.x, point.z - kart.position.z) - kart.heading);
}

/** Kart le plus proche devant, à moins de `range` m et dans un cône de ±`halfAngle` autour du cap. */
function nearestRacerAhead(race: RaceState, self: RacerState, range: number, halfAngle: number): RacerState | null {
  const origin = self.kart.position;
  let nearest: RacerState | null = null;
  let nearestSq = range * range;
  for (const other of race.racers) {
    if (other.id === self.id) continue;
    const dx = other.kart.position.x - origin.x;
    const dz = other.kart.position.z - origin.z;
    const distSq = dx * dx + dz * dz;
    if (distSq >= nearestSq || Math.abs(bearingTo(self.kart, other.kart.position)) > halfAngle) continue;
    nearest = other;
    nearestSq = distSq;
  }
  return nearest;
}

/** Vrai si un concurrent encore en course suit à moins de `range` m de progression. */
function hasRacerBehind(race: RaceState, self: RacerState, range: number): boolean {
  for (const other of race.racers) {
    if (other.id === self.id || other.finished) continue;
    const gap = self.progress - other.progress;
    if (gap > 0 && gap < range) return true;
  }
  return false;
}
