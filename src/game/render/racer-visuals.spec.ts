import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIFT } from '../core/constants';
import type { RaceState } from '../core/types';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { type NameTagFactory, RacerVisuals } from './racer-visuals';
import { DisposalBag } from './resources';

const DT = 1 / 60;
const track = createCircleTrack(60);
const bags: DisposalBag[] = [];
const visuals: RacerVisuals[] = [];

/** Texture d'étiquette factice (les vraies demandent un canvas 2D, absent en Node). */
const fakeTag: NameTagFactory = () => new THREE.DataTexture(new Uint8Array(4), 1, 1);

function setup(factory?: NameTagFactory): { racers: RacerVisuals; race: RaceState } {
  const race = createTestRace(track, 4);
  const bag = new DisposalBag();
  const racers = new RacerVisuals(race.racers, bag, factory);
  bags.push(bag);
  visuals.push(racers);
  return { racers, race };
}

afterEach(() => {
  for (const racers of visuals.splice(0)) racers.dispose();
  for (const bag of bags.splice(0)) bag.dispose();
});

describe('RacerVisuals', () => {
  it('traduit l’état du kart en pose du modèle (dérapage, boost, tête-à-queue, saut)', () => {
    const { racers, race } = setup();
    const drifting = race.racers[1].kart;
    drifting.speed = 21;
    drifting.steer = -0.6;
    drifting.drift = { active: true, direction: -1, charge: 0.5, tier: 0 };
    drifting.boostTime = 0.4;
    drifting.hopTime = DRIFT.hopDuration / 2;
    const idle = race.racers[2].kart;
    // Sens mémorisé mais dérapage inactif : aucune pose de dérapage.
    idle.drift = { active: false, direction: 1, charge: 0, tier: 0 };
    idle.spinTime = 0.3;
    idle.hopTime = DRIFT.hopDuration;
    const spies = racers.list.map((visual) => vi.spyOn(visual.model, 'update'));

    racers.update(race, 1, DT);

    expect(racers.get(1)!.visual).toEqual({
      speed: 21,
      steer: -0.6,
      driftDirection: -1,
      boosting: true,
      spinning: false,
      hop: expect.closeTo(1, 6),
    });
    expect(racers.get(2)!.visual).toEqual({
      speed: 0,
      steer: 0,
      driftDirection: 0,
      boosting: false,
      spinning: true,
      hop: expect.closeTo(0, 6),
    });
    for (const spy of spies) expect(spy).toHaveBeenCalledWith(DT, expect.any(Object));
  });

  it('ne crée pas d’étiquette sans canvas 2D (Node)', () => {
    const { racers } = setup();
    expect(racers.list.every((visual) => visual.tag === null)).toBe(true);
  });

  /** Place le pilote `id` à (dx, dz) du joueur, sans interpolation. */
  function place(race: RaceState, id: number, dx: number, dz = 0): void {
    const player = race.racers[0].kart.position;
    const kart = race.racers[id].kart;
    kart.position = { x: player.x + dx, z: player.z + dz };
    kart.prevPosition = { ...kart.position };
  }

  /** Caméra de poursuite fictive, derrière le joueur, tournée vers +X. */
  function chaseCamera(race: RaceState): THREE.PerspectiveCamera {
    const player = race.racers[0].kart.position;
    const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.5, 2000);
    camera.position.set(player.x, 3.2, player.z);
    camera.lookAt(player.x + 10, 1, player.z);
    camera.updateMatrixWorld();
    return camera;
  }

  it('étiquette les IA seulement, juste au-dessus du chien, lisible de près et masquée de loin', () => {
    const { racers, race } = setup(fakeTag);
    expect(racers.get(0)!.tag).toBeNull();
    for (const id of [1, 2, 3]) expect(racers.get(id)!.tag).toBeInstanceOf(THREE.Sprite);

    // Pilote 1 à 10 m, pilote 2 à ~40 m (en cours d'effacement), pilote 3 à 120 m (masqué).
    place(race, 1, 10);
    place(race, 2, 40, 6);
    place(race, 3, 120);
    racers.update(race, 1, DT);
    const camera = chaseCamera(race);
    racers.updateTags(camera, 0);

    const nearVisual = racers.get(1)!;
    const near = nearVisual.tag!;
    expect(nearVisual.top).toBeGreaterThan(1);
    expect(nearVisual.top).toBeLessThan(3);
    expect(near.visible).toBe(true);
    expect(near.position.x).toBeCloseTo(race.racers[1].kart.position.x, 6);
    // Au-dessus du modèle (chapeau compris), mais tout près : pas d'étiquette qui flotte haut.
    const bottom = near.position.y - near.scale.y / 2;
    expect(bottom).toBeGreaterThan(nearVisual.top);
    expect(bottom).toBeLessThan(nearVisual.top + 0.3);
    expect(near.material.opacity).toBe(1);
    const fading = racers.get(2)!.tag!;
    expect(fading.visible).toBe(true);
    expect(fading.material.opacity).toBeGreaterThan(0);
    expect(fading.material.opacity).toBeLessThan(1);
    // Taille apparente constante : l'étiquette lointaine est plus grande en mètres.
    expect(fading.scale.y / near.scale.y).toBeGreaterThan(3);
    expect(racers.get(3)!.tag!.visible).toBe(false);

    // Le pilote suivi par la caméra n'a pas d'étiquette devant l'objectif.
    racers.updateTags(camera, 1);
    expect(near.visible).toBe(false);
  });

  it('efface l’étiquette d’un kart qui frôle la caméra', () => {
    const { racers, race } = setup(fakeTag);
    place(race, 1, 2);
    place(race, 2, 5.2, -1);
    place(race, 3, 8, 2);
    racers.update(race, 1, DT);
    racers.updateTags(chaseCamera(race), 0);
    expect(racers.get(1)!.tag!.visible).toBe(false);
    const fading = racers.get(2)!.tag!;
    expect(fading.visible).toBe(true);
    expect(fading.material.opacity).toBeGreaterThan(0);
    expect(fading.material.opacity).toBeLessThan(1);
    expect(racers.get(3)!.tag!.material.opacity).toBe(1);
  });

  it('efface l’étiquette recouverte par une plus proche, en douceur', () => {
    const { racers, race } = setup(fakeTag);
    // Pilotes 1 et 2 presque alignés avec la caméra : leurs étiquettes se chevauchent.
    place(race, 1, 10);
    place(race, 2, 10.6, 0.3);
    place(race, 3, 120);
    racers.update(race, 1, DT);
    const camera = chaseCamera(race);
    racers.updateTags(camera, 0);
    expect(racers.get(1)!.tag!.visible).toBe(true);
    expect(racers.get(2)!.tag!.visible).toBe(false);

    // Le pilote 2 s'écarte : son étiquette réapparaît progressivement.
    place(race, 2, 10.6, 6);
    racers.update(race, 1, DT);
    racers.updateTags(camera, 0, DT);
    const opacity = racers.get(2)!.tag!.material.opacity;
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(0.5);
    for (let i = 0; i < 60; i++) racers.updateTags(camera, 0, DT);
    expect(racers.get(2)!.tag!.material.opacity).toBeCloseTo(1, 2);
    expect(racers.get(1)!.tag!.material.opacity).toBe(1);
  });

  it('libère chaque modèle au dispose()', () => {
    const { racers } = setup();
    const spies = racers.list.map((visual) => vi.spyOn(visual.model, 'dispose'));
    racers.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
    expect(racers.group.children.length).toBe(0);
  });
});
