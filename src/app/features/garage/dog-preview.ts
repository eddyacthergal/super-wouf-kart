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
import { describeDog } from '../../shared/format';
import { prefersReducedMotion } from '../../shared/reduced-motion';

/** Modules chargés à la demande par l'aperçu : three.js et le constructeur du modèle de pilote. */
export interface DogPreviewModules {
  three: typeof THREE;
  buildRacerModel: (options: RacerModelOptions) => RacerModel;
}

/**
 * Chargeur des modules de l'aperçu. L'import dynamique garde three.js hors du bundle initial ;
 * les tests fournissent un faux chargeur (faux renderer, faux modèles).
 */
export const DOG_PREVIEW_LOADER = new InjectionToken<() => Promise<DogPreviewModules>>('DOG_PREVIEW_LOADER', {
  factory: () => () =>
    Promise.all([import('three'), import('../../../game/dogs/racer-model')]).then(([three, models]) => ({
      three,
      buildRacerModel: models.buildRacerModel,
    })),
});

export const PREVIEW_KART_COLOR = '#d7322e';
/** Vitesse de rotation du plateau (rad/s). */
const TURNTABLE_SPEED = 0.45;
/** Angle de présentation initial (trois quarts avant). */
const TURNTABLE_START = -0.6;
const IDLE_STATE: RacerVisualState = { speed: 0, steer: 0, driftDirection: 0, boosting: false, spinning: false, hop: 0 };

type PreviewStatus = 'loading' | 'ready' | 'unavailable';

/** Objets three.js de l'aperçu, créés une fois WebGL et les modules chargés. */
interface PreviewStage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  turntable: THREE.Group;
  buildModel: (options: RacerModelOptions) => RacerModel;
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
    try {
      const { three, buildRacerModel } = await this.loadModules();
      if (this.destroyed) return;

      renderer = new three.WebGLRenderer({ canvas: this.canvas().nativeElement, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);

      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(35, 1, 0.1, 50);
      camera.position.set(3.6, 2.6, 4);
      camera.lookAt(0, 0.5, 0);

      // Éclairage doux : ciel et pelouse, plus un soleil léger.
      scene.add(new three.HemisphereLight('#e8f6ff', '#7cc46a', 2.2));
      const sun = new three.DirectionalLight('#fff4dc', 2.2);
      sun.position.set(3, 6, 4);
      scene.add(sun);

      const plateGeometry = new three.CylinderGeometry(1.45, 1.55, 0.14, 48);
      const plateMaterial = new three.MeshStandardMaterial({ color: '#9fd784', roughness: 0.9 });
      const plate = new three.Mesh(plateGeometry, plateMaterial);
      plate.position.y = -0.07;

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
        disposables: [plateGeometry, plateMaterial],
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
      renderer?.dispose();
      if (!this.destroyed) this.status.set('unavailable');
    }
  }

  private showModel(stage: PreviewStage, breed: BreedId, skins: SkinSelection): void {
    // Le nouveau modèle est construit AVANT de libérer l'ancien : les géométries et matériaux partagés
    // (cache à compteur de références) restent en mémoire au lieu d'être détruits puis recréés.
    let next: RacerModel | null = null;
    try {
      next = stage.buildModel({ breed, skins, kartColor: PREVIEW_KART_COLOR });
      next.update(0, IDLE_STATE);
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
