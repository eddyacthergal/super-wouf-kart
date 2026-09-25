/**
 * Graphe de scène complet de la course (jardin, ciel, lumières, pilotes, objets, effets, caméra),
 * sans WebGL : constructible et testable en Node. RaceRenderer se contente de le dessiner.
 */
import * as THREE from 'three';
import type { GameEvent, RaceState, RacerState, TrackQuery } from '../core/types';
import { clamp } from '../core/vec2';
import type { TrackDecorHints, TrackThemeId } from '../track/track-definition';
import { CameraRig, CHASE, type CameraTarget } from './camera-rig';
import { Effects } from './effects';
import { ItemVisuals } from './item-visuals';
import { SceneLighting } from './lighting';
import { RacerVisuals } from './racer-visuals';
import { DisposalBag } from './resources';
import type { ThemeWorld } from './scene-theme';
import { buildSkyDome, sunDirectionOf } from './sky';
import { SCENE_THEMES } from './themes';

export interface RaceSceneOptions {
  /** « Réduire les animations » : ni secousse, ni variation du champ de vision. */
  reducedMotion: boolean;
  /** Thème de rendu du circuit (jardin par défaut). */
  theme?: TrackThemeId;
  /** Repères du décor propres au circuit (Grand Jardin par défaut). */
  decor?: TrackDecorHints;
}

/** Plans de découpe de la caméra (m) : proche assez loin pour une bonne précision de profondeur. */
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 2000;
/** Pas de temps maximal d'une image (s) pour les animations. */
const MAX_FRAME_DT = 0.1;
/** Secousses de caméra (m). */
const SHAKE_HIT = 0.45;
const SHAKE_WALL_BASE = 0.06;
const SHAKE_WALL_SCALE = 0.24;
const SHAKE_BUMP_SCALE = 0.12;

export class RaceScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(CHASE.fov, 16 / 9, CAMERA_NEAR, CAMERA_FAR);
  private readonly bag = new DisposalBag();
  private readonly lighting: SceneLighting;
  private readonly world: ThemeWorld;
  private readonly sky: THREE.Mesh;
  private readonly racers: RacerVisuals;
  private readonly items: ItemVisuals;
  private readonly effects: Effects;
  private readonly rig: CameraRig;
  private readonly target: CameraTarget = { x: 0, z: 0, heading: 0, boosting: false };
  private time = 0;
  private disposed = false;

  constructor(track: TrackQuery, racers: readonly RacerState[], options: RaceSceneOptions) {
    this.scene.name = 'race-scene';
    const theme = SCENE_THEMES[options.theme ?? 'garden'] ?? SCENE_THEMES.garden;
    this.scene.background = new THREE.Color(theme.fog.color);
    this.scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
    this.lighting = new SceneLighting(theme.light, sunDirectionOf(theme.sky));
    this.camera.name = 'chase-camera';
    this.rig = new CameraRig(this.camera, options.reducedMotion);
    this.lighting.addTo(this.scene);

    let world: ThemeWorld | null = null;
    let racerVisuals: RacerVisuals | null = null;
    try {
      world = theme.buildWorld(track, options.decor);
      racerVisuals = new RacerVisuals(racers, this.bag);
      this.world = world;
      this.racers = racerVisuals;
      this.sky = buildSkyDome(this.bag, theme.sky);
      this.items = new ItemVisuals(this.bag);
      this.effects = new Effects(racerVisuals, this.bag, track);
    } catch (error) {
      racerVisuals?.dispose();
      world?.dispose();
      this.bag.dispose();
      this.lighting.dispose();
      throw error;
    }
    this.scene.add(
      this.sky,
      this.world.root,
      this.racers.group,
      this.items.group,
      this.effects.group,
    );
  }

  /**
   * Met la scène à jour pour une image : `alpha` interpole entre le pas précédent et le pas courant,
   * `frameDt` est la durée réelle de l'image (animations), `events` les événements des pas écoulés.
   */
  update(state: RaceState, alpha: number, frameDt: number, events: readonly GameEvent[]): void {
    if (this.disposed) return;
    const dt = clamp(Number.isFinite(frameDt) ? frameDt : 0, 0, MAX_FRAME_DT);
    const blend = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    this.time += dt;

    this.racers.update(state, blend, dt);

    const followed = this.followedRacer(state);
    const visual = followed ? this.racers.get(followed.id) : undefined;
    if (followed && visual) {
      this.target.x = visual.position.x;
      this.target.z = visual.position.z;
      this.target.heading = visual.heading;
      this.target.boosting = followed.kart.boostTime > 0;
      this.shakeOnEvents(events, followed.id);
      this.rig.update(this.target, state.phase, state.countdown, dt);
      this.lighting.follow(visual.position.x, visual.position.z);
    }

    this.items.update(state, blend, dt, this.time);
    this.effects.handleEvents(events, this.racers, state);
    this.effects.update(state, this.racers, dt, this.time);
    this.racers.updateTags(this.camera, followed ? followed.id : -1, dt);
    this.world.update(this.time);
    this.sky.position.copy(this.camera.position);
  }

  setAspect(aspect: number): void {
    if (!(Number.isFinite(aspect) && aspect > 0)) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.effects.dispose();
    this.racers.dispose();
    this.items.dispose();
    this.world.dispose();
    this.lighting.dispose();
    this.bag.dispose();
    this.scene.clear();
    this.scene.fog = null;
    this.scene.background = null;
  }

  /** Pilote suivi par la caméra : le joueur, ou le premier pilote s'il n'y en a pas (playerId = -1). */
  private followedRacer(state: RaceState): RacerState | undefined {
    if (state.playerId >= 0) {
      for (const racer of state.racers) if (racer.id === state.playerId) return racer;
    }
    return state.racers[0];
  }

  private shakeOnEvents(events: readonly GameEvent[], followedId: number): void {
    for (const event of events) {
      switch (event.type) {
        case 'hit':
          if (event.racerId === followedId) this.rig.shake(SHAKE_HIT);
          break;
        case 'wall':
          if (event.racerId === followedId) {
            this.rig.shake(SHAKE_WALL_BASE + SHAKE_WALL_SCALE * event.intensity);
          }
          break;
        case 'bump':
          if (event.racerId === followedId || event.otherId === followedId) {
            this.rig.shake(SHAKE_BUMP_SCALE * event.intensity);
          }
          break;
      }
    }
  }
}
