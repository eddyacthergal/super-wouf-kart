import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { TRACK_CATALOG } from '../../../game/track/catalog';
import { SETTINGS_STORAGE, SettingsStore } from '../../core/settings.store';
import { MemoryStorage } from '../../testing/memory-storage';
import { CircuitSelect } from './circuit-select';

describe('CircuitSelect', () => {
  let fixture: ComponentFixture<CircuitSelect>;
  let element: HTMLElement;
  let settings: SettingsStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SETTINGS_STORAGE, useValue: new MemoryStorage() }],
    });
    settings = TestBed.inject(SettingsStore);
    fixture = TestBed.createComponent(CircuitSelect);
    element = fixture.nativeElement;
    await fixture.whenStable();
  });

  const radios = (): HTMLInputElement[] =>
    Array.from(element.querySelectorAll<HTMLInputElement>('input[type="radio"][name="track"]'));

  it('affiche le titre et une carte par circuit du catalogue, le circuit mémorisé coché', () => {
    expect(element.querySelector('main h1')?.textContent?.trim()).toBe('Circuits');
    expect(radios().map((radio) => radio.value)).toEqual(TRACK_CATALOG.map((track) => track.id));
    expect(
      radios()
        .filter((radio) => radio.checked)
        .map((radio) => radio.value),
    ).toEqual([settings.track()]);
    expect(element.querySelectorAll('app-track-preview svg polygon').length).toBe(
      TRACK_CATALOG.length * 2,
    );
  });

  it('nomme et décrit chaque radio (nom, univers, description, nombre de tours)', () => {
    for (const [index, track] of TRACK_CATALOG.entries()) {
      const radio = radios()[index];
      const name = element.querySelector(`#${radio.getAttribute('aria-labelledby')}`);
      expect(name?.textContent?.trim()).toBe(track.name);
      const described = (radio.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => element.querySelector(`#${id}`)?.textContent?.trim());
      expect(described).toEqual([
        { garden: 'Jardin', snow: 'Neige' }[track.theme],
        track.description,
        `${track.laps ?? 3} tours`,
      ]);
    }
  });

  it('mémorise le circuit choisi', async () => {
    const last = radios().at(-1);
    last?.click();
    await fixture.whenStable();
    expect(settings.track()).toBe(TRACK_CATALOG.at(-1)?.id);
    expect(last?.checked).toBe(true);
  });

  it('propose le retour à l’accueil et le départ de la course', () => {
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a')).map((link) => [
      link.textContent?.trim(),
      link.getAttribute('href'),
    ]);
    expect(links).toEqual([
      ['← Retour', '/'],
      ['C’est parti !', '/course'],
    ]);
  });

  it('les aperçus sont décoratifs', () => {
    for (const svg of Array.from(element.querySelectorAll('app-track-preview svg'))) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
