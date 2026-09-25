import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import type { DriftTier } from '../../../../game/core/types';
import { HudDrift } from './hud-drift';

describe('HudDrift', () => {
  async function render(
    drifting: boolean,
    tier: DriftTier,
    boosting = false,
  ): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(HudDrift);
    fixture.componentRef.setInput('drifting', drifting);
    fixture.componentRef.setInput('tier', tier);
    fixture.componentRef.setInput('boosting', boosting);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('reste éteinte hors dérapage', async () => {
    const element = await render(false, 0);
    expect(element.textContent).toContain('Dérapage');
    expect(element.textContent).not.toContain('Dérapage !');
    expect(element.querySelector('[aria-label="Dérapage : pas de charge"]')).not.toBeNull();
  });

  it('s’allume dès le début du dérapage, avant le premier palier', async () => {
    const element = await render(true, 0);
    expect(element.textContent).toContain('Dérapage !');
    expect(
      element.querySelector('[aria-label="Dérapage en cours : pas encore de charge"]'),
    ).not.toBeNull();
  });

  it('annonce le palier atteint', async () => {
    const element = await render(true, 1);
    expect(element.querySelector('[aria-label="Dérapage : palier 1 sur 3 (bleu)"]')).not.toBeNull();
  });
});
