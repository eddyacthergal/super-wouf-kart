import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { KEY_BINDINGS } from '../../../game/input/keyboard-input';
import { APP_VERSION, BUILD_DATE_LOADER } from '../../core/build-info';
import { SETTINGS_STORAGE, SettingsStore } from '../../core/settings.store';
import { MemoryStorage } from '../../testing/memory-storage';
import { CONTROL_ROWS, keyTokens, rowTokens } from './controls-help';
import { Home } from './home';

describe('Home', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: SETTINGS_STORAGE, useValue: new MemoryStorage() },
        { provide: BUILD_DATE_LOADER, useValue: () => Promise.resolve('2026-09-25T12:00:00.000Z') },
      ],
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Home);
    await fixture.whenStable();
    // La date du build arrive de façon asynchrone (build-info.json).
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('affiche le titre, l’accroche et un main', async () => {
    const element = await render();
    expect(element.querySelector('main h1')?.textContent?.trim()).toBe('Wouf Kart');
    expect(element.textContent).toContain('La course de kart des petits chiens !');
  });

  it('propose les liens Jouer et Garage', async () => {
    const element = await render();
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('nav a'));
    expect(links.map((link) => [link.textContent?.trim(), link.getAttribute('href')])).toEqual([
      ['Jouer', '/course'],
      ['Garage', '/garage'],
    ]);
  });

  it('présente clavier et écran tactile dans un même tableau, touches tirées de KEY_BINDINGS', async () => {
    const element = await render();
    const headers = Array.from(element.querySelectorAll('table thead th')).map((th) =>
      th.textContent?.trim(),
    );
    expect(headers).toEqual(['Action', 'Clavier', 'Écran tactile']);
    const rows = Array.from(element.querySelectorAll('table tbody tr'));
    expect(rows).toHaveLength(CONTROL_ROWS.length);
    const labels = rows.map((row) => row.querySelector('th')?.textContent?.trim());
    expect(labels).toContain('Accélérer');
    expect(labels).toContain('Pause');
    expect(rows[0].querySelectorAll('td')[1]?.textContent?.trim()).toBe('Auto');
    const keys = Array.from(element.querySelectorAll('table tbody kbd')).map((kbd) =>
      kbd.textContent?.trim(),
    );
    expect(keys).toContain('Espace');
    expect(keys).toContain('Échap');
    // Les flèches ont un nom prononçable pour les lecteurs d'écran.
    expect(element.querySelector('table tbody kbd .sr-only')?.textContent).toBe('Flèche haut');
  });

  it('résume le pilote choisi', async () => {
    const settings = TestBed.inject(SettingsStore);
    settings.setBreed('carlin');
    settings.setSkin('head', 'cap');
    settings.setSkin('body', 'cape');
    const element = await render();
    const summary = element.querySelector('app-pilot-summary')?.textContent ?? '';
    expect(summary).toContain('Carlin');
    expect(summary).toContain('Accessoires : Casquette et Cape de héros');
  });

  it('affiche la version du projet et la date du build', async () => {
    const element = await render();
    const footer = element.querySelector('footer app-build-version');
    expect(footer?.textContent).toContain(`Version ${APP_VERSION}`);
    expect(footer?.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-09-25T12:00:00.000Z',
    );
  });

  it('indique l’absence d’accessoire', async () => {
    const element = await render();
    expect(element.querySelector('app-pilot-summary')?.textContent).toContain('Aucun accessoire');
  });
});

describe('CONTROL_ROWS et rowTokens', () => {
  it('couvrent toutes les actions du clavier, une seule fois', () => {
    const covered = CONTROL_ROWS.flatMap((row) => row.actions);
    expect([...covered].sort()).toEqual(KEY_BINDINGS.map((binding) => binding.action).sort());
  });

  it('version courte : gauche et droite sur une ligne (« · », lu « ; »), sans variante QWERTY', () => {
    const tokens = rowTokens(['left', 'right']);
    const keys = tokens.flatMap((token) => (token.kind === 'key' ? [token.text] : []));
    expect(keys).toEqual(['←', 'Q', '→', 'D']);
    // « ou » n'est plus affiché, mais reste lu par les lecteurs d'écran.
    expect(tokens).toContainEqual({ kind: 'separator', visual: '', spoken: ' ou ' });
    expect(tokens).toContainEqual({ kind: 'separator', visual: ' · ', spoken: ' ; ' });
  });
});

describe('keyTokens', () => {
  it('sépare les touches et nomme les flèches', () => {
    expect(keyTokens('↑ ou Z/W')).toEqual([
      { kind: 'key', text: '↑', spoken: 'Flèche haut' },
      { kind: 'separator', visual: ' ou ', spoken: ' ou ' },
      { kind: 'key', text: 'Z', spoken: null },
      { kind: 'separator', visual: '/', spoken: ' ou ' },
      { kind: 'key', text: 'W', spoken: null },
    ]);
    expect(keyTokens('Espace')).toEqual([{ kind: 'key', text: 'Espace', spoken: null }]);
  });
});
