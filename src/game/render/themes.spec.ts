import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRACK_CATALOG, findTrack } from '../track/catalog';
import { createTrack } from '../track/track';
import type { ThemeWorld } from './scene-theme';
import { SCENE_THEMES } from './themes';

function build(id: string): { world: ThemeWorld; track: ReturnType<typeof createTrack> } {
  const definition = findTrack(id);
  const track = createTrack(definition);
  return { world: SCENE_THEMES[definition.theme].buildWorld(track, definition.decor), track };
}

function positionOf(world: ThemeWorld, name: string): THREE.Vector3 {
  const object = world.root.getObjectByName(name);
  if (!object) throw new Error(`${name} introuvable`);
  return object.getWorldPosition(new THREE.Vector3());
}

describe('thèmes de rendu', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(TRACK_CATALOG.map((track) => [track.name, track.id] as const))(
    '%s : monde construit, animé puis libéré sans erreur three.js',
    (_name, id) => {
      const error = vi.spyOn(console, 'error');
      const warn = vi.spyOn(console, 'warn');
      const { world } = build(id);
      expect(world.root.children.length).toBeGreaterThan(4);
      world.update(0, new THREE.Vector3());
      world.update(5, new THREE.Vector3(30, 2, -20));
      world.dispose();
      expect(error).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('neige : les flocons tombent autour de la caméra, où qu’elle soit', () => {
    const { world } = build('parc-enneige');
    const camera = new THREE.Vector3(80, 3, -60);
    world.update(12, camera);
    const snow = world.root.getObjectByName('snowfall') as THREE.Points;
    const positions = snow.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i += 97) {
      expect(Math.abs(positions.getX(i) - camera.x)).toBeLessThanOrEqual(56);
      expect(Math.abs(positions.getZ(i) - camera.z)).toBeLessThanOrEqual(56);
      expect(positions.getY(i)).toBeGreaterThanOrEqual(0);
    }
    world.dispose();
  });

  it('plage : la mer est au-delà du circuit, rien de posé dans l’eau', () => {
    const { world, track } = build('plage');
    const sea = world.root.getObjectByName('sea-water') as THREE.Mesh;
    sea.geometry.computeBoundingBox();
    const shore = sea.position.z + (sea.geometry.boundingBox?.min.z ?? 0);
    const farthest = Math.max(...track.samples.map((sample) => sample.position.z));
    expect(shore).toBeGreaterThan(farthest + track.wallHalfWidth + 20);
    for (const name of ['palm-trunks', 'beach-props', 'crabs']) {
      const object = world.root.getObjectByName(name);
      expect(object).toBeDefined();
    }
    const props = world.root.getObjectByName('beach-props');
    props?.children.forEach((child) => expect(child.position.z).toBeLessThan(shore));
    world.dispose();
  });

  it('plage : mouettes, crabes et dauphins bougent avec le temps', () => {
    const { world } = build('plage');
    world.update(0, new THREE.Vector3());
    const gull = positionOf(world, 'gull');
    const crab = positionOf(world, 'crab');
    world.update(2, new THREE.Vector3());
    expect(positionOf(world, 'gull').distanceTo(gull)).toBeGreaterThan(1);
    expect(positionOf(world, 'crab').distanceTo(crab)).toBeGreaterThan(0.05);

    // Chaque dauphin saute au moins une fois par cycle de 7 s.
    const dolphins = world.root.getObjectByName('dolphins');
    const seen = new Set<THREE.Object3D>();
    for (let t = 0; t < 7; t += 0.1) {
      world.update(t, new THREE.Vector3());
      dolphins?.children.forEach((dolphin) => {
        if (dolphin.visible && dolphin.position.y > 1) seen.add(dolphin);
      });
    }
    expect(seen.size).toBe(dolphins?.children.length);
    world.dispose();
  });
});
