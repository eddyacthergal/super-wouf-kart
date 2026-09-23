import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ITEMS } from '../core/constants';
import type { GameEvent, ItemEntity, RaceState, TrackQuery } from '../core/types';
import { forwardOf, lerpAngle } from '../core/vec2';
import { createTestRace } from '../testing/fixtures';
import { createGardenTrack } from '../track/track';
import { RaceScene, type RaceSceneOptions } from './race-scene';

const DT = 1 / 60;
const scenes: RaceScene[] = [];
let track: TrackQuery;

beforeAll(() => {
  track = createGardenTrack();
});

afterEach(() => {
  for (const scene of scenes.splice(0)) scene.dispose();
});

function setup(
  options: RaceSceneOptions = { reducedMotion: false },
  count = 8,
): { scene: RaceScene; race: RaceState } {
  const race = createTestRace(track, count);
  const scene = new RaceScene(track, race.racers, options);
  scenes.push(scene);
  return { scene, race };
}

function racerRoot(scene: RaceScene, id: number): THREE.Object3D {
  let found: THREE.Object3D | undefined;
  scene.scene.traverse((object) => {
    if (object.userData['racerId'] === id) found = object;
  });
  if (!found) throw new Error(`pilote ${id} introuvable`);
  return found;
}

function run(scene: RaceScene, race: RaceState, frames: number, events: GameEvent[] = []): void {
  for (let i = 0; i < frames; i++) scene.update(race, 1, DT, i === 0 ? events : []);
}

function entity(id: number, kind: ItemEntity['kind'], x: number, z: number): ItemEntity {
  return {
    id,
    kind,
    ownerId: 0,
    position: { x, z },
    prevPosition: { x: x - 0.5, z },
    heading: 0,
    speed: kind === 'mud' ? 0 : 40,
    life: 5,
    bounces: 0,
    targetId: null,
    trackIndex: 0,
    armTime: 0,
  };
}

/** Distance à la ligne médiane, calculée indépendamment (segments entre échantillons). */
function centerlineDistance(x: number, z: number): number {
  let best = Infinity;
  const samples = track.samples;
  for (let i = 0; i < samples.length; i++) {
    const a = samples[i].position;
    const b = samples[(i + 1) % samples.length].position;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)),
    );
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)));
  }
  return best;
}

describe('RaceScene', () => {
  it('se construit sans WebGL avec le jardin et 8 pilotes', () => {
    const { scene, race } = setup();
    expect(scene.scene).toBeInstanceOf(THREE.Scene);
    expect(scene.camera).toBeInstanceOf(THREE.PerspectiveCamera);
    for (const racer of race.racers) expect(racerRoot(scene, racer.id)).toBeDefined();
    for (const name of [
      'garden-world',
      'sky',
      'sun-light',
      'hemisphere-light',
      'items',
      'effects',
    ]) {
      expect(scene.scene.getObjectByName(name), name).toBeDefined();
    }
    expect(scene.scene.fog).toBeInstanceOf(THREE.Fog);
    expect(() => scene.update(race, 1, DT, [])).not.toThrow();
  });

  it('place chaque pilote à la position interpolée et l’oriente selon cap + visualYaw', () => {
    const { scene, race } = setup();
    for (const racer of race.racers) {
      const kart = racer.kart;
      kart.prevPosition = { x: kart.position.x, z: kart.position.z };
      kart.position = { x: kart.position.x + 2, z: kart.position.z - 1 };
      kart.prevHeading = kart.heading;
      kart.heading = kart.heading + 0.3;
      kart.visualYaw = 0.12;
    }
    for (const alpha of [0, 0.5, 1]) {
      scene.update(race, alpha, DT, []);
      for (const racer of race.racers) {
        const root = racerRoot(scene, racer.id);
        const kart = racer.kart;
        expect(root.position.x).toBeCloseTo(
          kart.prevPosition.x + (kart.position.x - kart.prevPosition.x) * alpha,
          6,
        );
        expect(root.position.z).toBeCloseTo(
          kart.prevPosition.z + (kart.position.z - kart.prevPosition.z) * alpha,
          6,
        );
        expect(root.position.y).toBe(0);
        expect(root.rotation.y).toBeCloseTo(
          lerpAngle(kart.prevHeading, kart.heading, alpha) + kart.visualYaw,
          6,
        );
      }
    }
  });

  it('crée puis retire les objets lancés (diff par id)', () => {
    const { scene, race } = setup();
    const player = race.racers[0].kart.position;
    race.items.push(
      entity(7, 'bone', player.x, player.z + 5),
      entity(8, 'tennis-ball', player.x, player.z + 8),
    );
    race.items.push(entity(9, 'mud', player.x + 1, player.z - 4));
    scene.update(race, 1, DT, []);
    for (const id of [7, 8, 9])
      expect(scene.scene.getObjectByName(`item-entity-${id}`), `${id}`).toBeDefined();
    // Interpolation prevPosition → position.
    scene.update(race, 0, DT, []);
    expect(scene.scene.getObjectByName('item-entity-7')!.position.x).toBeCloseTo(player.x - 0.5);

    race.items.splice(0, 1);
    scene.update(race, 1, DT, []);
    expect(scene.scene.getObjectByName('item-entity-7')).toBeUndefined();
    expect(scene.scene.getObjectByName('item-entity-8')).toBeDefined();
    race.items.length = 0;
    scene.update(race, 1, DT, []);
    expect(scene.scene.getObjectByName('item-entity-8')).toBeUndefined();
    expect(scene.scene.getObjectByName('item-entity-9')).toBeUndefined();
  });

  it('masque une boîte en attente de réapparition, puis la fait réapparaître', () => {
    const { scene, race } = setup();
    const sample = track.sampleAt(track.itemBoxRows[0]);
    race.itemBoxes.push(
      { id: 0, position: { ...sample.position }, respawn: 0 },
      { id: 1, position: { x: sample.position.x + 3, z: sample.position.z }, respawn: 2 },
    );
    scene.update(race, 1, DT, []);
    const ready = scene.scene.getObjectByName('item-box-0')!;
    const waiting = scene.scene.getObjectByName('item-box-1')!;
    expect(ready.visible).toBe(true);
    expect(ready.scale.x).toBeGreaterThan(0.9);
    expect(!waiting.visible || waiting.scale.x < 0.5).toBe(true);

    race.itemBoxes[1].respawn = 0;
    scene.update(race, 1, DT, []);
    expect(waiting.visible).toBe(true);
    expect(waiting.scale.x).toBeLessThan(0.5);
    run(scene, race, 60);
    expect(waiting.scale.x).toBeCloseTo(1, 3);
  });

  it('place la caméra derrière et au-dessus du joueur, dès la première image', () => {
    const { scene, race } = setup();
    scene.update(race, 1, DT, []);
    const kart = race.racers[0].kart;
    const forward = forwardOf(kart.heading);
    const camera = scene.camera.position;
    const back = { x: camera.x - kart.position.x, z: camera.z - kart.position.z };
    expect(back.x * forward.x + back.z * forward.z).toBeLessThan(-5);
    expect(camera.y).toBeGreaterThan(2);
    // Elle regarde dans le sens de la course (pas de glissement depuis un cap nul).
    const view = scene.camera.getWorldDirection(new THREE.Vector3());
    expect(view.x * forward.x + view.z * forward.z).toBeGreaterThan(0.9);
  });

  it('suit le joueur désigné par playerId, ou le premier pilote si playerId = -1', () => {
    const { scene, race } = setup();
    race.playerId = 3;
    run(scene, race, 5);
    const followed = race.racers[3].kart;
    const forward = forwardOf(followed.heading);
    const camera = scene.camera.position;
    const back = { x: camera.x - followed.position.x, z: camera.z - followed.position.z };
    expect(Math.hypot(back.x, back.z)).toBeLessThan(10);
    expect(back.x * forward.x + back.z * forward.z).toBeLessThan(0);

    const other = setup();
    other.race.playerId = -1;
    expect(() => run(other.scene, other.race, 3)).not.toThrow();
    const first = other.race.racers[0].kart.position;
    const distance = Math.hypot(
      other.scene.camera.position.x - first.x,
      other.scene.camera.position.z - first.z,
    );
    expect(distance).toBeLessThan(10);
  });

  it('reste derrière le joueur pendant le compte à rebours et orbite après l’arrivée', () => {
    const { scene, race } = setup();
    race.phase = 'countdown';
    race.countdown = 3;
    scene.update(race, 1, DT, []);
    const kart = race.racers[0].kart;
    const forward = forwardOf(kart.heading);
    const camera = scene.camera.position;
    expect(
      (camera.x - kart.position.x) * forward.x + (camera.z - kart.position.z) * forward.z,
    ).toBeLessThan(0);

    race.phase = 'finished';
    run(scene, race, 1);
    const start = scene.camera.position.clone();
    run(scene, race, 240);
    const end = scene.camera.position;
    expect(end.distanceTo(start)).toBeGreaterThan(2);
    // Toujours à distance raisonnable du kart.
    expect(Math.hypot(end.x - kart.position.x, end.z - kart.position.z)).toBeLessThan(12);
  });

  it('centre la boîte d’ombre du soleil (±45 m, 2048²) sur le joueur, où qu’il soit', () => {
    const { scene, race } = setup();
    const sun = scene.scene.getObjectByName('sun-light') as THREE.DirectionalLight;
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBe(2048);
    const shadowCamera = sun.shadow.camera;
    expect([shadowCamera.left, shadowCamera.right, shadowCamera.top, shadowCamera.bottom]).toEqual([
      -45, 45, 45, -45,
    ]);
    const kart = race.racers[0].kart;
    for (const shift of [0, 150]) {
      kart.position = { x: kart.position.x + shift, z: kart.position.z - shift };
      kart.prevPosition = { ...kart.position };
      scene.update(race, 1, DT, []);
      // Recalage sur la grille de texels : écart inférieur à un texel (90 m / 2048).
      const target = sun.target.position;
      expect(
        Math.hypot(target.x - kart.position.x, target.y, target.z - kart.position.z),
      ).toBeLessThan(0.05);
      const toSun = sun.position.clone().sub(target).normalize();
      expect(toSun.y).toBeGreaterThan(0.5);
    }
  });

  it('élargit le champ de vision en boost, sauf si « réduire les animations »', () => {
    const normal = setup({ reducedMotion: false });
    normal.race.racers[0].kart.boostTime = 5;
    run(normal.scene, normal.race, 60);
    expect(normal.scene.camera.fov).toBeGreaterThan(70);

    const reduced = setup({ reducedMotion: true });
    reduced.race.racers[0].kart.boostTime = 5;
    run(reduced.scene, reduced.race, 60);
    expect(reduced.scene.camera.fov).toBe(65);
  });

  it('secoue la caméra sur un impact ou une haie du joueur, sauf si « réduire les animations »', () => {
    const measure = (reducedMotion: boolean, events: GameEvent[]): number => {
      const { scene, race } = setup({ reducedMotion });
      run(scene, race, 2);
      const calm = scene.camera.position.clone();
      scene.update(race, 1, DT, events);
      scene.update(race, 1, DT, []);
      return scene.camera.position.distanceTo(calm);
    };
    const hit: GameEvent[] = [{ type: 'hit', racerId: 0, by: 'bone', ownerId: 1 }];
    const wall: GameEvent[] = [{ type: 'wall', racerId: 0, intensity: 0.8 }];
    expect(measure(false, hit)).toBeGreaterThan(0.01);
    expect(measure(false, wall)).toBeGreaterThan(0.01);
    expect(measure(true, hit)).toBeLessThan(1e-9);
    expect(measure(true, wall)).toBeLessThan(1e-9);
    // Les chocs des autres pilotes ne secouent pas la caméra.
    const others: GameEvent[] = [
      { type: 'hit', racerId: 4, by: 'bone', ownerId: 0 },
      { type: 'wall', racerId: 5, intensity: 1 },
    ];
    expect(measure(false, others)).toBeLessThan(1e-9);
  });

  it('affiche flammes de boost, étoiles de tête-à-queue et particules', () => {
    const { scene, race } = setup();
    const kart = race.racers[2].kart;
    kart.boostTime = 1;
    kart.boostStrength = 1.28;
    race.racers[3].kart.spinTime = 0.8;
    race.racers[1].kart.drift = { active: true, direction: 1, charge: 1.7, tier: 2 };
    race.racers[1].kart.speed = 20;
    race.racers[4].kart.offroad = true;
    race.racers[4].kart.speed = 15;
    run(scene, race, 10, [{ type: 'hit', racerId: 5, by: 'tennis-ball', ownerId: 0 }]);

    const flames: THREE.Object3D[] = [];
    racerRoot(scene, 2).traverse((object) => {
      if (object.name === 'boost-flame') flames.push(object);
    });
    expect(flames.length).toBe(2);
    expect(flames.every((flame) => flame.visible)).toBe(true);
    const stars = scene.scene.getObjectByName('spin-stars') as THREE.InstancedMesh;
    expect(stars.count).toBe(3);
    const glow = scene.scene.getObjectByName('particles-glow') as THREE.Points;
    const alphas = glow.geometry.getAttribute('alpha');
    let lit = 0;
    for (let i = 0; i < alphas.count; i++) if (alphas.getX(i) > 0) lit++;
    expect(lit).toBeGreaterThan(10);

    kart.boostTime = 0;
    race.racers[3].kart.spinTime = 0;
    run(scene, race, 1);
    expect(flames.every((flame) => !flame.visible)).toBe(true);
    expect(stars.count).toBe(0);
  });

  it('ne place aucun élément de décor dans le couloir du circuit', () => {
    const { scene } = setup();
    const decor = scene.scene.getObjectByName('garden-decor')!;
    decor.updateMatrixWorld(true);
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    let checked = 0;
    decor.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) {
        for (let i = 0; i < object.count; i++) {
          object.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix.premultiply(object.matrixWorld));
          expect(centerlineDistance(position.x, position.z), object.name).toBeGreaterThan(
            track.wallHalfWidth,
          );
          checked++;
        }
      } else if (object instanceof THREE.Mesh) {
        object.getWorldPosition(position);
        expect(centerlineDistance(position.x, position.z), object.name).toBeGreaterThan(
          track.wallHalfWidth,
        );
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(500);
  });

  it('libère toutes les géométries, matériaux et textures au dispose(), sans erreur', () => {
    const { scene, race } = setup();
    race.items.push(entity(3, 'bone', 0, 0));
    race.itemBoxes.push({ id: 0, position: { x: 0, z: 0 }, respawn: 0 });
    run(scene, race, 3);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    scene.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        geometries.add(object.geometry);
        for (const material of [object.material].flat()) {
          materials.add(material);
          if (material instanceof THREE.MeshStandardMaterial && material.map) {
            textures.add(material.map);
          }
        }
      }
    });
    expect(geometries.size).toBeGreaterThan(30);
    expect(textures.size).toBeGreaterThanOrEqual(4);
    const geometrySpies = [...geometries].map((geometry) => vi.spyOn(geometry, 'dispose'));
    const materialSpies = [...materials].map((material) => vi.spyOn(material, 'dispose'));
    const textureSpies = [...textures].map((texture) => vi.spyOn(texture, 'dispose'));
    scenes.splice(scenes.indexOf(scene), 1);
    expect(() => scene.dispose()).not.toThrow();
    for (const spy of geometrySpies) expect(spy).toHaveBeenCalled();
    for (const spy of materialSpies) expect(spy).toHaveBeenCalled();
    for (const spy of textureSpies) expect(spy).toHaveBeenCalled();
    expect(scene.scene.children.length).toBe(0);
    // Idempotent, et sans effet après coup.
    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.update(race, 1, DT, [])).not.toThrow();
  });

  it('ajuste le rapport largeur/hauteur de la caméra', () => {
    const { scene } = setup();
    scene.setAspect(2);
    expect(scene.camera.aspect).toBe(2);
    scene.setAspect(0);
    expect(scene.camera.aspect).toBe(2);
  });

  it('garde la flaque à sa taille de jeu une fois posée', () => {
    const { scene, race } = setup();
    race.items.push(entity(4, 'mud', 0, 0));
    run(scene, race, 60);
    expect(scene.scene.getObjectByName('item-entity-4')!.scale.x).toBeCloseTo(ITEMS.mudRadius);
  });
});
