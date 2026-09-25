import { describe, expect, it } from 'vitest';
import { fitFovToAspect } from './viewport-fov';

/** Angle horizontal (degrés) pour un angle vertical et un rapport largeur / hauteur. */
const horizontal = (fov: number, aspect: number): number =>
  (Math.atan(Math.tan((fov * Math.PI) / 360) * aspect) * 360) / Math.PI;

describe('fitFovToAspect', () => {
  it('ne change rien en paysage ni sur un écran carré', () => {
    expect(fitFovToAspect(65, 16 / 9)).toBe(65);
    expect(fitFovToAspect(75, 2.2)).toBe(75);
    expect(fitFovToAspect(65, 1)).toBe(65);
  });

  it('en portrait, garde l’ouverture horizontale d’un écran carré', () => {
    const fov = fitFovToAspect(65, 0.75);
    expect(fov).toBeGreaterThan(65);
    expect(horizontal(fov, 0.75)).toBeCloseTo(65, 6);
  });

  it('borné à 100° sur un téléphone très allongé', () => {
    expect(fitFovToAspect(65, 0.4)).toBe(100);
    expect(horizontal(100, 0.46)).toBeGreaterThan(55);
  });

  it('rapport invalide : champ inchangé', () => {
    expect(fitFovToAspect(65, 0)).toBe(65);
    expect(fitFovToAspect(65, Number.NaN)).toBe(65);
    expect(fitFovToAspect(65, -1)).toBe(65);
  });
});
