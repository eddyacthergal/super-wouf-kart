import { TestBed, type ComponentFixture } from '@angular/core/testing';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkinSelection } from '../../../game/core/types';
import { BREED_LIST } from '../../../game/dogs/breeds';
import {
  buildRacerModel as buildRealRacerModel,
  type RacerModel,
  type RacerModelOptions,
  type RacerVisualState,
} from '../../../game/dogs/racer-model';
import { skinsForSlot } from '../../../game/dogs/skins-catalog';
import { TONE_MAPPING_EXPOSURE } from '../../../game/render/renderer-output';
import { DOG_PREVIEW_LOADER, DogPreview, PREVIEW_KART_COLOR, type DogPreviewModules } from './dog-preview';

const IDLE: RacerVisualState = {
  speed: 0,
  steer: 0,
  driftDirection: 0,
  boosting: false,
  spinning: false,
  hop: 0,
};
/** Angles du plateau essayés pour le cadrage. */
const TURNTABLE_STEPS = 16;
/** Le pilote et le plateau restent à l'intérieur de 95 % de l'image (coordonnées normalisées). */
const FRAME_MARGIN = 0.95;
/** Part de la hauteur de l'image occupée par le plus haut pilote : 20 % de plus qu'avant (63 %). */
const MIN_PILOT_HEIGHT = 0.76;

describe('DogPreview', () => {
  it('sans WebGL (jsdom), affiche un message de repli sans lever d’exception', async () => {
    const fixture = TestBed.createComponent(DogPreview);
    fixture.componentRef.setInput('breed', 'chihuahua');
    fixture.componentRef.setInput('skins', { head: 'cap', neck: 'bandana', body: null });
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('L’aperçu 3D n’est pas disponible');
    const canvas = element.querySelector('canvas');
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toBe('Aperçu : chihuahua avec casquette et bandana');
    expect(canvas?.hidden).toBe(true);

    expect(() => fixture.destroy()).not.toThrow();
  });

  it('met à jour le libellé accessible quand le pilote change', async () => {
    const fixture = TestBed.createComponent(DogPreview);
    fixture.componentRef.setInput('breed', 'teckel');
    fixture.componentRef.setInput('skins', { head: null, neck: null, body: null });
    await fixture.whenStable();
    const canvas = (fixture.nativeElement as HTMLElement).querySelector('canvas');
    expect(canvas?.getAttribute('aria-label')).toBe('Aperçu : teckel sans accessoire');

    fixture.componentRef.setInput('skins', { head: null, neck: null, body: 'sweater' });
    await fixture.whenStable();
    expect(canvas?.getAttribute('aria-label')).toBe('Aperçu : teckel avec pull rayé');
  });
});

/**
 * Faux WebGLRenderer : compte les rendus et la libération du contexte, garde la dernière caméra
 * dessinée. Ses réglages de sortie partent de valeurs qu'aucun rendu n'attend : l'aperçu doit les régler.
 */
class FakeRenderer {
  static instances: FakeRenderer[] = [];
  static failNext = false;
  renders = 0;
  disposeCalls = 0;
  contextLossCalls = 0;
  outputColorSpace: string = THREE.LinearSRGBColorSpace;
  toneMapping: THREE.ToneMapping = THREE.NoToneMapping;
  toneMappingExposure = 0;
  readonly shadowMap = { enabled: false, type: THREE.BasicShadowMap as THREE.ShadowMapType };
  lastCamera: THREE.Camera | null = null;

  constructor(readonly parameters: { canvas: HTMLCanvasElement; alpha: boolean }) {
    if (FakeRenderer.failNext) {
      FakeRenderer.failNext = false;
      throw new Error('Error creating WebGL context.');
    }
    FakeRenderer.instances.push(this);
  }

  setPixelRatio(): void {}
  setClearColor(): void {}
  setSize(): void {}
  render(_scene: THREE.Scene, camera: THREE.Camera): void {
    this.renders++;
    this.lastCamera = camera;
  }
  dispose(): void {
    this.disposeCalls++;
  }
  forceContextLoss(): void {
    this.contextLossCalls++;
  }
}

interface FakeModel extends RacerModel {
  options: RacerModelOptions;
  disposeCalls: number;
  updates: Array<[number, RacerVisualState]>;
}

interface Frame {
  id: number;
  callback: FrameRequestCallback;
}

describe('DogPreview avec WebGL (renderer factice)', () => {
  let fixture: ComponentFixture<DogPreview>;
  let models: FakeModel[];
  let requested: Frame[];
  let cancelled: number[];
  /** Images demandées par l'aperçu (le planificateur d'Angular utilise aussi requestAnimationFrame). */
  const frames = (): Frame[] => requested.filter((frame) => frame.callback.name === 'animate');
  let releaseLoader: (() => void) | null;
  const view = document.defaultView as unknown as Record<string, unknown>;
  const originals = {
    webgl2: view['WebGL2RenderingContext'],
    raf: view['requestAnimationFrame'],
    caf: view['cancelAnimationFrame'],
  };

  const buildRacerModel = (options: RacerModelOptions): RacerModel => {
    const root = new THREE.Group();
    // Une pièce, comme celles du vrai modèle.
    root.add(new THREE.Mesh());
    const model: FakeModel = {
      options,
      root,
      exhausts: [],
      rearWheels: [],
      disposeCalls: 0,
      updates: [],
      update: (dt, state) => model.updates.push([dt, state]),
      dispose: () => {
        model.disposeCalls++;
        root.removeFromParent();
      },
    };
    models.push(model);
    return model;
  };

  function create(skins: SkinSelection, options: { deferLoading?: boolean } = {}): void {
    const modules: DogPreviewModules = {
      three: { ...THREE, WebGLRenderer: FakeRenderer } as unknown as typeof THREE,
      buildRacerModel,
    };
    const loader = options.deferLoading
      ? () => new Promise<DogPreviewModules>((resolve) => (releaseLoader = () => resolve(modules)))
      : () => Promise.resolve(modules);
    TestBed.configureTestingModule({ providers: [{ provide: DOG_PREVIEW_LOADER, useValue: loader }] });
    fixture = TestBed.createComponent(DogPreview);
    fixture.componentRef.setInput('breed', 'carlin');
    fixture.componentRef.setInput('skins', skins);
  }

  async function ready(): Promise<void> {
    await fixture.whenStable();
    await vi.waitFor(() => expect(models.length).toBeGreaterThan(0));
    await fixture.whenStable();
  }

  /** Plateau tournant : parent du modèle affiché. */
  const turntable = (): THREE.Object3D => models.at(-1)?.root.parent as THREE.Object3D;
  const scene = (): THREE.Scene => turntable().parent as THREE.Scene;

  /** Caméra de l'aperçu, lue au premier rendu. */
  function previewCamera(renderer: FakeRenderer): THREE.PerspectiveCamera {
    frames().at(-1)?.callback(1000);
    const camera = renderer.lastCamera;
    if (!(camera instanceof THREE.PerspectiveCamera)) throw new Error('aucune caméra dessinée');
    // Comme WebGLRenderer.render pour une caméra hors de la scène.
    camera.updateMatrixWorld();
    return camera;
  }

  function light(name: string): THREE.DirectionalLight {
    const object = scene().getObjectByName(name);
    if (!(object instanceof THREE.DirectionalLight)) throw new Error(`lumière introuvable : ${name}`);
    return object;
  }

  /** Direction horizontale de `from` vers `to`. */
  const horizontalDirection = (from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3 =>
    new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();

  beforeEach(() => {
    models = [];
    requested = [];
    cancelled = [];
    releaseLoader = null;
    FakeRenderer.instances = [];
    FakeRenderer.failNext = false;
    view['WebGL2RenderingContext'] = class {};
    view['requestAnimationFrame'] = (callback: FrameRequestCallback): number =>
      requested.push({ id: requested.length + 1, callback });
    view['cancelAnimationFrame'] = (id: number): void => void cancelled.push(id);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originals.webgl2 === undefined) delete view['WebGL2RenderingContext'];
    else view['WebGL2RenderingContext'] = originals.webgl2;
    view['requestAnimationFrame'] = originals.raf;
    view['cancelAnimationFrame'] = originals.caf;
  });

  it('affiche le pilote choisi sur un plateau, dans un canvas transparent', async () => {
    create({ head: 'cap', neck: null, body: null });
    await ready();

    const element = fixture.nativeElement as HTMLElement;
    const canvas = element.querySelector('canvas');
    expect(element.textContent).not.toContain('Chargement de l’aperçu');
    expect(element.textContent).not.toContain('pas disponible');
    expect(canvas?.hidden).toBe(false);

    const [renderer] = FakeRenderer.instances;
    expect(renderer.parameters.canvas).toBe(canvas);
    expect(renderer.parameters.alpha).toBe(true);
    expect(models).toHaveLength(1);
    expect(models[0].options).toEqual({
      breed: 'carlin',
      skins: { head: 'cap', neck: null, body: null },
      kartColor: PREVIEW_KART_COLOR,
    });
    expect(models[0].root.parent).not.toBeNull();
  });

  it('fait tourner le plateau à chaque image', async () => {
    create({ head: null, neck: null, body: null });
    await ready();
    const [renderer] = FakeRenderer.instances;
    const turntable = models[0].root.parent as THREE.Object3D;
    const angle = turntable.rotation.y;

    expect(frames()).toHaveLength(1);
    frames().at(-1)?.callback(1000);
    frames().at(-1)?.callback(1100);
    expect(frames()).toHaveLength(3);
    expect(renderer.renders).toBe(2);
    expect(turntable.rotation.y).toBeGreaterThan(angle);
    expect(models[0].updates.length).toBeGreaterThan(1);
  });

  it('rend comme la course : sRGB, ACES à la même exposition, ombres PCF', async () => {
    create({ head: null, neck: null, body: null });
    await ready();
    const [renderer] = FakeRenderer.instances;

    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(TONE_MAPPING_EXPOSURE);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
  });

  it('éclaire en vitrine : soleil à l’ombre serrée sur le plateau, contre-jour derrière le pilote', async () => {
    create({ head: null, neck: null, body: null });
    await ready();
    const camera = previewCamera(FakeRenderer.instances[0]);
    const sun = light('preview-sun');
    const rim = light('preview-rim');
    // Les cibles sont dans la scène : three recalcule leur position à chaque image.
    expect(sun.target.parent).toBe(scene());
    expect(rim.target.parent).toBe(scene());

    const shadowCamera = sun.shadow.camera;
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.x).toBeGreaterThanOrEqual(1024);
    // Serrée sur le plateau (1,42 m de rayon) : moins de 4 m de côté, contre 90 en course. Le test
    // du cadrage vérifie qu'elle couvre quand même le plateau et le pilote.
    expect(shadowCamera.right - shadowCamera.left).toBeLessThan(4);
    expect(shadowCamera.top - shadowCamera.bottom).toBeLessThan(4);
    expect(sun.shadow.radius).toBeGreaterThan(1);

    const towardCamera = horizontalDirection(new THREE.Vector3(), camera.position);
    const facing = (light: THREE.DirectionalLight): number =>
      horizontalDirection(light.target.position, light.position).dot(towardCamera);
    // Le soleil éclaire la face que voit la caméra ; le contre-jour vient de derrière, en hauteur.
    expect(facing(sun)).toBeGreaterThan(0);
    expect(facing(rim)).toBeLessThan(-0.5);
    expect(rim.position.y).toBeGreaterThan(rim.target.position.y);
    // Une seule passe d'ombre.
    expect(rim.castShadow).toBe(false);
  });

  it('le plateau et le pilote reçoivent les ombres, même après un changement d’accessoire', async () => {
    create({ head: null, neck: null, body: null });
    await ready();
    const receivers = (): boolean[] => {
      const flags: boolean[] = [];
      turntable().traverse((object) => {
        if (object instanceof THREE.Mesh) flags.push(object.receiveShadow);
      });
      return flags;
    };
    // Plateau + pièce du modèle.
    expect(receivers()).toEqual([true, true]);

    fixture.componentRef.setInput('skins', { head: 'crown', neck: null, body: null });
    await fixture.whenStable();
    expect(receivers()).toEqual([true, true]);
  });

  it('cadre de près pilote (plus haut chapeau compris) et plateau, couverts par le cadre d’ombre', async () => {
    create({ head: null, neck: null, body: null });
    await ready();
    const camera = previewCamera(FakeRenderer.instances[0]);
    const sun = light('preview-sun');
    const shadowCamera = sun.shadow.camera;
    const stage = scene();
    const plate = stage.getObjectByName('preview-plate') as THREE.Mesh;
    const table = plate.parent as THREE.Object3D;

    /** Étendues du pilote et du plateau dans l'image (coordonnées normalisées, -1..1). */
    const pilotFrame = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
    const plateFrame = { ...pilotFrame };
    /** Pièces dont un sommet sort du cadre d'ombre. */
    const outsideShadow = new Set<string>();
    const point = new THREE.Vector3();
    const measure = (mesh: THREE.Mesh, frame: typeof pilotFrame): void => {
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld);
        const x = point.x;
        const y = point.y;
        const z = point.z;
        point.applyMatrix4(shadowCamera.matrixWorldInverse);
        const depth = -point.z;
        if (
          Math.abs(point.x) > shadowCamera.right ||
          Math.abs(point.y) > shadowCamera.top ||
          depth < shadowCamera.near ||
          depth > shadowCamera.far
        ) {
          outsideShadow.add(mesh.name);
        }
        point.set(x, y, z).project(camera);
        frame.left = Math.min(frame.left, point.x);
        frame.right = Math.max(frame.right, point.x);
        frame.bottom = Math.min(frame.bottom, point.y);
        frame.top = Math.max(frame.top, point.y);
      }
    };

    // Toutes les races, tous les chapeaux (le plus haut : chapeau de fête du carlin), la cape
    // qui flotte derrière, et un tour complet du plateau.
    for (const breed of BREED_LIST) {
      for (const hat of skinsForSlot('head')) {
        const model = buildRealRacerModel({
          breed: breed.id,
          skins: { head: hat.id, neck: null, body: 'cape' },
          kartColor: PREVIEW_KART_COLOR,
        });
        model.update(0, IDLE);
        table.add(model.root);
        for (let step = 0; step < TURNTABLE_STEPS; step++) {
          table.rotation.y = (step / TURNTABLE_STEPS) * Math.PI * 2;
          stage.updateMatrixWorld(true);
          sun.shadow.updateMatrices(sun);
          model.root.traverse((object) => {
            if (object instanceof THREE.Mesh) measure(object, pilotFrame);
          });
          measure(plate, plateFrame);
        }
        model.dispose();
      }
    }

    expect([...outsideShadow]).toEqual([]);
    // Pilote et plateau entiers, avec une marge…
    const overflow = (frame: typeof pilotFrame): number =>
      Math.max(-frame.left, frame.right, -frame.bottom, frame.top);
    expect(overflow(pilotFrame)).toBeLessThanOrEqual(FRAME_MARGIN);
    expect(overflow(plateFrame)).toBeLessThanOrEqual(FRAME_MARGIN);
    // … mais un pilote nettement plus grand qu'avant.
    expect((pilotFrame.top - pilotFrame.bottom) / 2).toBeGreaterThanOrEqual(MIN_PILOT_HEIGHT);
  });

  it('reconstruit le modèle quand les accessoires changent et libère l’ancien', async () => {
    create({ head: null, neck: null, body: null });
    await ready();
    const first = models[0];

    fixture.componentRef.setInput('skins', { head: null, neck: 'bowtie', body: null });
    await fixture.whenStable();

    expect(models).toHaveLength(2);
    expect(first.disposeCalls).toBe(1);
    expect(first.root.parent).toBeNull();
    expect(models[1].options.skins.neck).toBe('bowtie');
    expect(models[1].root.parent).not.toBeNull();
  });

  it('libère modèle, renderer, contexte WebGL et boucle d’animation à la destruction', async () => {
    create({ head: null, neck: null, body: 'cape' });
    await ready();
    const [renderer] = FakeRenderer.instances;
    const pendingFrame = frames().at(-1)?.id;
    expect(pendingFrame).toBeDefined();
    // La carte d'ombre du soleil appartient à la lumière.
    const sunDispose = vi.spyOn(light('preview-sun'), 'dispose');

    fixture.destroy();

    expect(sunDispose).toHaveBeenCalledTimes(1);
    expect(models[0].disposeCalls).toBe(1);
    expect(models[0].root.parent).toBeNull();
    expect(renderer.disposeCalls).toBe(1);
    expect(renderer.contextLossCalls).toBe(1);
    expect(cancelled).toContain(pendingFrame);
    // Une image déjà planifiée qui arriverait quand même ne redessine plus rien.
    frames().at(-1)?.callback(2000);
    expect(renderer.renders).toBe(0);
  });

  it('ne crée rien si le composant est détruit pendant le chargement de three.js', async () => {
    create({ head: null, neck: null, body: null }, { deferLoading: true });
    await fixture.whenStable();
    await vi.waitFor(() => expect(releaseLoader).not.toBeNull());

    fixture.destroy();
    releaseLoader?.();
    await new Promise((resolve) => setTimeout(resolve));

    expect(FakeRenderer.instances).toHaveLength(0);
    expect(models).toHaveLength(0);
    expect(frames()).toHaveLength(0);
  });

  it('bascule sur le message de repli si le contexte WebGL ne peut pas être créé', async () => {
    FakeRenderer.failNext = true;
    create({ head: null, neck: null, body: null });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(element.textContent).toContain('L’aperçu 3D n’est pas disponible'));
    await fixture.whenStable();

    expect(element.querySelector('canvas')?.hidden).toBe(true);
    expect(models).toHaveLength(0);
    expect(frames()).toHaveLength(0);
    expect(() => fixture.destroy()).not.toThrow();
  });
});
