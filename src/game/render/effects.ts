/**
 * Effets visuels : étincelles de dérapage (couleur du palier), flammes de boost aux pots,
 * poussière hors piste, étoiles au-dessus d'un kart en tête-à-queue, bouffées et éclats
 * (objet utilisé, impact, boîte ramassée, haie touchée). Particules en réserve préallouée.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import type { GameEvent, RaceState, TrackQuery } from '../core/types';
import { DRIFT_TIER_COLORS } from './palette';
import { type ParticleOptions, ParticlePool } from './particles';
import type { RacerVisual, RacerVisuals } from './racer-visuals';
import type { DisposalBag } from './resources';

const GLOW_CAPACITY = 1200;
const SOFT_CAPACITY = 800;
const STARS_PER_KART = 3;
/** Étincelles par roue et par seconde : palier 0 (sans charge) puis paliers 1 à 3. */
const SPARK_RATE_IDLE = 30;
const SPARK_RATE_CHARGED = 42;
/** Taille des étincelles (m) : plus petites tant que le dérapage n'est pas chargé. */
const SPARK_SIZE_IDLE: readonly [number, number] = [0.09, 0.13];
const SPARK_SIZE_CHARGED: readonly [number, number] = [0.12, 0.19];
const DUST_RATE = 12;
const FLAME_GLOW_RATE = 30;
const MIN_SPARK_SPEED = 4;
const MIN_DUST_SPEED = 3;

interface Emitter {
  spark: number;
  dust: number;
  flame: number;
}

const color = (hex: string): THREE.Color => new THREE.Color(hex);

const TIER_COLORS = DRIFT_TIER_COLORS.map(color);
const DUST = color('#b98f5f');
const FLAME = color('#ff8a1f');
const FLAME_CORE = color('#ffd35a');
const PUFF = color('#f4f1ea');
const HIT = color('#ffe066');
const LEAF = color('#4caf3c');

/**
 * Étincelle : cœur opaque (mélange normal) qui garde la couleur du palier même sur le gravier
 * clair, où le seul mélange additif la délavait en blanc, et halo additif autour. Dès le début du
 * dérapage (palier 0, jaune) : le joueur doit voir tout de suite qu'il dérape.
 */
const SPARK_CORE: ParticleOptions = { gravity: -16, opacity: 1, drag: 1 };
const SPARK_HALO: ParticleOptions = { gravity: -16, opacity: 0.45, drag: 1 };
const SPARK_HALO_SCALE = 1.9;
const DUST_OPTIONS: ParticleOptions = { gravity: -0.6, growth: 1.4, drag: 2, opacity: 0.5 };
const FLAME_OPTIONS: ParticleOptions = { gravity: 0, growth: -0.6, drag: 3, opacity: 0.9 };

/** Étoile à cinq branches, en léger relief, tournée vers +Z. */
function starGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 === 0 ? 1 : 0.45;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false }).translate(
    0,
    0,
    -0.125,
  );
}

/** Cône de flamme : base à l'origine, pointe vers -Z (sens du gaz). */
function flameGeometry(radius: number, length: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(radius, length, 12, 1, true)
    .rotateX(-Math.PI / 2)
    .translate(0, 0, -length / 2);
}

export class Effects {
  readonly group = new THREE.Group();
  readonly glow: ParticlePool;
  readonly soft: ParticlePool;
  private readonly stars: THREE.InstancedMesh;
  /** Flammes de chaque pilote : un groupe par pot d'échappement. */
  private readonly flames = new Map<number, THREE.Group[]>();
  private readonly emitters = new Map<number, Emitter>();
  private readonly rng = createRng(0xeffec7);
  private readonly point = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly euler = new THREE.Euler();
  private readonly hue = new THREE.Color();
  private readonly burstOptions: ParticleOptions = { gravity: 0, drag: 2.5, growth: 0 };

  constructor(
    racers: RacerVisuals,
    bag: DisposalBag,
    private readonly track: TrackQuery,
  ) {
    this.group.name = 'effects';
    this.glow = new ParticlePool(GLOW_CAPACITY, true, bag);
    this.soft = new ParticlePool(SOFT_CAPACITY, false, bag);
    this.group.add(this.soft.points, this.glow.points);

    const capacity = Math.max(1, racers.list.length * STARS_PER_KART);
    this.stars = new THREE.InstancedMesh(
      bag.add(starGeometry()),
      bag.add(new THREE.MeshBasicMaterial({ color: '#ffd23f', toneMapped: false })),
      capacity,
    );
    this.stars.name = 'spin-stars';
    this.stars.count = 0;
    this.stars.frustumCulled = false;
    this.stars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.stars);

    const outer = bag.add(flameGeometry(0.14, 0.75));
    const inner = bag.add(flameGeometry(0.08, 0.5));
    const flameMaterial = (hex: string, opacity: number): THREE.MeshBasicMaterial =>
      bag.add(
        new THREE.MeshBasicMaterial({
          color: hex,
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
    const outerMaterial = flameMaterial('#ff7a1a', 0.85);
    const innerMaterial = flameMaterial('#ffe27a', 0.95);
    for (const visual of racers.list) {
      const groups = visual.model.exhausts.map((exhaust) => {
        const flame = new THREE.Group();
        flame.name = 'boost-flame';
        flame.visible = false;
        flame.add(new THREE.Mesh(outer, outerMaterial), new THREE.Mesh(inner, innerMaterial));
        exhaust.add(flame);
        return flame;
      });
      this.flames.set(visual.id, groups);
      this.emitters.set(visual.id, { spark: 0, dust: 0, flame: 0 });
    }
  }

  /** Bouffées et éclats déclenchés par les événements de la simulation. */
  handleEvents(events: readonly GameEvent[], racers: RacerVisuals, state: RaceState): void {
    for (const event of events) {
      if (!('racerId' in event)) continue;
      const visual = racers.get(event.racerId);
      if (!visual) continue;
      const { x, z } = visual.position;
      switch (event.type) {
        case 'hit':
          this.burst(this.glow, x, 0.9, z, 24, HIT, 4, 8, 0.24, 0.45, -6);
          this.burst(this.soft, x, 0.7, z, 10, PUFF, 1.5, 3, 0.5, 0.55, 0);
          break;
        case 'item-use':
          this.burst(this.soft, x, 0.8, z, 12, PUFF, 1.5, 3, 0.45, 0.5, 0);
          break;
        case 'item-box':
          for (let i = 0; i < 18; i++) {
            this.hue.setHSL(this.rng.next(), 0.9, 0.62);
            this.burst(this.glow, x, 1.1, z, 1, this.hue, 3, 6, 0.2, 0.5, -4);
          }
          break;
        case 'boost': {
          const tint = event.source === 'drift' ? TIER_COLORS[event.tier] : FLAME;
          for (const exhaust of visual.model.exhausts) {
            exhaust.getWorldPosition(this.point);
            this.burst(
              this.glow,
              this.point.x,
              this.point.y,
              this.point.z,
              8,
              tint,
              1.5,
              4,
              0.25,
              0.3,
              0,
            );
          }
          break;
        }
        case 'wall': {
          // Haie touchée : du côté de la ligne médiane où se trouve le kart (lateral > 0 = gauche),
          // selon la gauche du circuit et non celle du kart (qui peut rouler à contre-sens).
          let wallX = Math.cos(visual.heading);
          let wallZ = -Math.sin(visual.heading);
          for (const racer of state.racers) {
            if (racer.id !== event.racerId) continue;
            const sample = this.track.samples[racer.kart.trackIndex];
            if (sample) {
              wallX = sample.left.x;
              wallZ = sample.left.z;
            }
            if (racer.kart.lateral < 0) {
              wallX = -wallX;
              wallZ = -wallZ;
            }
          }
          const count = 4 + Math.round(event.intensity * 8);
          this.burst(
            this.soft,
            x + wallX * 0.9,
            0.8,
            z + wallZ * 0.9,
            count,
            LEAF,
            1,
            3,
            0.22,
            0.7,
            -5,
          );
          break;
        }
      }
    }
  }

  update(state: RaceState, racers: RacerVisuals, dt: number, time: number): void {
    let stars = 0;
    for (const racer of state.racers) {
      const visual = racers.get(racer.id);
      const emitter = this.emitters.get(racer.id);
      if (!visual || !emitter) continue;
      const kart = racer.kart;
      const speed = Math.abs(kart.speed);

      // Étincelles de dérapage aux roues arrière.
      if (kart.drift.active && speed > MIN_SPARK_SPEED) {
        emitter.spark += (kart.drift.tier === 0 ? SPARK_RATE_IDLE : SPARK_RATE_CHARGED) * dt;
        while (emitter.spark >= 1) {
          emitter.spark -= 1;
          this.emitSparks(visual, kart.drift.tier);
        }
      } else {
        emitter.spark = 0;
      }

      // Poussière sur le bas-côté.
      if (kart.offroad && speed > MIN_DUST_SPEED) {
        emitter.dust += (DUST_RATE + speed * 0.6) * dt;
        while (emitter.dust >= 1) {
          emitter.dust -= 1;
          this.emitDust(visual);
        }
      } else {
        emitter.dust = 0;
      }

      // Flammes de boost.
      const boosting = kart.boostTime > 0;
      const flames = this.flames.get(racer.id);
      if (flames) {
        const strength = 0.85 + (kart.boostStrength - 1) * 1.2;
        for (let i = 0; i < flames.length; i++) {
          const flame = flames[i];
          flame.visible = boosting;
          if (!boosting) continue;
          const flicker =
            1 + Math.sin(time * 47 + i * 1.7 + racer.id) * 0.22 + Math.sin(time * 29 + i) * 0.14;
          const width = 1 + Math.sin(time * 61 + i * 2.3) * 0.12;
          flame.scale.set(width, width, strength * flicker);
        }
      }
      if (boosting) {
        emitter.flame += FLAME_GLOW_RATE * dt;
        while (emitter.flame >= 1) {
          emitter.flame -= 1;
          this.emitFlameGlow(visual);
        }
      } else {
        emitter.flame = 0;
      }

      // Étoiles qui tournent au-dessus d'un kart en tête-à-queue.
      if (kart.spinTime > 0 && stars + STARS_PER_KART <= this.stars.instanceMatrix.count) {
        for (let k = 0; k < STARS_PER_KART; k++) {
          const angle = time * 6 + (k / STARS_PER_KART) * Math.PI * 2;
          this.point.set(
            visual.position.x + Math.sin(angle) * 0.7,
            1.95 + Math.sin(time * 9 + k) * 0.08,
            visual.position.z + Math.cos(angle) * 0.7,
          );
          this.quaternion.setFromEuler(this.euler.set(0, angle * 2, 0));
          this.scale.setScalar(0.2);
          this.stars.setMatrixAt(
            stars++,
            this.matrix.compose(this.point, this.quaternion, this.scale),
          );
        }
      }
    }
    this.stars.count = stars;
    if (stars > 0) this.stars.instanceMatrix.needsUpdate = true;

    this.glow.update(dt);
    this.soft.update(dt);
  }

  dispose(): void {
    for (const groups of this.flames.values()) for (const flame of groups) flame.removeFromParent();
    this.flames.clear();
    this.emitters.clear();
    this.group.removeFromParent();
    this.group.clear();
  }

  private emitSparks(visual: RacerVisual, tier: number): void {
    const rng = this.rng;
    const forwardX = Math.sin(visual.heading);
    const forwardZ = Math.cos(visual.heading);
    const wheels = visual.model.rearWheels;
    const tint = TIER_COLORS[tier] ?? TIER_COLORS[0];
    for (let w = 0; w < wheels.length; w++) {
      wheels[w].getWorldPosition(this.point);
      // Roue gauche (+X du kart) puis droite : les étincelles partent vers l'extérieur.
      const side = w === 0 ? 1 : -1;
      const out = rng.range(0.4, 2.2) * side;
      const back = rng.range(1.5, 4.5);
      const y = Math.max(0.06, this.point.y - 0.26);
      const vx = -forwardX * back + Math.cos(visual.heading) * out;
      const vy = rng.range(1.5, 4.2);
      const vz = -forwardZ * back - Math.sin(visual.heading) * out;
      const life = rng.range(0.2, 0.42);
      // Même trajectoire pour le cœur et le halo : ils avancent ensemble.
      const [minSize, maxSize] = tier === 0 ? SPARK_SIZE_IDLE : SPARK_SIZE_CHARGED;
      const size = rng.range(minSize, maxSize);
      this.soft.emit(this.point.x, y, this.point.z, vx, vy, vz, tint, size, life, SPARK_CORE);
      this.glow.emit(
        this.point.x,
        y,
        this.point.z,
        vx,
        vy,
        vz,
        tint,
        size * SPARK_HALO_SCALE,
        life,
        SPARK_HALO,
      );
    }
  }

  private emitDust(visual: RacerVisual): void {
    const rng = this.rng;
    const forwardX = Math.sin(visual.heading);
    const forwardZ = Math.cos(visual.heading);
    for (const wheel of visual.model.rearWheels) {
      wheel.getWorldPosition(this.point);
      const back = rng.range(0.5, 2);
      this.soft.emit(
        this.point.x + rng.range(-0.2, 0.2),
        0.2,
        this.point.z + rng.range(-0.2, 0.2),
        -forwardX * back + rng.range(-0.6, 0.6),
        rng.range(0.6, 1.6),
        -forwardZ * back + rng.range(-0.6, 0.6),
        DUST,
        rng.range(0.35, 0.55),
        rng.range(0.55, 0.85),
        DUST_OPTIONS,
      );
    }
  }

  private emitFlameGlow(visual: RacerVisual): void {
    const rng = this.rng;
    const forwardX = Math.sin(visual.heading);
    const forwardZ = Math.cos(visual.heading);
    for (const exhaust of visual.model.exhausts) {
      exhaust.getWorldPosition(this.point);
      const back = rng.range(2, 4.5);
      this.glow.emit(
        this.point.x - forwardX * 0.3,
        this.point.y,
        this.point.z - forwardZ * 0.3,
        -forwardX * back,
        rng.range(0.2, 0.8),
        -forwardZ * back,
        rng.next() < 0.5 ? FLAME : FLAME_CORE,
        rng.range(0.22, 0.34),
        rng.range(0.12, 0.22),
        FLAME_OPTIONS,
      );
    }
  }

  /** Gerbe radiale de `count` particules. */
  private burst(
    pool: ParticlePool,
    x: number,
    y: number,
    z: number,
    count: number,
    tint: THREE.Color,
    minSpeed: number,
    maxSpeed: number,
    size: number,
    life: number,
    gravity: number,
  ): void {
    const rng = this.rng;
    // Réglages réutilisés (emit() les recopie aussitôt) : aucune allocation par gerbe.
    const options = this.burstOptions;
    options.gravity = gravity;
    options.growth = pool === this.soft ? 1.2 : 0;
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      const speed = rng.range(minSpeed, maxSpeed);
      const lift = rng.range(0.2, 1);
      pool.emit(
        x,
        y,
        z,
        Math.cos(angle) * speed,
        lift * speed * 0.8,
        Math.sin(angle) * speed,
        tint,
        size * rng.range(0.8, 1.2),
        life * rng.range(0.8, 1.2),
        options,
      );
    }
  }
}
