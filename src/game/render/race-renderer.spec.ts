import { describe, expect, it, vi } from 'vitest';
import { createCircleTrack } from '../testing/fake-track';
import { createTestRace } from '../testing/fixtures';
import { RaceRenderer } from './race-renderer';

/** Canvas sans contexte WebGL (navigateur sans WebGL, pilote bloqué…). */
function canvasWithoutWebGL(): { canvas: HTMLCanvasElement; getContext: ReturnType<typeof vi.fn> } {
  const getContext = vi.fn(() => null);
  const canvas = {
    width: 300,
    height: 150,
    clientWidth: 0,
    clientHeight: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getContext,
  };
  return { canvas: canvas as unknown as HTMLCanvasElement, getContext };
}

describe('RaceRenderer', () => {
  it('lève une erreur claire en français quand WebGL est indisponible', () => {
    const track = createCircleTrack(60);
    const race = createTestRace(track, 2);
    const { canvas, getContext } = canvasWithoutWebGL();
    // three.js journalise l'échec de création du contexte : on le fait taire ici.
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let thrown: unknown;
    try {
      new RaceRenderer(canvas, track, race.racers, { reducedMotion: false });
    } catch (error) {
      thrown = error;
    } finally {
      log.mockRestore();
    }
    expect(getContext).toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/^WebGL n'est pas disponible/);
    // L'erreur d'origine reste accessible pour le diagnostic.
    expect((thrown as Error).cause).toBeInstanceOf(Error);
  });
});
