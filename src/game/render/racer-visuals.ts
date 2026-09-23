/**
 * Pilotes à l'écran : un modèle (kart + chien) par pilote, placé à la position interpolée,
 * et une étiquette de nom au-dessus des IA : taille apparente constante, juste au-dessus du chien
 * (chapeau compris), estompée au loin, et effacée quand une étiquette plus proche la recouvre.
 */
import * as THREE from 'three';
import { DRIFT } from '../core/constants';
import type { RaceState, RacerState } from '../core/types';
import { clamp, lerpAngle } from '../core/vec2';
import { buildRacerModel, type RacerModel, type RacerVisualState } from '../dogs/racer-model';
import { smoothTowards, type DisposalBag } from './resources';
import { createNameTagTexture } from './textures';

/** Réglages des étiquettes de nom (m, fractions de la distance à la caméra). */
export const NAME_TAG = {
  /** Hauteur de l'étiquette par mètre de distance : taille apparente constante (~22 px en 720p). */
  screenRatio: 0.04,
  /** Hauteur minimale (m), pour un kart collé à la caméra. */
  minHeight: 0.1,
  /** Écart entre le haut du modèle et le bas de l'étiquette, par mètre de distance. */
  lift: 0.012,
  /** Hauteur du modèle quand elle ne peut pas être mesurée (m). */
  fallbackTop: 1.8,
  /** Distances (m) où l'étiquette commence à s'effacer, puis disparaît. */
  fadeStart: 32,
  hide: 46,
  /**
   * Kart qui frôle la caméra (il double le joueur) : son étiquette encombrerait le premier plan.
   * Masquée en deçà de `nearHide`, pleinement visible au-delà de `nearFadeEnd` (m).
   */
  nearHide: 4.5,
  nearFadeEnd: 6.5,
  aspect: 4,
  /** Vitesse d'effacement d'une étiquette recouverte par une plus proche (1/s). */
  occlusionRate: 10,
} as const;

export interface RacerVisual {
  readonly id: number;
  readonly model: RacerModel;
  readonly tag: THREE.Sprite | null;
  /** Position interpolée du kart (y = 0). */
  readonly position: THREE.Vector3;
  /** Cap interpolé (sans la rotation visuelle). */
  heading: number;
  readonly visual: RacerVisualState;
  /** Hauteur du haut du modèle au repos (chien et chapeau compris), en m. */
  readonly top: number;
  /** Opacité liée au recouvrement par une étiquette plus proche (0..1). */
  tagFade: number;
}

/** Fabrique de texture d'étiquette (null : pas d'étiquette, par exemple sans canvas 2D). */
export type NameTagFactory = (name: string, accent: string) => THREE.Texture | null;

/** Étiquette candidate à l'affichage pour l'image en cours. */
interface TagSlot {
  visual: RacerVisual;
  distance: number;
  /** Centre et demi-dimensions à l'écran (coordonnées normalisées). */
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
  /** Vrai si une étiquette plus proche la recouvre. */
  covered: boolean;
}

export class RacerVisuals {
  readonly group = new THREE.Group();
  readonly list: RacerVisual[] = [];
  private readonly byId = new Map<number, RacerVisual>();
  private readonly cameraPosition = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly slots: TagSlot[] = [];

  constructor(
    racers: readonly RacerState[],
    bag: DisposalBag,
    private readonly createTagTexture: NameTagFactory = createNameTagTexture,
  ) {
    this.group.name = 'racers';
    try {
      for (const racer of racers) this.add(racer, bag);
    } catch (error) {
      // Modèle impossible à construire : on libère ceux déjà créés avant de propager l'erreur.
      this.dispose();
      throw error;
    }
  }

  private add(racer: RacerState, bag: DisposalBag): void {
    const model = buildRacerModel({
      breed: racer.breed,
      skins: racer.skins,
      kartColor: racer.kartColor,
    });
    model.root.userData['racerId'] = racer.id;
    this.group.add(model.root);
    const tag = racer.isPlayer ? null : this.createTag(racer, bag);
    if (tag) this.group.add(tag);
    const visual: RacerVisual = {
      id: racer.id,
      model,
      tag,
      position: new THREE.Vector3(racer.kart.position.x, 0, racer.kart.position.z),
      heading: racer.kart.heading,
      visual: { speed: 0, steer: 0, driftDirection: 0, boosting: false, spinning: false, hop: 0 },
      top: modelTop(model.root),
      tagFade: 1,
    };
    this.list.push(visual);
    this.byId.set(racer.id, visual);
  }

  get(id: number): RacerVisual | undefined {
    return this.byId.get(id);
  }

  /** Place et anime chaque modèle ; met à jour les matrices (positions des roues et des pots pour les effets). */
  update(state: RaceState, alpha: number, dt: number): void {
    for (const racer of state.racers) {
      const visual = this.byId.get(racer.id);
      if (!visual) continue;
      const kart = racer.kart;
      visual.position.set(
        kart.prevPosition.x + (kart.position.x - kart.prevPosition.x) * alpha,
        0,
        kart.prevPosition.z + (kart.position.z - kart.prevPosition.z) * alpha,
      );
      visual.heading = lerpAngle(kart.prevHeading, kart.heading, alpha);
      const root = visual.model.root;
      root.position.copy(visual.position);
      root.rotation.y = visual.heading + kart.visualYaw;

      const pose = visual.visual;
      pose.speed = kart.speed;
      pose.steer = kart.steer;
      pose.driftDirection = kart.drift.active ? kart.drift.direction : 0;
      pose.boosting = kart.boostTime > 0;
      pose.spinning = kart.spinTime > 0;
      pose.hop = kart.hopTime > 0 ? Math.sin(Math.PI * (1 - kart.hopTime / DRIFT.hopDuration)) : 0;
      visual.model.update(dt, pose);
      root.updateMatrixWorld(true);
    }
  }

  /**
   * Étiquettes : taille apparente constante, juste au-dessus du modèle, effacement puis masquage
   * au-delà de `NAME_TAG.hide`. Une étiquette recouverte par une plus proche s'efface en douceur
   * (`dt` > 0) ou aussitôt (`dt` = 0).
   */
  updateTags(camera: THREE.Camera, followedId: number, dt = 0): void {
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.cameraPosition);
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
    const slots = this.slots;
    slots.length = 0;

    for (const visual of this.list) {
      const tag = visual.tag;
      if (!tag) continue;
      const { x, z } = visual.position;
      const distance = this.cameraPosition.distanceTo(this.projected.set(x, visual.top, z));
      const height = Math.max(NAME_TAG.minHeight, distance * NAME_TAG.screenRatio);
      const centerY = visual.top + distance * NAME_TAG.lift + height / 2;
      tag.position.set(x, centerY, z);
      tag.scale.set(height * NAME_TAG.aspect, height, 1);
      tag.visible = false;
      if (visual.id === followedId || !(distance < NAME_TAG.hide && distance > NAME_TAG.nearHide)) {
        continue;
      }

      // Position et taille à l'écran : le haut de l'étiquette projeté donne sa demi-hauteur.
      const center = this.projected.set(x, centerY, z).project(camera);
      if (!(center.z > -1 && center.z < 1)) continue;
      const slot: TagSlot = {
        visual,
        distance,
        x: center.x,
        y: center.y,
        halfWidth: 0,
        halfHeight: 0,
        covered: false,
      };
      const top = this.projected.set(x, centerY + height / 2, z).project(camera);
      slot.halfHeight = Math.abs(top.y - slot.y);
      slot.halfWidth = (slot.halfHeight * NAME_TAG.aspect) / aspect;
      slots.push(slot);
    }

    // Les plus proches d'abord : une étiquette recouverte par une plus proche s'efface.
    slots.sort((a, b) => a.distance - b.distance);
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      for (let j = 0; j < i && !slot.covered; j++) {
        const nearer = slots[j];
        slot.covered =
          !nearer.covered &&
          Math.abs(slot.x - nearer.x) < slot.halfWidth + nearer.halfWidth &&
          Math.abs(slot.y - nearer.y) < slot.halfHeight + nearer.halfHeight;
      }
      const visual = slot.visual;
      const target = slot.covered ? 0 : 1;
      visual.tagFade =
        dt > 0 ? smoothTowards(visual.tagFade, target, NAME_TAG.occlusionRate, dt) : target;
      const opacity = distanceOpacity(slot.distance) * visual.tagFade;
      const tag = visual.tag;
      if (!tag) continue;
      tag.material.opacity = opacity;
      tag.visible = opacity > 0.02;
    }
  }

  dispose(): void {
    for (const visual of this.list) visual.model.dispose();
    this.list.length = 0;
    this.byId.clear();
    this.slots.length = 0;
    this.group.removeFromParent();
    this.group.clear();
  }

  private createTag(racer: RacerState, bag: DisposalBag): THREE.Sprite | null {
    const texture = this.createTagTexture(racer.name, racer.kartColor);
    if (!texture) return null;
    const material = bag.add(
      new THREE.SpriteMaterial({ map: bag.add(texture), transparent: true, depthWrite: false }),
    );
    const sprite = new THREE.Sprite(material);
    sprite.name = 'name-tag';
    sprite.renderOrder = 3;
    return sprite;
  }
}

/** Opacité selon la distance à la caméra : effacée tout près (kart qui double) et au loin. */
function distanceOpacity(distance: number): number {
  const near = clamp(
    (distance - NAME_TAG.nearHide) / (NAME_TAG.nearFadeEnd - NAME_TAG.nearHide),
    0,
    1,
  );
  const far = clamp((NAME_TAG.hide - distance) / (NAME_TAG.hide - NAME_TAG.fadeStart), 0, 1);
  return Math.min(near, far);
}

/** Haut du modèle au repos (m) : boîte englobante de toutes ses pièces. */
function modelTop(root: THREE.Object3D): number {
  root.updateMatrixWorld(true);
  const top = new THREE.Box3().setFromObject(root).max.y;
  return Number.isFinite(top) && top > 0 ? top : NAME_TAG.fallbackTop;
}
