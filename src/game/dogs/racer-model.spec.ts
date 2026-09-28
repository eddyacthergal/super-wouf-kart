import * as THREE from 'three';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { type BreedId, EMPTY_SKINS, type SkinSelection } from '../core/types';
import { createEnvironmentMap } from '../render/environment-map';
import { BREED_LIST, BREEDS } from './breeds';
import { sharedGeometries, sharedMaterials } from './model-resources';
import { buildRacerModel, type RacerModel, type RacerVisualState } from './racer-model';
import { SKINS, skinsForSlot } from './skins-catalog';

const IDLE: RacerVisualState = {
  speed: 0,
  steer: 0,
  driftDirection: 0,
  boosting: false,
  spinning: false,
  hop: 0,
};
const MAX_MESHES = 60;

/**
 * Pièces qui reflètent l'image d'environnement : coque vernie (pontons, nez et capot, à la couleur
 * du pilote), chromes, truffe et yeux. Le plancher est dans le matériau sombre des garnitures.
 */
const REFLECTIVE_PARTS = [
  'kart-pod',
  'kart-nose',
  'kart-hood',
  'kart-engine',
  'exhaust-pipe',
  'rim',
  'dog-nose',
  'dog-eye-whites',
  'dog-pupils',
] as const;
const CHROME_PARTS = ['kart-engine', 'exhaust-pipe', 'rim'] as const;

/** Image d'environnement du jardin (construite sans WebGL). */
const environment = createEnvironmentMap({
  top: '#2f8fe8',
  horizon: '#cfeaff',
  sun: '#fff6d8',
  ground: '#6aa845',
  sunDirection: [0.45, 0.8, -0.38],
});

const models: RacerModel[] = [];

function build(
  breed: BreedId,
  skins: SkinSelection = EMPTY_SKINS,
  kartColor = '#d7322e',
  reflections: THREE.Texture | null = null,
): RacerModel {
  const model = buildRacerModel({ breed, skins, kartColor, environment: reflections });
  models.push(model);
  model.root.updateMatrixWorld(true);
  return model;
}

afterEach(() => {
  for (const model of models.splice(0)) model.dispose();
});

afterAll(() => environment.dispose());

/** Image d'environnement d'un matériau (null s'il n'en a pas). */
function envMapOf(material: THREE.Material): THREE.Texture | null {
  return 'envMap' in material && material.envMap instanceof THREE.Texture ? material.envMap : null;
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function materialOf(root: THREE.Object3D, name: string): THREE.Material {
  const object = named(root, name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`${name} doit être un mesh`);
  return materialsOf(object)[0];
}

function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

function boxOf(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function named(root: THREE.Object3D, name: string): THREE.Object3D {
  const object = root.getObjectByName(name);
  if (!object) throw new Error(`objet introuvable : ${name}`);
  return object;
}

function worldPosition(object: THREE.Object3D): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return object.getWorldPosition(new THREE.Vector3());
}

/** Axe +Z local de `object`, dans le repère du monde. */
function worldForward(object: THREE.Object3D): THREE.Vector3 {
  object.updateWorldMatrix(true, false);
  return object.getWorldDirection(new THREE.Vector3());
}

/** Anime le modèle pendant `seconds` à 60 Hz et relève `probe` après chaque pas. */
function sampleWhile(
  model: RacerModel,
  seconds: number,
  state: RacerVisualState,
  probe: () => number,
): number[] {
  const values: number[] = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    model.update(1 / 60, state);
    values.push(probe());
  }
  return values;
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

function signChanges(values: readonly number[]): number {
  let changes = 0;
  for (let i = 1; i < values.length; i++)
    if (Math.sign(values[i]) !== Math.sign(values[i - 1])) changes++;
  return changes;
}

/** Sommets de la cape dans le repère du monde. */
function capeVertices(root: THREE.Object3D): THREE.Vector3[] {
  const cape = named(root, 'skin-cape');
  if (!(cape instanceof THREE.Mesh)) throw new Error('la cape doit être un mesh');
  cape.updateWorldMatrix(true, false);
  const positions = cape.geometry.getAttribute('position');
  const vertices: THREE.Vector3[] = [];
  for (let i = 0; i < positions.count; i++)
    vertices.push(
      new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(cape.matrixWorld),
    );
  return vertices;
}

function centroid(points: readonly THREE.Vector3[]): THREE.Vector3 {
  const sum = new THREE.Vector3();
  for (const point of points) sum.add(point);
  return sum.divideScalar(points.length);
}

const SKIN_CASES = [
  { label: 'sans accessoire', skins: EMPTY_SKINS },
  ...SKINS.map((skin) => ({ label: skin.id, skins: { ...EMPTY_SKINS, [skin.slot]: skin.id } })),
];

describe.each(BREED_LIST.map((breed) => breed.id))('buildRacerModel (%s)', (breed) => {
  it.each(SKIN_CASES)('se construit $label dans les dimensions attendues', ({ skins }) => {
    const model = build(breed, skins);
    const meshes = meshesOf(model.root);
    expect(meshes.length).toBeLessThanOrEqual(MAX_MESHES);
    expect(meshes.every((mesh) => mesh.castShadow)).toBe(true);

    const box = boxOf(model.root);
    const size = box.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(1.3);
    expect(size.x).toBeLessThan(1.6);
    expect(size.y).toBeGreaterThan(1.55);
    expect(size.y).toBeLessThan(2.35);
    expect(size.z).toBeGreaterThan(1.9);
    expect(size.z).toBeLessThan(2.6);
    // Origine au sol, au centre du kart.
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.min.y).toBeLessThan(0.02);
    expect(Math.abs(box.min.x + box.max.x)).toBeLessThan(0.05);
  });

  it('regarde vers +Z : museau devant le corps, tête au-dessus du kart', () => {
    const model = build(breed);
    const muzzle = worldPosition(named(model.root, 'dog-muzzle'));
    const torso = worldPosition(named(model.root, 'dog-torso'));
    const head = worldPosition(named(model.root, 'dog-head'));
    expect(muzzle.z).toBeGreaterThan(torso.z + 0.1);
    expect(head.y).toBeGreaterThan(1.1);
    expect(Math.abs(muzzle.x)).toBeLessThan(1e-6);
  });

  it('expose deux pots d’échappement et deux roues arrière à l’arrière', () => {
    const model = build(breed);
    expect(model.exhausts).toHaveLength(2);
    expect(model.rearWheels).toHaveLength(2);
    for (const exhaust of model.exhausts) {
      const position = worldPosition(exhaust);
      expect(position.z).toBeLessThan(-0.8);
      expect(position.y).toBeGreaterThan(0.2);
      // Le tuyau est devant la sortie : les gaz partent vers -Z.
      const pipe = worldPosition(exhaust.children[0]);
      expect(pipe.z).toBeGreaterThan(position.z);
    }
    // Gauche puis droite ; la gauche du pilote est +X (spec §3).
    const [left, right] = model.rearWheels.map(worldPosition);
    expect(left.z).toBeLessThan(0);
    expect(right.z).toBeLessThan(0);
    expect(left.x).toBeGreaterThan(0.4);
    expect(left.x).toBeCloseTo(-right.x);
    expect(left.y).toBeGreaterThan(0.2);
  });

  it('pose le nœud papillon devant le cou et la cape du côté du dos', () => {
    const model = build(breed, { head: null, neck: 'bowtie', body: 'cape' });
    const neck = worldPosition(named(model.root, 'attach-neck'));
    const bowtie = worldPosition(named(model.root, 'skin-bowtie').children[0]);
    expect(bowtie.z).toBeGreaterThan(neck.z + 0.08);
    expect(bowtie.y).toBeLessThan(worldPosition(named(model.root, 'dog-head')).y);
    // +Z local du point d'attache du corps = côté ventre.
    const body = named(model.root, 'attach-body');
    const belly = worldForward(body);
    const capeOffset = centroid(capeVertices(model.root)).sub(worldPosition(body));
    expect(capeOffset.dot(belly)).toBeLessThan(-0.08);
  });

  it('accroche chaque accessoire à son point d’attache', () => {
    const model = build(breed, { head: 'crown', neck: 'bowtie', body: 'cape' });
    expect(named(model.root, 'skin-crown').parent?.name).toBe('attach-head');
    expect(named(model.root, 'skin-bowtie').parent?.name).toBe('attach-neck');
    expect(named(model.root, 'skin-cape-mount').parent?.name).toBe('attach-body');
    // La couronne est posée sur le haut de la tête.
    const crownBox = boxOf(named(model.root, 'skin-crown'));
    const skullBox = boxOf(named(model.root, 'dog-skull'));
    expect(crownBox.max.y).toBeGreaterThan(skullBox.max.y);
    expect(crownBox.min.y).toBeGreaterThan(
      skullBox.min.y + (skullBox.max.y - skullBox.min.y) * 0.5,
    );
  });
});

describe('accessoires', () => {
  // 240 modèles complets : plusieurs secondes selon la machine, d'où le délai allongé.
  it('toutes les combinaisons restent sous le budget de meshes', () => {
    const heads = [null, ...skinsForSlot('head').map((skin) => skin.id)];
    const necks = [null, ...skinsForSlot('neck').map((skin) => skin.id)];
    const bodies = [null, ...skinsForSlot('body').map((skin) => skin.id)];
    let worst = 0;
    for (const breed of BREED_LIST) {
      for (const head of heads) {
        for (const neck of necks) {
          for (const body of bodies) {
            const model = buildRacerModel({
              breed: breed.id,
              skins: { head, neck, body },
              kartColor: '#2e7dd7',
            });
            worst = Math.max(worst, meshesOf(model.root).length);
            model.dispose();
          }
        }
      }
    }
    expect(worst).toBeLessThanOrEqual(MAX_MESHES);
  }, 30_000);

  it('ignore les accessoires inconnus ou mal placés', () => {
    const bare = meshesOf(build('carlin').root).length;
    const invalid = build('carlin', { head: 'cape', neck: 'sombrero', body: 'crown' });
    expect(meshesOf(invalid.root).length).toBe(bare);
    expect(invalid.root.getObjectByName('skin-cape-mount')).toBeUndefined();
  });

  it('le pull remplace la tache claire du poitrail', () => {
    expect(build('chihuahua').root.getObjectByName('dog-chest')).toBeDefined();
    expect(
      build('chihuahua', { ...EMPTY_SKINS, body: 'sweater' }).root.getObjectByName('dog-chest'),
    ).toBeUndefined();
  });

  it('les chapeaux s’adaptent à la taille de la tête', () => {
    const small = named(build('teckel', { ...EMPTY_SKINS, head: 'cap' }).root, 'skin-cap');
    const large = named(build('carlin', { ...EMPTY_SKINS, head: 'cap' }).root, 'skin-cap');
    expect(large.scale.x).toBeGreaterThan(small.scale.x);
  });

  it('les accessoires de cou et le pull s’adaptent au cou et au torse', () => {
    const collar = (breed: BreedId): number =>
      named(build(breed, { ...EMPTY_SKINS, neck: 'bell-collar' }).root, 'skin-bell-collar').scale.x;
    expect(collar('carlin')).toBeGreaterThan(collar('chihuahua') * 1.05);

    const sweaterLength = (breed: BreedId): number => {
      const sweater = named(build(breed, { ...EMPTY_SKINS, body: 'sweater' }).root, 'skin-sweater');
      if (!(sweater instanceof THREE.Mesh)) throw new Error('le pull doit être un mesh');
      sweater.geometry.computeBoundingBox();
      return sweater.geometry.boundingBox?.getSize(new THREE.Vector3()).y ?? 0;
    };
    expect(sweaterLength('teckel')).toBeGreaterThan(sweaterLength('chihuahua') * 1.5);
  });
});

describe('silhouettes', () => {
  it('le teckel est nettement plus long que le chihuahua', () => {
    const teckel = boxOf(named(build('teckel').root, 'dog')).getSize(new THREE.Vector3());
    const chihuahua = boxOf(named(build('chihuahua').root, 'dog')).getSize(new THREE.Vector3());
    expect(teckel.z).toBeGreaterThan(chihuahua.z * 1.8);
  });

  it('les oreilles du chihuahua dépassent le haut de sa tête', () => {
    const root = build('chihuahua').root;
    const dogTop = boxOf(named(root, 'dog')).max.y;
    const skullTop = boxOf(named(root, 'dog-skull')).max.y;
    expect(dogTop - skullTop).toBeGreaterThan(0.2);
  });

  it('seul le teckel dépasse à l’arrière du kart', () => {
    for (const breed of BREED_LIST) {
      const dogBox = boxOf(named(build(breed.id).root, 'dog'));
      if (breed.id === 'teckel') expect(dogBox.min.z).toBeLessThan(-1.05);
      else expect(dogBox.min.z).toBeGreaterThan(-0.9);
    }
  });
});

describe('animation', () => {
  it('fait tourner les roues selon la vitesse et braque les roues avant', () => {
    const model = build('jack-russell');
    const rearSpin = named(model.rearWheels[0], 'wheel-spin');
    const frontMount = named(model.root, 'wheel-front');
    const frontPivot = frontMount.children[0];
    model.update(1 / 60, { ...IDLE, speed: 20 });
    const afterOneStep = rearSpin.rotation.x;
    // Marche avant : le haut de la roue part vers +Z.
    expect(afterOneStep).toBeGreaterThan(0);
    model.update(1 / 60, { ...IDLE, speed: 20 });
    expect(rearSpin.rotation.x).not.toBeCloseTo(afterOneStep, 4);
    // Braquage à droite (steer > 0) : les roues avant pivotent vers -X.
    for (let i = 0; i < 60; i++) model.update(1 / 60, { ...IDLE, speed: 10, steer: 1 });
    expect(frontPivot.rotation.y).toBeLessThan(-0.3);
    expect(worldForward(frontPivot).x).toBeLessThan(-0.3);
    for (let i = 0; i < 60; i++) model.update(1 / 60, { ...IDLE, speed: 10, steer: -1 });
    expect(frontPivot.rotation.y).toBeGreaterThan(0.3);
    expect(worldForward(frontPivot).x).toBeGreaterThan(0.3);
  });

  it('fait rouler les quatre roues sans glisser, en marche avant comme en marche arrière', () => {
    const model = build('teckel');
    const spins: THREE.Object3D[] = [];
    model.root.traverse((object) => {
      if (object.name === 'wheel-spin') spins.push(object);
    });
    expect(spins).toHaveLength(4);
    // Rayon de chaque roue d'après sa boîte englobante (roue au repos).
    const radii = spins.map((spin) => boxOf(spin).getSize(new THREE.Vector3()).y / 2);
    model.update(0.05, { ...IDLE, speed: 6 });
    spins.forEach((spin, i) => expect(spin.rotation.x).toBeCloseTo((6 * 0.05) / radii[i], 2));
    model.update(0.05, { ...IDLE, speed: -6 });
    for (const spin of spins) expect(spin.rotation.x).toBeCloseTo(0, 5);
    model.update(0.05, { ...IDLE, speed: -6 });
    for (const spin of spins) expect(spin.rotation.x).toBeLessThan(0);
    const before = spins.map((spin) => spin.rotation.x);
    model.update(0.05, IDLE);
    spins.forEach((spin, i) => expect(spin.rotation.x).toBe(before[i]));
  });

  it('tourne le volant et le regard du côté du braquage', () => {
    const model = build('carlin');
    const spinner = named(model.root, 'kart-steering');
    const head = named(model.root, 'dog-head');
    // Point du haut de la jante : il part vers la droite du pilote (-X) quand on braque à droite.
    const rimTopOffset = (): number => {
      spinner.updateWorldMatrix(true, false);
      return spinner.localToWorld(new THREE.Vector3(0, 0.17, 0)).x - worldPosition(spinner).x;
    };
    for (let i = 0; i < 60; i++) model.update(1 / 60, { ...IDLE, speed: 15, steer: 1 });
    expect(rimTopOffset()).toBeLessThan(-0.08);
    expect(worldForward(head).x).toBeLessThan(-0.15);
    for (let i = 0; i < 60; i++) model.update(1 / 60, { ...IDLE, speed: 15, steer: -1 });
    expect(rimTopOffset()).toBeGreaterThan(0.08);
    expect(worldForward(head).x).toBeGreaterThan(0.15);
  });

  it('le saut soulève le modèle sans déplacer root', () => {
    const model = build('carlin');
    const restTop = boxOf(model.root).max.y;
    model.update(1 / 60, { ...IDLE, hop: 1 });
    expect(named(model.root, 'kart-lift').position.y).toBeCloseTo(0.35);
    expect(boxOf(model.root).max.y).toBeGreaterThan(restTop + 0.3);
    expect(model.root.position.toArray()).toEqual([0, 0, 0]);
    expect(model.root.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
  });

  it('incline le châssis en dérapage et la tête dans les virages', () => {
    const model = build('teckel');
    for (let i = 0; i < 60; i++)
      model.update(1 / 60, { ...IDLE, speed: 25, steer: 1, driftDirection: 1 });
    const right = named(model.root, 'kart-chassis').rotation.z;
    const headRight = named(model.root, 'dog-head').rotation.z;
    for (let i = 0; i < 60; i++)
      model.update(1 / 60, { ...IDLE, speed: 25, steer: -1, driftDirection: -1 });
    expect(Math.sign(named(model.root, 'kart-chassis').rotation.z)).toBe(-Math.sign(right));
    expect(right).not.toBe(0);
    // steer > 0 (droite) : le haut de la tête penche vers -X (la droite du pilote).
    expect(headRight).toBeGreaterThan(0);
    expect(named(model.root, 'dog-head').rotation.z).toBeLessThan(0);
  });

  it('en dérapage, le châssis roule vers l’extérieur du virage, les roues restent au sol', () => {
    const model = build('jack-russell');
    const steering = named(model.root, 'kart-steering');
    const wheel = model.rearWheels[0];
    const wheelRest = worldPosition(wheel);
    // Dérapage à droite : le haut du châssis part vers la gauche (+X).
    for (let i = 0; i < 60; i++) model.update(1 / 60, { ...IDLE, speed: 20, driftDirection: 1 });
    expect(worldPosition(steering).x).toBeGreaterThan(0.04);
    expect(worldPosition(wheel).distanceTo(wheelRest)).toBeLessThan(1e-9);
    for (let i = 0; i < 60; i++) model.update(1 / 60, { ...IDLE, speed: 20, driftDirection: -1 });
    expect(worldPosition(steering).x).toBeLessThan(-0.04);
    for (let i = 0; i < 120; i++) model.update(1 / 60, { ...IDLE, speed: 20 });
    expect(Math.abs(worldPosition(steering).x)).toBeLessThan(0.005);
  });

  it('les oreilles battent plus fort avec la vitesse et se couchent au vent', () => {
    const model = build('chihuahua');
    const ear = named(model.root, 'dog-ear');
    const fast: RacerVisualState = { ...IDLE, speed: 28 };
    sampleWhile(model, 1, IDLE, () => 0);
    const idleFlap = sampleWhile(model, 2, IDLE, () => ear.rotation.z);
    const idleLean = mean(sampleWhile(model, 2, IDLE, () => ear.rotation.x));
    sampleWhile(model, 1, fast, () => 0);
    const fastFlap = sampleWhile(model, 2, fast, () => ear.rotation.z);
    const fastLean = mean(sampleWhile(model, 2, fast, () => ear.rotation.x));
    expect(spread(idleFlap)).toBeGreaterThan(0.01);
    expect(spread(fastFlap)).toBeGreaterThan(spread(idleFlap) * 3);
    // Oreilles dressées : le vent les rabat vers l'arrière (rotation X négative).
    expect(fastLean).toBeLessThan(idleLean - 0.3);
  });

  it('la queue remue, deux fois plus vite pendant un boost', () => {
    const model = build('jack-russell');
    const tail = named(model.root, 'dog-tail');
    const cruising: RacerVisualState = { ...IDLE, speed: 20 };
    sampleWhile(model, 1, cruising, () => 0);
    const normal = sampleWhile(model, 3, cruising, () => tail.rotation.z);
    const boosted = sampleWhile(model, 3, { ...cruising, boosting: true }, () => tail.rotation.z);
    expect(spread(normal)).toBeGreaterThan(0.8);
    expect(signChanges(normal)).toBeGreaterThanOrEqual(6);
    expect(signChanges(boosted)).toBeGreaterThan(signChanges(normal) * 1.6);
  });

  it('le chien rebondit légèrement, plus fort en roulant', () => {
    const model = build('carlin');
    const dog = named(model.root, 'dog');
    const idle = sampleWhile(model, 2, IDLE, () => dog.position.y);
    sampleWhile(model, 1, { ...IDLE, speed: 25 }, () => 0);
    const driving = sampleWhile(model, 2, { ...IDLE, speed: 25 }, () => dog.position.y);
    expect(spread(driving)).toBeGreaterThan(spread(idle) * 2);
    expect(Math.max(...driving.map(Math.abs))).toBeLessThan(0.05);
  });

  it('la cape se soulève vers l’arrière et ondule avec la vitesse', () => {
    const model = build('chihuahua', { head: 'party-hat', neck: 'bandana', body: 'cape' });
    sampleWhile(model, 1, IDLE, () => 0);
    const rest = centroid(capeVertices(model.root));
    sampleWhile(model, 1.5, { ...IDLE, speed: 28 }, () => 0);
    const flying = centroid(capeVertices(model.root));
    expect(flying.z).toBeLessThan(rest.z - 0.08);
    expect(flying.y).toBeGreaterThan(rest.y + 0.03);
    // Ondulation : la cape n'est pas figée à vitesse constante.
    const before = capeVertices(model.root);
    model.update(1 / 20, { ...IDLE, speed: 28 });
    const moved = capeVertices(model.root).some((vertex, i) => vertex.distanceTo(before[i]) > 1e-3);
    expect(moved).toBe(true);
  });

  it('reste fluide, même après une longue course et un choc', () => {
    const model = build('chihuahua', { ...EMPTY_SKINS, body: 'cape' });
    const ear = named(model.root, 'dog-ear');
    const tail = named(model.root, 'dog-tail');
    // Cinq minutes de course : la phase des animations ne doit pas dépendre du temps écoulé.
    for (let i = 0; i < 30; i++) model.update(10, IDLE);
    let previous = { ear: ear.rotation.x, tail: tail.rotation.z, cape: capeVertices(model.root) };
    let worst = { ear: 0, tail: 0, cape: 0 };
    const step = (speed: number): void => {
      model.update(1 / 60, { ...IDLE, speed });
      const current = {
        ear: ear.rotation.x,
        tail: tail.rotation.z,
        cape: capeVertices(model.root),
      };
      worst = {
        ear: Math.max(worst.ear, Math.abs(current.ear - previous.ear)),
        tail: Math.max(worst.tail, Math.abs(current.tail - previous.tail)),
        cape: Math.max(
          worst.cape,
          ...current.cape.map((vertex, i) => vertex.distanceTo(previous.cape[i])),
        ),
      };
      previous = current;
    };
    // Accélération progressive, puis choc : la vitesse tombe à 30 %.
    for (let i = 0; i < 120; i++) step(i * 0.25);
    for (let i = 0; i < 30; i++) step(9);
    expect(worst.tail).toBeLessThan(0.15);
    expect(worst.ear).toBeLessThan(0.1);
    expect(worst.cape).toBeLessThan(0.05);
  });

  it('supporte des états extrêmes sans exception ni NaN', () => {
    const model = build('carlin', { head: 'beanie', neck: 'bell-collar', body: 'cape' });
    const states: RacerVisualState[] = [
      IDLE,
      { speed: -8, steer: -1, driftDirection: -1, boosting: false, spinning: true, hop: 0.5 },
      { speed: 45, steer: 1, driftDirection: 1, boosting: true, spinning: false, hop: 1 },
      { speed: Number.NaN, steer: 3, driftDirection: 0, boosting: true, spinning: true, hop: -2 },
    ];
    for (const dt of [1 / 60, 0, -1, 0.5, Number.NaN]) {
      for (const state of states) expect(() => model.update(dt, state)).not.toThrow();
    }
    model.root.updateMatrixWorld(true);
    model.root.traverse((object) => {
      for (const value of object.matrixWorld.elements) expect(Number.isFinite(value)).toBe(true);
    });
  });
});

describe('reflets', () => {
  it.each(BREED_LIST.map((breed) => breed.id))(
    'seules la coque, les chromes, la truffe et les yeux reflètent l’image d’environnement (%s)',
    (breed) => {
      const model = build(
        breed,
        { head: 'crown', neck: 'bell-collar', body: 'cape' },
        '#d7322e',
        environment,
      );
      const reflective = new Set<string>();
      for (const mesh of meshesOf(model.root)) {
        for (const material of materialsOf(mesh)) {
          const envMap = envMapOf(material);
          if ((REFLECTIVE_PARTS as readonly string[]).includes(mesh.name)) {
            expect(envMap, mesh.name).toBe(environment);
            expect(envMap?.mapping, mesh.name).toBe(THREE.EquirectangularReflectionMapping);
            reflective.add(mesh.name);
          } else {
            // Ni la fourrure, ni les accessoires (couronne et grelot compris), ni le reste du kart.
            expect(envMap, mesh.name).toBeNull();
          }
        }
      }
      expect([...reflective].sort()).toEqual([...REFLECTIVE_PARTS].sort());
    },
  );

  it('coque vernie, vrais chromes, truffe et yeux brillants', () => {
    const root = build('carlin', EMPTY_SKINS, '#d7322e', environment).root;
    const body = materialOf(root, 'kart-hood');
    expect(body).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const varnish = body as THREE.MeshPhysicalMaterial;
    expect(varnish.clearcoat).toBeGreaterThanOrEqual(0.8);
    expect(varnish.roughness).toBeCloseTo(0.35, 2);
    expect(varnish.envMapIntensity).toBeCloseTo(0.5, 2);
    // Les pontons, le nez et le capot partagent le même matériau.
    for (const part of ['kart-pod', 'kart-nose']) {
      expect(materialOf(root, part), part).toBe(body);
    }
    for (const part of CHROME_PARTS) {
      const chrome = materialOf(root, part) as THREE.MeshStandardMaterial;
      expect(chrome.metalness, part).toBeGreaterThanOrEqual(0.9);
      expect(chrome.metalness, part).toBeLessThanOrEqual(1);
      expect(chrome.roughness, part).toBeGreaterThanOrEqual(0.25);
      expect(chrome.roughness, part).toBeLessThanOrEqual(0.35);
      expect(chrome.envMapIntensity, part).toBeCloseTo(1, 1);
    }
    for (const part of ['dog-nose', 'dog-eye-whites', 'dog-pupils']) {
      const glossy = materialOf(root, part) as THREE.MeshStandardMaterial;
      expect(glossy.roughness, part).toBeLessThanOrEqual(0.3);
      expect(glossy.envMapIntensity, part).toBeGreaterThan(0);
    }
  });

  it('les reflets des yeux restent blancs à l’ombre : non éclairés, sans tone mapping', () => {
    const model = build('chihuahua', EMPTY_SKINS, '#d7322e', environment);
    const shine = materialOf(model.root, 'dog-eye-shines');
    expect(shine).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(shine.toneMapped).toBe(false);
    expect((shine as THREE.MeshBasicMaterial).color.getHexString()).toBe('ffffff');
  });

  it('n’ajoute ni maillage ni matériau : autant d’appels de dessin qu’avant', () => {
    const skins: SkinSelection = { head: 'party-hat', neck: 'bandana', body: 'cape' };
    for (const breed of BREED_LIST) {
      const count = (reflections: THREE.Texture | null): [number, number] => {
        const meshes = meshesOf(build(breed.id, skins, '#d7322e', reflections).root);
        return [meshes.length, new Set(meshes.flatMap(materialsOf)).size];
      };
      expect(count(environment), breed.id).toEqual(count(null));
    }
  });

  it('rend ses matériaux au cache sans libérer l’image d’environnement, qui appartient à la course', () => {
    const materials = sharedMaterials.size;
    const onDispose = (): void => {
      throw new Error('image d’environnement libérée par le modèle');
    };
    environment.addEventListener('dispose', onDispose);
    const model = buildRacerModel({
      breed: 'teckel',
      skins: EMPTY_SKINS,
      kartColor: '#2eb86a',
      environment,
    });
    expect(sharedMaterials.size).toBeGreaterThan(materials);
    expect(() => model.dispose()).not.toThrow();
    environment.removeEventListener('dispose', onDispose);
    expect(sharedMaterials.size).toBe(materials);
  });
});

/** Groupes qui tournent avec la vitesse (un par roue). */
function wheelSpins(root: THREE.Object3D): THREE.Object3D[] {
  const spins: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === 'wheel-spin') spins.push(object);
  });
  return spins;
}

function meshNamed(root: THREE.Object3D, name: string): THREE.Mesh {
  const object = named(root, name);
  if (!(object instanceof THREE.Mesh)) throw new Error(`${name} doit être un mesh`);
  return object;
}

/** Sommets d'une pièce de roue dans le repère de sa rotation (axe de la roue : X). */
function wheelVertices(mesh: THREE.Mesh): THREE.Vector3[] {
  mesh.updateMatrix();
  const positions = mesh.geometry.getAttribute('position');
  const vertices: THREE.Vector3[] = [];
  for (let i = 0; i < positions.count; i++)
    vertices.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrix));
  return vertices;
}

/** Distance à l'axe de la roue. */
const radial = (vertex: THREE.Vector3): number => Math.hypot(vertex.y, vertex.z);

/** Angle autour de l'axe de la roue, dans [0, 2π[. */
function azimuth(vertex: THREE.Vector3): number {
  const angle = Math.atan2(vertex.z, vertex.y);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

/**
 * Îlots d'une géométrie : groupes de sommets reliés par des triangles, les sommets confondus
 * (coutures, couvercles) étant soudés. Du plus grand au plus petit.
 */
function islands(mesh: THREE.Mesh): THREE.Vector3[][] {
  const vertices = wheelVertices(mesh);
  const parent = vertices.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    parent[i] = root;
    return root;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const welded = new Map<string, number>();
  vertices.forEach((vertex, i) => {
    const key = vertex
      .toArray()
      .map((value) => Math.round(value * 1e4))
      .join(':');
    const first = welded.get(key);
    if (first === undefined) welded.set(key, i);
    else union(i, first);
  });
  const index = mesh.geometry.index;
  const count = index ? index.count : vertices.length;
  const at = (k: number): number => (index ? index.getX(k) : k);
  for (let k = 0; k + 2 < count; k += 3) {
    union(at(k), at(k + 1));
    union(at(k), at(k + 2));
  }
  const groups = new Map<number, THREE.Vector3[]>();
  vertices.forEach((vertex, i) => {
    const root = find(i);
    const group = groups.get(root) ?? [];
    group.push(vertex);
    groups.set(root, group);
  });
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

const boxCenter = (points: readonly THREE.Vector3[]): THREE.Vector3 =>
  new THREE.Box3().setFromPoints([...points]).getCenter(new THREE.Vector3());

describe('livrée et roues', () => {
  it('livrée bicolore : plancher sombre comme les garnitures, carrosserie à la couleur du pilote', () => {
    for (const reflections of [null, environment]) {
      const root = build('jack-russell', EMPTY_SKINS, '#2e7dd7', reflections).root;
      const trim = materialOf(root, 'kart-bumper') as THREE.MeshStandardMaterial;
      expect(materialOf(root, 'kart-floor')).toBe(trim);
      // Garnitures sombres, sans reflet.
      expect(trim.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.2);
      expect(envMapOf(trim)).toBeNull();
      // Pontons, nez et capot : de quoi reconnaître le pilote de dos comme de face.
      for (const part of ['kart-pod', 'kart-nose', 'kart-hood']) {
        const body = materialOf(root, part) as THREE.MeshStandardMaterial;
        expect(body.color.getHexString(), part).toBe(new THREE.Color('#2e7dd7').getHexString());
      }
    }
  });

  it('aucun maillage en plus : deux par roue (pneu et jante), 22 ou 23 pour le kart', () => {
    for (const breed of BREED_LIST) {
      const root = build(breed.id, { head: 'party-hat', neck: 'bandana', body: 'cape' }).root;
      for (const spin of wheelSpins(root)) {
        expect(meshesOf(spin).map((mesh) => mesh.name).sort(), breed.id).toEqual(['rim', 'tire']);
      }
      const dog = new Set(meshesOf(named(root, 'dog')));
      const kart = meshesOf(root).filter((mesh) => !dog.has(mesh));
      // Coque (5), bande, pare-chocs, moteur, siège et dossier, direction (3), pots (2), roues (8).
      expect(kart.length, breed.id).toBe(BREEDS[breed.id].look.seatBack ? 23 : 22);
    }
  });

  it('jantes rondes et lisses : 16 à 24 segments, sans ombrage plat', () => {
    const root = build('teckel').root;
    const spins = wheelSpins(root);
    expect(spins).toHaveLength(4);
    for (const spin of spins) {
      const rim = meshNamed(spin, 'rim');
      expect((rim.material as THREE.MeshStandardMaterial).flatShading).toBe(false);
      const vertices = wheelVertices(rim);
      const lip = Math.max(...vertices.map(radial));
      // Angles distincts sur le bord de la jante (couture comprise : 2π ≡ 0).
      const turn = Math.round(Math.PI * 2 * 1e3);
      const angles = new Set(
        vertices
          .filter((vertex) => radial(vertex) > lip * 0.8)
          .map((vertex) => Math.round(azimuth(vertex) * 1e3) % turn),
      );
      expect(angles.size).toBeGreaterThanOrEqual(16);
      expect(angles.size).toBeLessThanOrEqual(24);
    }
  });

  it('moyeu sombre fusionné dans le pneu, en saillie au fond de la jante', () => {
    const root = build('carlin').root;
    for (const spin of wheelSpins(root)) {
      const tire = meshNamed(spin, 'tire');
      const tireMaterial = tire.material as THREE.MeshStandardMaterial;
      expect(tireMaterial.color.getHSL({ h: 0, s: 0, l: 0 }).l).toBeLessThan(0.15);
      const vertices = wheelVertices(tire);
      const radius = Math.max(...vertices.map(radial));
      const halfWidth = Math.max(
        ...vertices
          .filter((vertex) => radial(vertex) > radius * 0.7)
          .map((vertex) => Math.abs(vertex.x)),
      );
      // Le moyeu ferme le centre de la roue, sur les deux faces…
      const hub = vertices.filter((vertex) => radial(vertex) < radius * 0.1);
      expect(hub.some((vertex) => vertex.x > 0)).toBe(true);
      expect(hub.some((vertex) => vertex.x < 0)).toBe(true);
      const hubFace = Math.max(...hub.map((vertex) => Math.abs(vertex.x)));
      // … dépasse du fond de la jante, sans sortir du pneu.
      const [rimBody] = islands(meshNamed(spin, 'rim'));
      const innerRing = Math.min(...rimBody.map(radial));
      const rimBottom = Math.max(
        ...rimBody
          .filter((vertex) => radial(vertex) < innerRing + 1e-3)
          .map((vertex) => Math.abs(vertex.x)),
      );
      expect(hubFace).toBeGreaterThan(rimBottom + 0.005);
      expect(hubFace).toBeLessThan(halfWidth);
    }
  });

  it('écrous fusionnés dans la jante, en couronne régulière sur les deux faces', () => {
    const root = build('chihuahua').root;
    for (const spin of wheelSpins(root)) {
      const [rimBody, ...nuts] = islands(meshNamed(spin, 'rim'));
      const lip = Math.max(...rimBody.map(radial));
      const centers = nuts.map(boxCenter);
      const outer = centers.filter((center) => center.x > 0);
      const inner = centers.filter((center) => center.x < 0);
      expect(outer.length).toBeGreaterThanOrEqual(3);
      expect(outer.length).toBeLessThanOrEqual(6);
      expect(inner).toHaveLength(outer.length);
      const ring = radial(outer[0]);
      expect(ring).toBeLessThan(lip * 0.5);
      for (const center of centers) expect(radial(center)).toBeCloseTo(ring, 3);
      const angles = outer.map(azimuth).sort((a, b) => a - b);
      const step = (Math.PI * 2) / angles.length;
      angles.forEach((angle, i) => {
        const next = i + 1 < angles.length ? angles[i + 1] : angles[0] + Math.PI * 2;
        expect(next - angle).toBeCloseTo(step, 2);
      });
    }
  });
});

describe('dispose', () => {
  it('libère toutes les ressources quand plus aucun modèle ne les utilise', () => {
    const geometries = sharedGeometries.size;
    const materials = sharedMaterials.size;
    const model = buildRacerModel({
      breed: 'teckel',
      skins: { head: 'party-hat', neck: 'bandana', body: 'sweater' },
      kartColor: '#2eb86a',
    });
    expect(sharedGeometries.size).toBeGreaterThan(geometries);
    const parent = new THREE.Group();
    parent.add(model.root);
    model.dispose();
    expect(sharedGeometries.size).toBe(geometries);
    expect(sharedMaterials.size).toBe(materials);
    expect(model.root.parent).toBeNull();
    expect(() => model.dispose()).not.toThrow();
    expect(() => model.update(1 / 60, IDLE)).not.toThrow();
  });

  it('ne casse pas un autre modèle qui partage les mêmes ressources', () => {
    const skins: SkinSelection = { head: 'crown', neck: 'bandana', body: 'cape' };
    const first = build('jack-russell', skins);
    const second = build('jack-russell', skins);
    const disposed = new Set<unknown>();
    for (const mesh of meshesOf(second.root)) {
      mesh.geometry.addEventListener('dispose', () => disposed.add(mesh.geometry));
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials)
        material.addEventListener('dispose', () => disposed.add(material));
    }
    first.dispose();
    expect(disposed.size).toBe(0);
    expect(() => second.update(1 / 60, { ...IDLE, speed: 20 })).not.toThrow();
    second.dispose();
    expect(disposed.size).toBeGreaterThan(0);
  });

  it('un modèle construit après dispose reçoit des ressources neuves', () => {
    const first = buildRacerModel({ breed: 'chihuahua', skins: EMPTY_SKINS, kartColor: '#d7322e' });
    const old = new Set(meshesOf(first.root).map((mesh) => mesh.geometry));
    first.dispose();
    const second = build('chihuahua');
    for (const mesh of meshesOf(second.root)) expect(old.has(mesh.geometry)).toBe(false);
    expect(() => second.update(1 / 60, { ...IDLE, speed: 15 })).not.toThrow();
  });
});
