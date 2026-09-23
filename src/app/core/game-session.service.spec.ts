import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SKINS } from '../../game/core/types';
import type { RaceSetup } from '../../game/game-api';
import { FAKE_INFO, FAKE_RESULTS, FakeGame, fakeHud } from '../testing/fake-game';
import { GAME_LOADER, GameSessionService, describeGameError } from './game-session.service';

const SETUP: RaceSetup = { playerBreed: 'carlin', playerSkins: EMPTY_SKINS, muted: false, reducedMotion: false };

describe('GameSessionService', () => {
  let game: FakeGame;
  let session: GameSessionService;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    game = new FakeGame();
    TestBed.configureTestingModule({ providers: [{ provide: GAME_LOADER, useValue: game.loader }] });
    session = TestBed.inject(GameSessionService);
    canvas = document.createElement('canvas');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('crée la partie avec le canvas et les réglages', async () => {
    const started = session.start(canvas, SETUP);
    expect(session.loading()).toBe(true);
    await started;
    expect(game.runs).toHaveLength(1);
    expect(game.last.canvas).toBe(canvas);
    expect(game.last.setup).toEqual(SETUP);
    expect(session.error()).toBeNull();
  });

  it('publie l’état reçu par les rappels du jeu', async () => {
    await session.start(canvas, SETUP);
    const { callbacks } = game.last;

    callbacks.onReady(FAKE_INFO);
    expect(session.info()).toBe(FAKE_INFO);
    expect(session.loading()).toBe(false);

    const snapshot = fakeHud({ lap: 2 });
    callbacks.onHud(snapshot);
    expect(session.hud()).toBe(snapshot);

    callbacks.onPhase('racing');
    expect(session.phase()).toBe('racing');

    callbacks.onResults(FAKE_RESULTS);
    expect(session.results()).toBe(FAKE_RESULTS);

    callbacks.onPauseChange(true);
    expect(session.paused()).toBe(true);
    callbacks.onPauseChange(false);
    expect(session.paused()).toBe(false);
  });

  it('transmet pause, reprise et son au handle', async () => {
    await session.start(canvas, SETUP);
    const { handle } = game.last;

    session.pause();
    expect(handle.pauseCalls).toBe(1);
    expect(session.paused()).toBe(true);

    session.resume();
    expect(handle.resumeCalls).toBe(1);
    expect(session.paused()).toBe(false);

    session.setMuted(true);
    expect(handle.mutedCalls).toEqual([true]);
  });

  it('stop libère la partie, réinitialise l’état et ignore les rappels tardifs', async () => {
    await session.start(canvas, SETUP);
    const { callbacks, handle } = game.last;
    callbacks.onReady(FAKE_INFO);
    callbacks.onHud(fakeHud());

    session.stop();
    expect(handle.disposeCalls).toBe(1);
    expect(session.info()).toBeNull();
    expect(session.hud()).toBeNull();

    callbacks.onHud(fakeHud());
    expect(session.hud()).toBeNull();
  });

  it('restart arrête la partie précédente avant d’en créer une nouvelle', async () => {
    await session.start(canvas, SETUP);
    const first = game.last.handle;
    await session.restart(canvas, SETUP);
    expect(first.disposeCalls).toBe(1);
    expect(game.runs).toHaveLength(2);
  });

  it('ignore les rappels de la partie précédente après un redémarrage', async () => {
    await session.start(canvas, SETUP);
    const previous = game.last.callbacks;
    await session.restart(canvas, SETUP);
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onHud(fakeHud({ lap: 1 }));

    previous.onHud(fakeHud({ lap: 3 }));
    previous.onResults(FAKE_RESULTS);
    previous.onPauseChange(true);
    previous.onError(new Error('tardive'));

    expect(session.hud()?.lap).toBe(1);
    expect(session.results()).toBeNull();
    expect(session.paused()).toBe(false);
    expect(session.error()).toBeNull();
    expect(game.last.handle.disposeCalls).toBe(0);
  });

  it('une erreur signalée pendant la création libère la partie orpheline', async () => {
    game.duringCreate = (callbacks) => callbacks.onError(new Error('shader'));
    await session.start(canvas, SETUP);
    expect(game.last.handle.disposeCalls).toBe(1);
    expect(session.error()).toBe('Oups ! Une erreur inattendue a interrompu la course.');
    expect(session.loading()).toBe(false);

    // La partie orpheline n'est plus pilotée par le service.
    session.pause();
    expect(game.last.handle.pauseCalls).toBe(0);
  });

  it('onReady reçu pendant la création termine le chargement', async () => {
    game.duringCreate = (callbacks) => callbacks.onReady(FAKE_INFO);
    await session.start(canvas, SETUP);
    expect(session.info()).toBe(FAKE_INFO);
    expect(session.loading()).toBe(false);
    session.pause();
    expect(game.last.handle.pauseCalls).toBe(1);
  });

  it('onError affiche un message lisible et arrête la partie', async () => {
    await session.start(canvas, SETUP);
    const { callbacks, handle } = game.last;
    callbacks.onReady(FAKE_INFO);

    callbacks.onError(new Error('boom'));
    expect(session.error()).toBe('Oups ! Une erreur inattendue a interrompu la course.');
    expect(handle.disposeCalls).toBe(1);
    expect(session.info()).toBeNull();
  });

  it('un échec du chargement du jeu devient une erreur', async () => {
    game.loadError = new TypeError('Failed to fetch dynamically imported module');
    await session.start(canvas, SETUP);
    expect(session.error()).toContain('Impossible de charger le jeu');
    expect(session.loading()).toBe(false);
  });

  it('une création impossible (WebGL) devient une erreur', async () => {
    game.createError = new Error('Error creating WebGL context.');
    await session.start(canvas, SETUP);
    expect(session.error()).toContain('WebGL indisponible');
    expect(session.loading()).toBe(false);
  });

  it('un arrêt pendant le chargement annule la création', async () => {
    const started = session.start(canvas, SETUP);
    session.stop();
    await started;
    expect(game.runs).toHaveLength(0);
    expect(session.loading()).toBe(false);
  });

  it('s’arrête quand l’injecteur est détruit', async () => {
    await session.start(canvas, SETUP);
    const { handle } = game.last;
    TestBed.resetTestingModule();
    expect(handle.disposeCalls).toBe(1);
  });
});

describe('describeGameError', () => {
  it('distingue WebGL, chargement et erreur générique', () => {
    expect(describeGameError(new Error('WebGL not supported'), 'run')).toContain('WebGL');
    expect(describeGameError('network', 'load')).toContain('Impossible de charger');
    expect(describeGameError(42, 'run')).toContain('erreur inattendue');
  });
});
