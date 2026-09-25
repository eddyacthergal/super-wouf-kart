import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_LOADER } from '../../core/game-session.service';
import { SETTINGS_STORAGE, SettingsStore } from '../../core/settings.store';
import { FAKE_INFO, FAKE_RESULTS, FakeGame, fakeHud } from '../../testing/fake-game';
import { MemoryStorage } from '../../testing/memory-storage';
import { announcementFor } from './race-announcer';
import { RacePage, isFlagOn } from './race-page';

/** Laisse le chargement asynchrone du jeu se terminer, puis le rendu. */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve));
  await fixture.whenStable();
}

describe('RacePage', () => {
  let game: FakeGame;
  let fixture: ComponentFixture<RacePage>;
  let element: HTMLElement;

  beforeEach(async () => {
    game = new FakeGame();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: GAME_LOADER, useValue: game.loader },
        { provide: SETTINGS_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    TestBed.inject(SettingsStore).setBreed('teckel');
    fixture = TestBed.createComponent(RacePage);
    fixture.componentRef.setInput('autopilot', '1');
    element = fixture.nativeElement;
    await settle(fixture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const text = (): string => element.textContent?.replace(/\s+/g, ' ') ?? '';
  const button = (label: string): HTMLButtonElement => {
    const found = Array.from(element.querySelectorAll('button')).find(
      (candidate) =>
        candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label,
    );
    if (!found) throw new Error(`Bouton « ${label} » introuvable`);
    return found;
  };
  const liveRegion = (): string =>
    element.querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '';

  async function ready(): Promise<void> {
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onPhase('racing');
    game.last.callbacks.onHud(fakeHud());
    await settle(fixture);
  }

  it('démarre la partie dans le canvas plein écran avec les réglages', () => {
    expect(game.runs).toHaveLength(1);
    const canvas = element.querySelector('canvas');
    expect(game.last.canvas).toBe(canvas);
    expect(canvas?.getAttribute('role')).toBe('img');
    expect(canvas?.getAttribute('aria-label')).toBe('Course en cours');
    expect(game.last.setup).toMatchObject({
      playerBreed: 'teckel',
      muted: false,
      autopilot: true,
      debug: false,
    });
    expect(typeof game.last.setup.reducedMotion).toBe('boolean');
    expect(text()).toContain('Chargement du jardin…');
    expect(element.querySelector('h1')?.textContent).toBe('Course');
  });

  it('annonce le chargement dans une région de statut présente avant et après', async () => {
    const status = element.querySelector('[role="status"]');
    expect(status?.textContent).toContain('Chargement du jardin…');
    game.last.callbacks.onReady(FAKE_INFO);
    await settle(fixture);
    expect(element.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent?.trim()).toBe('');
  });

  it('affiche le HUD depuis un instantané', async () => {
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onPhase('racing');
    game.last.callbacks.onHud(
      fakeHud({
        rank: 3,
        lap: 2,
        item: 'bone',
        drifting: true,
        driftTier: 2,
        boosting: true,
        wrongWay: true,
        speedKmh: 87.4,
      }),
    );
    await settle(fixture);

    expect(text()).not.toContain('Chargement du jardin');
    expect(text()).toContain('3ᵉ');
    expect(text()).toContain('/ 8');
    expect(text()).toContain('Position : 3e sur 8');
    expect(text()).toContain('Tour 2/3');
    // Chrono du HUD aux dixièmes (publié ~10 fois par seconde).
    expect(text()).toContain('1:05.3');
    expect(text()).not.toContain('1:05.32');
    expect(text()).toContain('87 km/h');
    expect(text()).toContain('Contre-sens !');
    expect(element.querySelector('[aria-label="Objet : Os"]')).not.toBeNull();
    expect(
      element.querySelector('[aria-label="Dérapage : palier 2 sur 3 (orange), turbo actif"]'),
    ).not.toBeNull();

    const minimap = element.querySelector('app-minimap');
    expect(minimap?.getAttribute('aria-hidden')).toBe('true');
    expect(minimap?.querySelectorAll('circle')).toHaveLength(3);
  });

  it('affiche la roulette d’objet avec un libellé accessible', async () => {
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onHud(fakeHud({ itemRolling: true }));
    await settle(fixture);
    expect(element.querySelector('[aria-label="Objet : tirage en cours"]')).not.toBeNull();
    expect(text()).toContain('?');
  });

  it('montre une empreinte décorative dans la case d’objet vide', async () => {
    game.last.callbacks.onReady(FAKE_INFO);
    game.last.callbacks.onHud(fakeHud({ item: null, itemRolling: false }));
    await settle(fixture);
    const slot = element.querySelector('[aria-label="Objet : aucun"]');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(slot?.textContent?.trim()).toBe('');
  });

  it('affiche le compte à rebours puis « Partez ! »', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      game.last.callbacks.onPhase('countdown');
      game.last.callbacks.onHud(fakeHud({ phase: 'countdown', countdown: 3 }));
      fixture.detectChanges();
      expect(element.querySelector('app-countdown')?.textContent?.trim()).toBe('3');

      game.last.callbacks.onPhase('racing');
      game.last.callbacks.onHud(fakeHud({ phase: 'racing', countdown: null }));
      fixture.detectChanges();
      expect(element.querySelector('app-countdown')?.textContent?.trim()).toBe('Partez !');

      vi.advanceTimersByTime(1100);
      fixture.detectChanges();
      expect(element.querySelector('app-countdown')?.textContent?.trim()).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ouvre le dialogue de pause (focus sur « Reprendre ») et reprend', async () => {
    await ready();
    button('Pause').click();
    await settle(fixture);

    const dialog = element.querySelector('dialog');
    expect(game.last.handle.pauseCalls).toBe(1);
    expect(dialog?.hasAttribute('open')).toBe(true);
    expect(dialog?.getAttribute('aria-labelledby')).toBe('pause-title');
    expect(document.activeElement).toBe(button('Reprendre'));

    button('Reprendre').click();
    await settle(fixture);
    expect(game.last.handle.resumeCalls).toBe(1);
    expect(dialog?.hasAttribute('open')).toBe(false);
  });

  it('Échap (cancel) reprend la course', async () => {
    await ready();
    game.last.handle.pause();
    await settle(fixture);
    element.querySelector('dialog')?.dispatchEvent(new Event('cancel', { cancelable: true }));
    await settle(fixture);
    expect(game.last.handle.resumeCalls).toBe(1);
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('la touche P dans le menu reprend la course, sans atteindre le jeu (window)', async () => {
    await ready();
    game.last.handle.pause();
    await settle(fixture);
    const reachedWindow = vi.fn();
    window.addEventListener('keydown', reachedWindow);
    try {
      button('Reprendre').dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', bubbles: true }),
      );
      await settle(fixture);
    } finally {
      window.removeEventListener('keydown', reachedWindow);
    }
    expect(game.last.handle.resumeCalls).toBe(1);
    expect(reachedWindow).not.toHaveBeenCalled();
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('« Quitter » revient à l’accueil', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await ready();
    game.last.handle.pause();
    await settle(fixture);
    button('Quitter').click();
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('Espace intercepté par le jeu (dérapage) n’active pas un bouton resté focalisé', async () => {
    await ready();
    const sound = button('Couper le son');
    const gameKeyboard = (event: KeyboardEvent): void => {
      if (event.code === 'Space') event.preventDefault();
    };
    const press = (): KeyboardEvent => {
      sound.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
      );
      const keyup = new KeyboardEvent('keyup', {
        code: 'Space',
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      sound.dispatchEvent(keyup);
      return keyup;
    };

    window.addEventListener('keydown', gameKeyboard);
    try {
      expect(press().defaultPrevented).toBe(true);
    } finally {
      window.removeEventListener('keydown', gameKeyboard);
    }
    // Sans jeu à l'écoute, Espace garde son rôle natif d'activation.
    expect(press().defaultPrevented).toBe(false);
  });

  it('« Recommencer » relance une partie dans un canvas neuf', async () => {
    await ready();
    const first = game.last;
    first.handle.pause();
    await settle(fixture);
    button('Recommencer').click();
    await settle(fixture);

    expect(first.handle.disposeCalls).toBe(1);
    expect(game.runs).toHaveLength(2);
    expect(game.last.canvas).not.toBe(first.canvas);
    expect(game.last.canvas.isConnected).toBe(true);
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('le bouton son bascule aria-pressed, le store et le jeu', async () => {
    await ready();
    const sound = button('Couper le son');
    expect(sound.getAttribute('aria-pressed')).toBe('false');
    sound.click();
    await settle(fixture);
    expect(sound.getAttribute('aria-pressed')).toBe('true');
    expect(TestBed.inject(SettingsStore).muted()).toBe(true);
    expect(game.last.handle.mutedCalls).toEqual([true]);
  });

  it('affiche les résultats et donne le focus au titre', async () => {
    await ready();
    game.last.callbacks.onResults(FAKE_RESULTS);
    await settle(fixture);

    const title = element.querySelector('#results-title');
    expect(title?.textContent?.trim()).toBe('Résultats');
    expect(document.activeElement).toBe(title);
    expect(element.querySelector('table caption')?.textContent?.trim()).toBe(
      'Classement de la course',
    );
    expect(
      Array.from(element.querySelectorAll('thead th')).map((th) => th.getAttribute('scope')),
    ).toEqual(['col', 'col', 'col', 'col']);
    const rows = Array.from(element.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(3);
    expect(rows[1].textContent).toContain('Toi');
    expect(rows[1].classList).toContain('bg-sun-200');
    expect(rows[1].textContent).toContain('2:05.25');
    expect(rows[2].textContent).toContain('(estimé)');
    expect(text()).toContain('Tu termines à la 2e place !');
    // Le HUD s'efface derrière les résultats.
    expect(element.querySelector('app-race-hud')).toBeNull();
  });

  it('« Rejouer » relance une partie', async () => {
    await ready();
    game.last.callbacks.onResults(FAKE_RESULTS);
    await settle(fixture);
    button('Rejouer').click();
    await settle(fixture);
    expect(game.runs).toHaveLength(2);
    expect(element.querySelector('#results-title')).toBeNull();
  });

  it('annonce les tours et l’arrivée dans la région aria-live', async () => {
    await ready();
    expect(liveRegion()).toBe('');

    game.last.callbacks.onHud(fakeHud({ lap: 2 }));
    await settle(fixture);
    expect(liveRegion()).toBe('Tour 2 sur 3');

    game.last.callbacks.onHud(fakeHud({ lap: 2, raceTime: 70 }));
    await settle(fixture);
    expect(liveRegion()).toBe('Tour 2 sur 3');

    game.last.callbacks.onHud(fakeHud({ lap: 3 }));
    await settle(fixture);
    expect(liveRegion()).toBe('Dernier tour !');

    game.last.callbacks.onResults(FAKE_RESULTS);
    await settle(fixture);
    expect(liveRegion()).toBe('Arrivée : 2e place');
  });

  it('affiche une erreur claire avec un retour à l’accueil, et y place le focus', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    game.last.callbacks.onError(new Error('WebGL context lost'));
    await settle(fixture);
    const alert = element.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('WebGL indisponible');
    expect(alert?.querySelector('a')?.getAttribute('href')).toBe('/');
    expect(alert?.querySelector('a')?.textContent?.trim()).toBe('Retour à l’accueil');
    expect(document.activeElement).toBe(alert?.querySelector('h2'));
    expect(element.querySelector('app-race-hud')).toBeNull();
  });

  it('une erreur pendant la pause ferme le menu et place le focus sur le message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await ready();
    game.last.handle.pause();
    await settle(fixture);
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(true);

    game.last.callbacks.onError(new Error('boom'));
    await settle(fixture);
    expect(element.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(document.activeElement?.textContent?.trim()).toBe('Oh non !');
  });

  it('un échec du chargement du jeu affiche l’erreur de chargement', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixture.destroy();
    game.loadError = new TypeError('Failed to fetch dynamically imported module');

    const next = TestBed.createComponent(RacePage);
    await settle(next);
    const nextElement = next.nativeElement as HTMLElement;
    expect(nextElement.querySelector('[role="alert"]')?.textContent).toContain(
      'Impossible de charger le jeu',
    );
    expect(nextElement.textContent).not.toContain('Chargement du jardin');
  });

  it('arrête la partie quand la page est détruite', () => {
    const { handle } = game.last;
    fixture.destroy();
    expect(handle.disposeCalls).toBe(1);
  });
});

describe('RacePage et les paramètres d’URL', () => {
  it('lit autopilot et debug depuis les query params', async () => {
    const game = new FakeGame();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'course', component: RacePage }], withComponentInputBinding()),
        { provide: GAME_LOADER, useValue: game.loader },
        { provide: SETTINGS_STORAGE, useValue: new MemoryStorage() },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/course?autopilot=true&debug=1', RacePage);
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve));
    expect(game.last.setup.autopilot).toBe(true);
    expect(game.last.setup.debug).toBe(true);
  });
});

describe('isFlagOn', () => {
  it('accepte « 1 » et « true » seulement', () => {
    expect(isFlagOn('1')).toBe(true);
    expect(isFlagOn('true')).toBe(true);
    expect(isFlagOn('0')).toBe(false);
    expect(isFlagOn('')).toBe(false);
    expect(isFlagOn(undefined)).toBe(false);
  });
});

describe('announcementFor', () => {
  const state = (lap: number | null, finishRank: number | null = null) => ({
    lap,
    laps: 3,
    finishRank,
  });

  it('n’annonce rien au premier tour ni sans changement', () => {
    expect(announcementFor(state(1), undefined)).toBeNull();
    expect(announcementFor(state(2), state(2))).toBeNull();
  });

  it('annonce le nouveau tour, le dernier tour et l’arrivée', () => {
    expect(announcementFor(state(2), state(1))).toBe('Tour 2 sur 3');
    expect(announcementFor(state(3), state(2))).toBe('Dernier tour !');
    expect(announcementFor(state(3, 1), state(3))).toBe('Arrivée : 1re place');
  });
});
