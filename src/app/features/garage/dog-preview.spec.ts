import { TestBed, type ComponentFixture } from '@angular/core/testing';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkinSelection } from '../../../game/core/types';
import type { RacerModel, RacerModelOptions, RacerVisualState } from '../../../game/dogs/racer-model';
import { DOG_PREVIEW_LOADER, DogPreview, PREVIEW_KART_COLOR, type DogPreviewModules } from './dog-preview';

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

/** Faux WebGLRenderer : compte les rendus et la libération du contexte. */
class FakeRenderer {
  static instances: FakeRenderer[] = [];
  static failNext = false;
  renders = 0;
  disposeCalls = 0;
  contextLossCalls = 0;

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
  render(): void {
    this.renders++;
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

    fixture.destroy();

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
