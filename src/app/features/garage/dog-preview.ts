import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  InjectionToken,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type * as THREE from 'three';
import type { BreedId, SkinSelection } from '../../../game/core/types';
import type { RacerModel, RacerModelOptions, RacerVisualState } from '../../../game/dogs/racer-model';
import type { EnvironmentStyle } from '../../../game/render/environment-map';
import { PALETTE } from '../../../game/render/palette';
import { applyRendererOutput } from '../../../game/render/renderer-output';
import { describeDog } from '../../shared/format';
import { prefersReducedMotion } from '../../shared/reduced-motion';

/**
 * Modules chargés à la demande par l'aperçu : three.js, le constructeur du modèle de pilote et la
 * fabrique de l'image d'environnement (reflets).
 */
export interface DogPreviewModules {
  three: typeof THREE;
  buildRacerModel: (options: RacerModelOptions) => RacerModel;
  createEnvironmentMap: (style: EnvironmentStyle) => THREE.Texture;
}

/**
 * Chargeur des modules de l'aperçu. L'import dynamique garde three.js hors du bundle initial ;
 * les tests fournissent un faux chargeur (faux renderer, faux modèles).
 */
export const DOG_PREVIEW_LOADER = new InjectionToken<() => Promise<DogPreviewModules>>('DOG_PREVIEW_LOADER', {
  factory: () => () =>
    Promise.all([
      import('three'),
      import('../../../game/dogs/racer-model'),
      import('../../../game/render/environment-map'),
    ]).then(([three, models, environment]) => ({
      three,
      buildRacerModel: models.buildRacerModel,
      createEnvironmentMap: environment.createEnvironmentMap,
    })),
});

export const PREVIEW_KART_COLOR = '#d7322e';
/** Vitesse de rotation du plateau (rad/s). */
const TURNTABLE_SPEED = 0.45;
/** Angle de présentation initial (trois quarts avant). */
const TURNTABLE_START = -0.6;
const IDLE_STATE: RacerVisualState = { speed: 0, steer: 0, driftDirection: 0, boosting: false, spinning: false, hop: 0 };

/** Position sur une orbite autour de l'axe du plateau. */
interface Orbit {
  /** Angle horizontal (rad), de +Z vers +X. */
  azimuth: number;
  /** Hauteur angulaire au-dessus de l'horizontale (rad). */
  elevation: number;
  /** Distance (m) au point visé. */
  distance: number;
}

/**
 * Cadrage : caméra rapprochée (4,75 m au lieu de 5,8) en trois quarts avant. L'image carrée va de
 * la pointe du plus haut pilote (carlin au chapeau de fête) au bord avant du plateau, d'où une
 * visée assez basse : le pilote occupe 78 % de la hauteur de l'image au lieu de 63 %. Pilote,
 * queue du teckel et plateau restent entiers à tous les angles : voir le test du cadrage.
 */
const CAMERA = {
  /** Champ vertical (degrés). */
  fov: 35,
  near: 0.1,
  far: 50,
  /** Hauteur (m) visée sur l'axe du plateau. */
  targetHeight: 0.5,
  orbit: { azimuth: 0.733, elevation: 0.35, distance: 4.75 },
} as const;

/**
 * Éclairage de vitrine, fixe pendant que le plateau tourne : ciel, pelouse et soleil du jardin
 * comme en course, plus un contre-jour froid qui découpe la silhouette. Azimuts comptés depuis
 * la caméra : négatif = à sa gauche, ±π = derrière le pilote.
 */
const LIGHTS = {
  hemisphereIntensity: 0.9,
  // De côté : l'ombre tombe à droite du pilote, sur le plateau, au lieu de se cacher derrière lui.
  sun: { intensity: 2.8, azimuth: -1.25, elevation: 0.95, distance: 6 },
  // Rasant : il éclaire les bords du pilote sans blanchir le plateau ni noyer l'ombre.
  rim: { color: '#d8ebff', intensity: 2.2, azimuth: 2.6, elevation: 0.3, distance: 6 },
  /** Hauteur (m) visée par les deux lumières : milieu du pilote. */
  targetHeight: 0.8,
} as const;

/**
 * Reflets de la coque, des chromes, de la truffe et des yeux : même image qu'en course, avec la
 * palette du jardin. Son soleil est placé là où brille la lumière du soleil de la vitrine : le
 * reflet glisse sur la coque quand le plateau tourne.
 */
const ENVIRONMENT_COLORS = {
  top: PALETTE.skyTop,
  horizon: PALETTE.skyHorizon,
  sun: PALETTE.sun,
  ground: PALETTE.hemisphereGround,
} as const;

/** Ombre du soleil, serrée sur le plateau : texels de 3,5 mm, bord adouci par le filtrage PCF. */
const SHADOW = {
  mapSize: 1024,
  /** Demi-côté (m) du cadre d'ombre : plateau et pilote le plus haut, à tous les angles (voir le test). */
  halfExtent: 1.8,
  near: 1,
  far: 12,
  bias: -0.0004,
  /** Décalage le long de la normale (m) : pas d'acné sur le pilote, qui reçoit aussi l'ombre. */
  normalBias: 0.01,
  /** Rayon du flou PCF (texels). */
  radius: 3,
} as const;

/**
 * Plateau tournant (m) : juste plus large que le kart (1,17 m de rayon aux coins du pare-chocs),
 * pour que la caméra rapprochée le montre entier.
 */
const PLATE = {
  topRadius: 1.32,
  bottomRadius: 1.42,
  height: 0.14,
  segments: 48,
  // Plus soutenu qu'avant : le tone mapping ACES éclaircit et désature les verts clairs.
  color: '#86c867',
  roughness: 0.9,
} as const;

/** Place `position` sur `orbit` autour du point (0, `height`, 0), azimut décalé de `baseAzimuth`. */
function placeOnOrbit(
  position: THREE.Vector3,
  orbit: Orbit,
  baseAzimuth: number,
  height: number,
): void {
  const azimuth = baseAzimuth + orbit.azimuth;
  const flat = Math.cos(orbit.elevation) * orbit.distance;
  position.set(
    Math.sin(azimuth) * flat,
    height + Math.sin(orbit.elevation) * orbit.distance,
    Math.cos(azimuth) * flat,
  );
}

type PreviewStatus = 'loading' | 'ready' | 'unavailable';

/** Objets three.js de l'aperçu, créés une fois WebGL et les modules chargés. */
interface PreviewStage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  turntable: THREE.Group;
  buildModel: (options: RacerModelOptions) => RacerModel;
  /** Image d'environnement partagée par les pilotes successifs, libérée avec l'aperçu. */
  environment: THREE.Texture;
  disposables: Array<{ dispose(): void }>;
}

/**
 * Aperçu 3D du pilote sur un plateau tournant. three.js et les modèles sont chargés
 * dynamiquement pour ne pas alourdir le bundle initial ; sans WebGL, un message remplace l'aperçu.
 */
@Component({
  selector: 'app-dog-preview',
  host: { class: 'relative block aspect-square w-full' },
  template: `
    <canvas
      #canvas
      class="block size-full"
      role="img"
      [attr.aria-label]="label()"
      [hidden]="status() === 'unavailable'"
    ></canvas>
    @switch (status()) {
      @case ('loading') {
        <p class="absolute inset-0 grid place-items-center p-4 text-center font-bold text-moss-700">
          Chargement de l’aperçu…
        </p>
      }
      @case ('unavailable') {
        <p class="absolute inset-0 grid place-items-center rounded-3xl bg-leaf-50 p-6 text-center font-bold text-moss-700">
          L’aperçu 3D n’est pas disponible sur ce navigateur. Ton pilote sera bien là pendant la course !
        </p>
      }
    }
  `,
})
export class DogPreview {
  readonly breed = input.required<BreedId>();
  readonly skins = input.required<SkinSelection>();

  protected readonly label = computed(() => `Aperçu : ${describeDog(this.breed(), this.skins())}`);
  protected readonly status = signal<PreviewStatus>('loading');

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly loadModules = inject(DOG_PREVIEW_LOADER);
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly reducedMotion = prefersReducedMotion(this.view);
  private readonly stage = signal<PreviewStage | null>(null);

  private model: RacerModel | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frameId = 0;
  private lastFrameTime: number | null = null;
  private destroyed = false;

  constructor() {
    afterNextRender(() => void this.init());

    // Reconstruit le modèle quand la race ou les accessoires changent.
    effect(() => {
      const stage = this.stage();
      const breed = this.breed();
      const skins = this.skins();
      if (stage) untracked(() => this.showModel(stage, breed, skins));
    });

    inject(DestroyRef).onDestroy(() => this.teardown());
  }

  private async init(): Promise<void> {
    const view = this.view;
    // jsdom et les très vieux navigateurs : pas de WebGL 2, inutile de charger three.js.
    if (!view || !('WebGL2RenderingContext' in view)) {
      this.status.set('unavailable');
      return;
    }

    let renderer: THREE.WebGLRenderer | null = null;
    let environment: THREE.Texture | null = null;
    try {
      const { three, buildRacerModel, createEnvironmentMap } = await this.loadModules();
      if (this.destroyed) return;

      renderer = new three.WebGLRenderer({ canvas: this.canvas().nativeElement, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      applyRendererOutput(renderer, three);

      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
      placeOnOrbit(camera.position, CAMERA.orbit, 0, CAMERA.targetHeight);
      camera.lookAt(0, CAMERA.targetHeight, 0);

      const hemisphere = new three.HemisphereLight(
        PALETTE.hemisphereSky,
        PALETTE.hemisphereGround,
        LIGHTS.hemisphereIntensity,
      );
      const sun = new three.DirectionalLight(PALETTE.sunLight, LIGHTS.sun.intensity);
      sun.name = 'preview-sun';
      placeOnOrbit(sun.position, LIGHTS.sun, CAMERA.orbit.azimuth, LIGHTS.targetHeight);
      sun.castShadow = true;
      const shadow = sun.shadow;
      shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
      shadow.camera.left = -SHADOW.halfExtent;
      shadow.camera.right = SHADOW.halfExtent;
      shadow.camera.top = SHADOW.halfExtent;
      shadow.camera.bottom = -SHADOW.halfExtent;
      shadow.camera.near = SHADOW.near;
      shadow.camera.far = SHADOW.far;
      shadow.camera.updateProjectionMatrix();
      shadow.bias = SHADOW.bias;
      shadow.normalBias = SHADOW.normalBias;
      shadow.radius = SHADOW.radius;
      const rim = new three.DirectionalLight(LIGHTS.rim.color, LIGHTS.rim.intensity);
      rim.name = 'preview-rim';
      placeOnOrbit(rim.position, LIGHTS.rim, CAMERA.orbit.azimuth, LIGHTS.targetHeight);
      for (const light of [sun, rim]) {
        light.target.position.set(0, LIGHTS.targetHeight, 0);
        scene.add(light, light.target);
      }
      scene.add(hemisphere);
      const toSun = sun.position.clone().sub(sun.target.position).normalize();
      environment = createEnvironmentMap({ ...ENVIRONMENT_COLORS, sunDirection: [toSun.x, toSun.y, toSun.z] });

      const plateGeometry = new three.CylinderGeometry(
        PLATE.topRadius,
        PLATE.bottomRadius,
        PLATE.height,
        PLATE.segments,
      );
      const plateMaterial = new three.MeshStandardMaterial({
        color: PLATE.color,
        roughness: PLATE.roughness,
      });
      const plate = new three.Mesh(plateGeometry, plateMaterial);
      plate.name = 'preview-plate';
      plate.position.y = -PLATE.height / 2;
      plate.receiveShadow = true;

      const turntable = new three.Group();
      turntable.rotation.y = TURNTABLE_START;
      turntable.add(plate);
      scene.add(turntable);

      const stage: PreviewStage = {
        renderer,
        scene,
        camera,
        turntable,
        buildModel: buildRacerModel,
        environment,
        // La carte d'ombre appartient au soleil : sun.dispose() la libère. L'image d'environnement
        // est libérée après les modèles (teardown), qui ne la libèrent pas eux-mêmes.
        disposables: [plateGeometry, plateMaterial, sun, rim, hemisphere, environment],
      };
      this.observeSize(stage);
      this.stage.set(stage);
      this.status.set('ready');
      if (!this.reducedMotion) this.frameId = view.requestAnimationFrame(this.animate);
    } catch (error) {
      console.warn('[WoufKart] Aperçu 3D indisponible', error);
      // Rien ne doit survivre à un échec : observateur de taille, scène et contexte WebGL.
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      this.stage.set(null);
      environment?.dispose();
      renderer?.dispose();
      if (!this.destroyed) this.status.set('unavailable');
    }
  }

  private showModel(stage: PreviewStage, breed: BreedId, skins: SkinSelection): void {
    // Le nouveau modèle est construit AVANT de libérer l'ancien : les géométries et matériaux partagés
    // (cache à compteur de références) restent en mémoire au lieu d'être détruits puis recréés.
    let next: RacerModel | null = null;
    try {
      next = stage.buildModel({
        breed,
        skins,
        kartColor: PREVIEW_KART_COLOR,
        environment: stage.environment,
      });
      next.update(0, IDLE_STATE);
      // Dans l'aperçu, le pilote reçoit aussi les ombres (la sienne, celle du chapeau…) : le cadre
      // d'ombre serré y donne des texels de quelques millimètres.
      next.root.traverse((object) => {
        object.receiveShadow = true;
      });
    } catch (error) {
      console.warn('[WoufKart] Modèle du pilote impossible à construire', error);
      next?.dispose();
      next = null;
    }
    // L'ancien modèle part dans tous les cas : l'aperçu ne doit pas montrer un autre pilote que son libellé.
    this.model?.dispose();
    this.model = next;
    if (next) stage.turntable.add(next.root);
    if (this.reducedMotion) this.render(stage);
  }

  private readonly animate = (time: number): void => {
    const stage = this.stage();
    if (!stage || this.destroyed || !this.view) return;
    const dt = this.lastFrameTime === null ? 0 : Math.min((time - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = time;
    stage.turntable.rotation.y += dt * TURNTABLE_SPEED;
    this.model?.update(dt, IDLE_STATE);
    this.render(stage);
    this.frameId = this.view.requestAnimationFrame(this.animate);
  };

  private render(stage: PreviewStage): void {
    stage.renderer.render(stage.scene, stage.camera);
  }

  /** Adapte la résolution du rendu à la taille affichée du canvas. */
  private observeSize(stage: PreviewStage): void {
    const canvas = this.canvas().nativeElement;
    const resize = (): void => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      stage.renderer.setSize(width, height, false);
      stage.camera.aspect = width / height;
      stage.camera.updateProjectionMatrix();
      if (this.reducedMotion) this.render(stage);
    };
    resize();
    if (this.view && 'ResizeObserver' in this.view) {
      this.resizeObserver = new ResizeObserver(resize);
      this.resizeObserver.observe(canvas);
    }
  }

  private teardown(): void {
    this.destroyed = true;
    if (this.frameId !== 0) this.view?.cancelAnimationFrame(this.frameId);
    this.resizeObserver?.disconnect();
    this.model?.dispose();
    this.model = null;
    const stage = this.stage();
    if (!stage) return;
    for (const item of stage.disposables) item.dispose();
    stage.renderer.dispose();
    // Le canvas disparaît : on rend tout de suite le contexte WebGL au navigateur.
    stage.renderer.forceContextLoss();
  }
}
