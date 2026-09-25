import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { BreedId } from '../../game/core/types';
import { BREED_LIST, BREEDS } from '../../game/dogs/breeds';
import { DogPortrait, dogFace } from './dog-portrait';

async function render(breed: BreedId): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(DogPortrait);
  fixture.componentRef.setInput('breed', breed);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('dogFace', () => {
  it('reprend les couleurs et le style d’oreilles de chaque race', () => {
    for (const breed of BREED_LIST) {
      const face = dogFace(breed.id);
      expect(face.fur).toBe(breed.look.furColor);
      expect(face.ear).toBe(breed.look.earColor);
      expect(face.muzzle).toBe(breed.look.muzzleColor);
      expect(face.earStyle).toBe(breed.look.earStyle);
    }
  });

  it('distingue les races : museau écrasé du carlin, long du teckel, tache du jack russell', () => {
    expect(dogFace('carlin').muzzleRy).toBeLessThan(dogFace('chihuahua').muzzleRy);
    expect(dogFace('teckel').muzzleRy).toBeGreaterThan(dogFace('chihuahua').muzzleRy);
    expect(dogFace('carlin').mask).toBe(BREEDS.carlin.look.eyeMaskColor);
    expect(dogFace('carlin').wrinkles).toBe(true);
    expect(dogFace('jack-russell').patch).toBe(BREEDS['jack-russell'].look.patchColor);
    expect(dogFace('chihuahua').patch).toBeNull();
  });
});

describe('DogPortrait', () => {
  it('décoratif : masqué aux lecteurs d’écran', async () => {
    const element = await render('teckel');
    expect(element.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('dessine le pelage de la race et ses oreilles', async () => {
    const teckel = await render('teckel');
    const fills = Array.from(teckel.querySelectorAll('[fill]')).map((node) =>
      node.getAttribute('fill'),
    );
    expect(fills).toContain(BREEDS.teckel.look.furColor);
    expect(fills).toContain(BREEDS.teckel.look.earColor);

    const carlin = await render('carlin');
    const carlinFills = Array.from(carlin.querySelectorAll('[fill]')).map((node) =>
      node.getAttribute('fill'),
    );
    expect(carlinFills).toContain(BREEDS.carlin.look.eyeMaskColor);
    expect(carlinFills).not.toContain(BREEDS.teckel.look.furColor);
  });
});
