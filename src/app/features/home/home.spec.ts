import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { KEY_BINDINGS } from '../../../game/input/keyboard-input';
import { SETTINGS_STORAGE, SettingsStore } from '../../core/settings.store';
import { MemoryStorage } from '../../testing/memory-storage';
import { keyTokens } from './controls-help';
import { Home } from './home';

describe('Home', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SETTINGS_STORAGE, useValue: new MemoryStorage() }],
    });
  });

  async function render(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(Home);
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

  it('génère l’aide des commandes depuis KEY_BINDINGS', async () => {
    const element = await render();
    const terms = Array.from(element.querySelectorAll('dl dt')).map((dt) => dt.textContent?.trim());
    expect(terms).toHaveLength(KEY_BINDINGS.length);
    expect(terms).toContain('Accélérer');
    expect(terms).toContain('Pause');
    const keys = Array.from(element.querySelectorAll('dl dd kbd')).map((kbd) => kbd.textContent?.trim());
    expect(keys).toContain('Espace');
    expect(keys).toContain('Échap');
    // Les flèches ont un nom prononçable pour les lecteurs d'écran.
    expect(element.querySelector('dl dd kbd .sr-only')?.textContent).toBe('Flèche haut');
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

  it('indique l’absence d’accessoire', async () => {
    const element = await render();
    expect(element.querySelector('app-pilot-summary')?.textContent).toContain('Aucun accessoire');
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
