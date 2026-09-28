/**
 * Rendu WebGL de la course : crée le WebGLRenderer et dessine la RaceScene.
 * Volontairement mince (non testable en Node) : toute la logique est dans RaceScene.
 */
import * as THREE from 'three';
import type { GameEvent, RaceState, RacerState, TrackQuery } from '../core/types';
import { RaceScene, type RaceSceneOptions } from './race-scene';

const MAX_PIXEL_RATIO = 2;
const TONE_MAPPING_EXPOSURE = 1;

/** Compteurs de la dernière image dessinée, passe d'ombre comprise (journal `?debug=1`). */
export interface RenderStats {
  /** Appels de dessin. */
  calls: number;
  triangles: number;
}

export class RaceRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly raceScene: RaceScene;
  private disposed = false;
  /** Recopie de `renderer.info`, préallouée : une lecture n'alloue rien. */
  private readonly lastStats: RenderStats = { calls: 0, triangles: 0 };

  constructor(
    canvas: HTMLCanvasElement,
    track: TrackQuery,
    racers: readonly RacerState[],
    options: RaceSceneOptions,
  ) {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch (cause) {
      throw new Error(
        "WebGL n'est pas disponible sur cet appareil ou dans ce navigateur : impossible d'afficher la course.",
        { cause },
      );
    }
    const renderer = this.renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap a été retiré de three r186 (avertissement puis repli) : PCFShadowMap
    // y filtre désormais en douceur selon shadow.radius.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    renderer.setPixelRatio(Math.min(ratio, MAX_PIXEL_RATIO));

    try {
      this.raceScene = new RaceScene(track, racers, options);
    } catch (error) {
      releaseRenderer(renderer);
      throw error;
    }
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (width > 0 && height > 0) this.resize(width, height);
  }

  render(state: RaceState, alpha: number, frameDt: number, events: readonly GameEvent[]): void {
    if (this.disposed) return;
    this.raceScene.update(state, alpha, frameDt, events);
    this.renderer.render(this.raceScene.scene, this.raceScene.camera);
  }

  /**
   * Appels de dessin et triangles de la dernière image. three remet `info` à zéro au début de
   * chaque `render()`, avant la passe d'ombre : les deux passes sont comptées.
   */
  stats(): Readonly<RenderStats> {
    const counters = this.renderer.info.render;
    this.lastStats.calls = counters.calls;
    this.lastStats.triangles = counters.triangles;
    return this.lastStats;
  }

  /** Taille du tampon de dessin en pixels CSS (le style du canvas n'est pas modifié). */
  resize(width: number, height: number): void {
    if (this.disposed || !(width > 0 && height > 0)) return;
    this.renderer.setSize(width, height, false);
    this.raceScene.setAspect(width / height);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.raceScene.dispose();
    this.renderer.renderLists.dispose();
    releaseRenderer(this.renderer);
  }
}

/**
 * Libère le renderer et rend aussitôt son contexte WebGL au navigateur : sans cela, chaque partie
 * garde le sien jusqu'au ramasse-miettes et Chrome finit par perdre les plus anciens
 * (« Too many active WebGL contexts ») après une quinzaine de courses.
 */
function releaseRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
  renderer.forceContextLoss();
}
