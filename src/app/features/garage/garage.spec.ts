import { Component, input } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BreedId, SkinSelection } from '../../../game/core/types';
import { SETTINGS_STORAGE, SettingsStore } from '../../core/settings.store';
import { MemoryStorage } from '../../testing/memory-storage';
import { DogPreview } from './dog-preview';
import { Garage } from './garage';

/** Remplace l'aperçu three.js : on vérifie seulement ce qu'il reçoit. */
@Component({ selector: 'app-dog-preview', template: '' })
class DogPreviewStub {
  readonly breed = input.required<BreedId>();
  readonly skins = input.required<SkinSelection>();
}

describe('Garage', () => {
  let fixture: ComponentFixture<Garage>;
  let element: HTMLElement;
  let settings: SettingsStore;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: SETTINGS_STORAGE, useValue: new MemoryStorage() }],
    });
    TestBed.overrideComponent(Garage, { remove: { imports: [DogPreview] }, add: { imports: [DogPreviewStub] } });
    settings = TestBed.inject(SettingsStore);
    fixture = TestBed.createComponent(Garage);
    element = fixture.nativeElement;
    await fixture.whenStable();
  });

  const radio = (name: string, value: string): HTMLInputElement => {
    const input = element.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`);
    if (!input) throw new Error(`Radio ${name}=${value} introuvable`);
    return input;
  };

  it('affiche le titre, la légende Race et les quatre races', () => {
    expect(element.querySelector('main h1')?.textContent?.trim()).toBe('Garage');
    const legends = Array.from(element.querySelectorAll('legend')).map((legend) => legend.textContent?.trim());
    expect(legends).toEqual(['Race', 'Tête', 'Cou', 'Corps']);
    expect(element.querySelectorAll('input[name="breed"]')).toHaveLength(4);
    expect(radio('breed', 'chihuahua').checked).toBe(true);
  });

  it('étiquette chaque barre de statistique', () => {
    const labels = Array.from(element.querySelectorAll('#breed-stats-chihuahua [role="img"]')).map((bar) =>
      bar.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['Vitesse : 3 sur 5', 'Accélération : 5 sur 5', 'Poids : 1 sur 5', 'Maniabilité : 5 sur 5']);
  });

  it('nomme chaque radio de race par le nom de la race', () => {
    const input = radio('breed', 'teckel');
    const labelledBy = input.getAttribute('aria-labelledby') ?? '';
    expect(element.querySelector(`#${labelledBy}`)?.textContent?.trim()).toBe('Teckel');
  });

  it('choisir une race met à jour le store', async () => {
    radio('breed', 'teckel').click();
    await fixture.whenStable();
    expect(settings.breed()).toBe('teckel');
    expect(radio('breed', 'teckel').checked).toBe(true);
  });

  it('choisir un accessoire puis « Aucun » met à jour le store', async () => {
    radio('skin-head', 'crown').click();
    await fixture.whenStable();
    expect(settings.skins().head).toBe('crown');

    radio('skin-head', '').click();
    await fixture.whenStable();
    expect(settings.skins().head).toBeNull();
  });

  it('transmet la race et les accessoires à l’aperçu', async () => {
    settings.setBreed('carlin');
    settings.setSkin('neck', 'bowtie');
    await fixture.whenStable();
    const preview = fixture.debugElement.query((debug) => debug.componentInstance instanceof DogPreviewStub);
    const stub = preview.componentInstance as DogPreviewStub;
    expect(stub.breed()).toBe('carlin');
    expect(stub.skins().neck).toBe('bowtie');
  });

  it('propose de lancer la course et de revenir à l’accueil', () => {
    const links = Array.from(element.querySelectorAll<HTMLAnchorElement>('a')).map((link) => [
      link.textContent?.replace('←', '').trim(),
      link.getAttribute('href'),
    ]);
    expect(links).toContainEqual(['Choisir le circuit', '/circuits']);
    expect(links).toContainEqual(['Retour', '/']);
  });
});
