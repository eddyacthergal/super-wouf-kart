/**
 * Objets à l'écran : boîtes à objets (cube irisé qui tourne et flotte, avec un « ? »), et entités
 * (os, balle de tennis, flaque de boue) créées et retirées selon state.items (comparaison par id).
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ITEMS } from '../core/constants';
import { createRng } from '../core/rng';
import type { ItemEntityKind, RaceState } from '../core/types';
import { tennisBallGeometry } from './decor-models';
import { PALETTE } from './palette';
import { type DisposalBag, paintedGeometry, paintedMaterial, transform } from './resources';

/** Hauteur de flottaison des boîtes (m), amplitude et vitesse du flottement. */
const BOX_HEIGHT = 1.05;
const BOX_BOB = 0.15;
const BOX_SIZE = 1.1;
/** Durée (s) de l'animation de réapparition. */
const BOX_APPEAR_DURATION = 0.45;
const BONE_HEIGHT = 0.55;
const BONE_SPIN = 14;
const BALL_RADIUS = 0.45;
const MUD_Y = 0.045;
/** Durée (s) pendant laquelle une flaque s'étale après avoir été posée. */
const MUD_SPREAD = 0.3;

interface BoxVisual {
  id: number;
  root: THREE.Group;
  float: THREE.Group;
  appear: number;
  phase: number;
  seen: number;
}

interface EntityVisual {
  id: number;
  object: THREE.Object3D;
  kind: ItemEntityKind;
  age: number;
  roll: number;
  seen: number;
}

/** Dépassement léger en fin d'animation (effet « pop »). */
function easeOutBack(t: number): number {
  const c = 1.70158;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** Cube arrondi aux couleurs arc-en-ciel (par sommet). */
function boxGeometry(): THREE.BufferGeometry {
  const geometry = new RoundedBoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE, 3, 0.2);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const hue =
      (positions.getX(i) * 0.5 + positions.getY(i) * 0.35 + positions.getZ(i) * 0.2 + 1) % 1;
    color.setHSL(hue, 0.85, 0.62);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** Point d'interrogation en volume (crochet, barre, point), ~0,85 m de haut. */
function questionMarkGeometry(): THREE.BufferGeometry {
  const color = '#fff7c2';
  return paintedGeometry([
    {
      geometry: new THREE.TorusGeometry(0.2, 0.07, 10, 28, 5.0),
      color,
      matrix: transform(0, 0.13, 0, 0, 0, -Math.PI / 2),
    },
    {
      geometry: new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12),
      color,
      matrix: transform(0, -0.16, 0),
    },
    { geometry: new THREE.SphereGeometry(0.085, 12, 8), color, matrix: transform(0, -0.4, 0) },
  ]);
}

/** Os cartoon (~1,1 m), le long de X. */
function boneGeometry(): THREE.BufferGeometry {
  return paintedGeometry([
    {
      geometry: new THREE.CylinderGeometry(0.11, 0.11, 0.72, 12),
      color: PALETTE.bone,
      matrix: transform(0, 0, 0, 0, 0, Math.PI / 2),
    },
    ...[-1, 1].flatMap((x) =>
      [-1, 1].map((z) => ({
        geometry: new THREE.SphereGeometry(0.16, 14, 10),
        color: PALETTE.bone,
        matrix: transform(x * 0.38, 0, z * 0.11),
      })),
    ),
  ]);
}

/** Contour irrégulier (rayon ~1) d'une flaque. */
function wobblyShape(seed: number, radius: number, cx = 0, cy = 0): THREE.Shape {
  const rng = createRng(seed);
  const points: THREE.Vector2[] = [];
  const count = 18;
  const bumps = Array.from({ length: count }, () => rng.range(0.8, 1.08));
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    // Lissage : moyenne avec les voisins pour des bords arrondis.
    const r =
      radius * (bumps[i] * 0.5 + (bumps[(i + 1) % count] + bumps[(i + count - 1) % count]) * 0.25);
    points.push(new THREE.Vector2(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r));
  }
  const shape = new THREE.Shape();
  shape.setFromPoints(points);
  shape.closePath();
  return shape;
}

/** Flaque de boue aplatie (rayon 1), bords irréguliers et taches plus sombres. */
function mudGeometry(): THREE.BufferGeometry {
  const flat = (shape: THREE.Shape, lift: number): THREE.BufferGeometry =>
    new THREE.ShapeGeometry(shape, 6).rotateX(-Math.PI / 2).translate(0, lift, 0);
  return paintedGeometry([
    { geometry: flat(wobblyShape(0x3d1, 1), 0), color: '#6b4423' },
    { geometry: flat(wobblyShape(0x3d2, 0.45, 0.25, -0.2), 0.004), color: '#553418' },
    { geometry: flat(wobblyShape(0x3d3, 0.25, -0.4, 0.3), 0.004), color: '#553418' },
    { geometry: flat(wobblyShape(0x3d4, 0.12, -0.1, 0.55), 0.008), color: '#8a5a33' },
  ]);
}

export class ItemVisuals {
  readonly group = new THREE.Group();
  private readonly boxes = new Map<number, BoxVisual>();
  private readonly entities = new Map<number, EntityVisual>();
  private readonly boxGeometry: THREE.BufferGeometry;
  private readonly boxMaterial: THREE.MeshStandardMaterial;
  private readonly questionGeometry: THREE.BufferGeometry;
  private readonly questionMaterial: THREE.MeshStandardMaterial;
  private readonly geometries: Record<ItemEntityKind, THREE.BufferGeometry>;
  private readonly materials: Record<ItemEntityKind, THREE.Material>;
  private frame = 0;

  constructor(bag: DisposalBag) {
    this.group.name = 'items';
    this.boxGeometry = bag.add(boxGeometry());
    this.boxMaterial = bag.add(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.62,
        roughness: 0.15,
        metalness: 0.1,
        emissive: '#ffffff',
        emissiveIntensity: 0.3,
        depthWrite: false,
      }),
    );
    this.questionGeometry = bag.add(questionMarkGeometry());
    this.questionMaterial = bag.add(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        emissive: '#ffd23f',
        emissiveIntensity: 0.55,
        roughness: 0.4,
      }),
    );
    const painted = bag.add(paintedMaterial(0.55));
    const mud = bag.add(
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.25,
        metalness: 0.05,
        polygonOffset: true,
        polygonOffsetFactor: -6,
        polygonOffsetUnits: -6,
      }),
    );
    this.geometries = {
      bone: bag.add(boneGeometry()),
      'tennis-ball': bag.add(tennisBallGeometry()),
      mud: bag.add(mudGeometry()),
    };
    this.materials = { bone: painted, 'tennis-ball': painted, mud };
  }

  update(state: RaceState, alpha: number, dt: number, time: number): void {
    const frame = ++this.frame;
    this.boxMaterial.emissive.setHSL((time * 0.3) % 1, 0.9, 0.55);

    for (const box of state.itemBoxes) {
      const visual = this.boxes.get(box.id) ?? this.createBox(box.id);
      visual.seen = frame;
      visual.root.position.set(box.position.x, 0, box.position.z);
      if (box.respawn > 0) {
        visual.appear = 0;
        visual.root.visible = false;
        continue;
      }
      visual.appear = Math.min(1, visual.appear + dt / BOX_APPEAR_DURATION);
      const scale = Math.max(0.001, easeOutBack(visual.appear));
      visual.root.visible = true;
      visual.root.scale.setScalar(scale);
      visual.float.position.y = BOX_HEIGHT + Math.sin(time * 2.2 + visual.phase) * BOX_BOB;
      visual.float.rotation.set(0.4, time * 1.3 + visual.phase, 0.25);
    }
    for (const visual of this.boxes.values()) {
      if (visual.seen !== frame) {
        visual.root.removeFromParent();
        this.boxes.delete(visual.id);
      }
    }

    for (const entity of state.items) {
      const visual = this.entities.get(entity.id) ?? this.createEntity(entity.id, entity.kind);
      visual.seen = frame;
      visual.age += dt;
      const object = visual.object;
      object.position.set(
        entity.prevPosition.x + (entity.position.x - entity.prevPosition.x) * alpha,
        0,
        entity.prevPosition.z + (entity.position.z - entity.prevPosition.z) * alpha,
      );
      switch (visual.kind) {
        case 'bone':
          object.position.y = BONE_HEIGHT;
          object.rotation.y = entity.heading + visual.age * BONE_SPIN;
          break;
        case 'tennis-ball':
          object.position.y = BALL_RADIUS + Math.abs(Math.sin(visual.age * 9)) * 0.35;
          visual.roll += (entity.speed * dt) / BALL_RADIUS;
          object.rotation.set(visual.roll, entity.heading, 0);
          break;
        case 'mud':
          object.position.y = MUD_Y;
          object.scale.setScalar(
            ITEMS.mudRadius * Math.min(1, 0.3 + (0.7 * visual.age) / MUD_SPREAD),
          );
          break;
      }
    }
    for (const visual of this.entities.values()) {
      if (visual.seen !== frame) {
        visual.object.removeFromParent();
        this.entities.delete(visual.id);
      }
    }
  }

  dispose(): void {
    this.boxes.clear();
    this.entities.clear();
    this.group.removeFromParent();
    this.group.clear();
  }

  private createBox(id: number): BoxVisual {
    const root = new THREE.Group();
    root.name = `item-box-${id}`;
    const float = new THREE.Group();
    const cube = new THREE.Mesh(this.boxGeometry, this.boxMaterial);
    cube.renderOrder = 1;
    const question = new THREE.Mesh(this.questionGeometry, this.questionMaterial);
    question.scale.setScalar(0.85);
    question.castShadow = true;
    float.add(question, cube);
    root.add(float);
    this.group.add(root);
    // Une boîte présente dès le départ apparaît sans animation.
    const visual: BoxVisual = { id, root, float, appear: 1, phase: id * 1.7, seen: 0 };
    this.boxes.set(id, visual);
    return visual;
  }

  private createEntity(id: number, kind: ItemEntityKind): EntityVisual {
    const mesh = new THREE.Mesh(this.geometries[kind], this.materials[kind]);
    mesh.name = `item-entity-${id}`;
    mesh.castShadow = kind !== 'mud';
    mesh.receiveShadow = kind === 'mud';
    mesh.rotation.order = 'YXZ';
    if (kind === 'tennis-ball') mesh.scale.setScalar(BALL_RADIUS);
    if (kind === 'mud') mesh.rotation.y = id * 2.4;
    this.group.add(mesh);
    const visual: EntityVisual = { id, object: mesh, kind, age: 0, roll: 0, seen: 0 };
    this.entities.set(id, visual);
    return visual;
  }
}
