import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { STICK_RADIUS, TouchControls, steerFor, type TouchControlChange } from './touch-controls';

interface Rendered {
  fixture: ComponentFixture<TouchControls>;
  element: HTMLElement;
  changes: TouchControlChange[];
  steers: number[];
}

async function render(): Promise<Rendered> {
  const fixture = TestBed.createComponent(TouchControls);
  const changes: TouchControlChange[] = [];
  const steers: number[] = [];
  fixture.componentInstance.control.subscribe((change) => changes.push(change));
  fixture.componentInstance.steer.subscribe((steer) => steers.push(steer));
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, changes, steers };
}

/** Événement de pointeur synthétique (MouseEvent + pointerId : jsdom n'a pas toujours PointerEvent). */
function pointer(target: Element, type: string, pointerId: number, clientX = 0, clientY = 0): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  target.dispatchEvent(event);
}

function control(element: HTMLElement, name: string): HTMLElement {
  const found = element.querySelector<HTMLElement>(`[data-control="${name}"]`);
  if (!found) throw new Error(`Commande « ${name} » introuvable`);
  return found;
}

describe('steerFor', () => {
  it('nul dans la zone morte, progressif, plein braquage au bord de la course', () => {
    expect(steerFor(0)).toBe(0);
    expect(steerFor(STICK_RADIUS * 0.1)).toBe(0);
    expect(steerFor(-STICK_RADIUS * 0.1)).toBe(0);
    expect(steerFor(STICK_RADIUS * 0.56)).toBe(0.5);
    expect(steerFor(-STICK_RADIUS * 0.56)).toBe(-0.5);
    expect(steerFor(STICK_RADIUS)).toBe(1);
    expect(steerFor(-STICK_RADIUS * 3)).toBe(-1);
  });
});

describe('TouchControls', () => {
  it('réservées au toucher : masquées aux technologies d’assistance, rien de focalisable', async () => {
    const { element } = await render();
    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
    for (const name of ['steer', 'drift', 'item', 'brake']) {
      expect(control(element, name).classList.contains('touch-surface')).toBe(true);
    }
    expect(element.textContent).toContain('Saut');
    expect(element.textContent).toContain('Objet');
    expect(element.textContent).toContain('Frein');
  });

  it('joystick : apparaît sous le pouce et braque selon l’écart horizontal, recentré au relâchement', async () => {
    const { fixture, element, steers } = await render();
    const zone = control(element, 'steer');
    pointer(zone, 'pointerdown', 1, 200, 300);
    await fixture.whenStable();
    // jsdom : zone en (0, 0) ; la base (8rem = 128 px) est centrée sous le pouce.
    const base = zone.querySelector<HTMLElement>('.touch-stick-base');
    expect(base?.style.left).toBe('136px');
    expect(base?.style.top).toBe('236px');
    expect(steers).toEqual([]);

    pointer(zone, 'pointermove', 1, 200 - STICK_RADIUS, 300);
    expect(steers).toEqual([-1]);
    // Au-delà de la course : braquage plafonné, le bouton reste dans la base.
    pointer(zone, 'pointermove', 1, 200 - 3 * STICK_RADIUS, 300);
    expect(steers).toEqual([-1]);
    await fixture.whenStable();
    expect(zone.querySelector<HTMLElement>('.touch-stick-knob')?.style.transform).toBe(
      `translate(${-STICK_RADIUS}px, 0px)`,
    );

    pointer(zone, 'pointermove', 1, 200 + STICK_RADIUS * 0.56, 300);
    expect(steers).toEqual([-1, 0.5]);
    pointer(zone, 'pointerup', 1, 200, 300);
    // Perte de capture après le relâchement : pas de second signal.
    pointer(zone, 'lostpointercapture', 1);
    expect(steers).toEqual([-1, 0.5, 0]);
  });

  it('un seul pouce tient le joystick ; les autres doigts de la zone sont ignorés', async () => {
    const { element, steers } = await render();
    const zone = control(element, 'steer');
    pointer(zone, 'pointerdown', 1, 200, 300);
    pointer(zone, 'pointerdown', 2, 100, 300);
    pointer(zone, 'pointermove', 2, 100 + STICK_RADIUS, 300);
    pointer(zone, 'pointerup', 2);
    expect(steers).toEqual([]);
    pointer(zone, 'pointermove', 1, 200 + STICK_RADIUS, 300);
    expect(steers).toEqual([1]);
  });

  it('un bouton est appuyé tant que le doigt reste posé, avec un retour visuel', async () => {
    const { fixture, element, changes } = await render();
    const drift = control(element, 'drift');
    pointer(drift, 'pointerdown', 1);
    await fixture.whenStable();
    expect(changes).toEqual([{ action: 'drift', pressed: true }]);
    expect(drift.classList.contains('touch-held')).toBe(true);

    pointer(drift, 'pointerup', 1);
    pointer(drift, 'lostpointercapture', 1);
    await fixture.whenStable();
    expect(changes).toEqual([
      { action: 'drift', pressed: true },
      { action: 'drift', pressed: false },
    ]);
    expect(drift.classList.contains('touch-held')).toBe(false);
  });

  it('plusieurs doigts à la fois : joystick et boutons, chacun relâche sa propre commande', async () => {
    const { element, changes, steers } = await render();
    pointer(control(element, 'steer'), 'pointerdown', 5, 200, 300);
    pointer(control(element, 'drift'), 'pointerdown', 1);
    pointer(control(element, 'brake'), 'pointerdown', 2);
    pointer(control(element, 'item'), 'pointerdown', 3);
    pointer(control(element, 'brake'), 'pointercancel', 2);
    pointer(control(element, 'steer'), 'pointermove', 5, 200 + STICK_RADIUS, 300);
    expect(changes).toEqual([
      { action: 'drift', pressed: true },
      { action: 'brake', pressed: true },
      { action: 'item', pressed: true },
      { action: 'brake', pressed: false },
    ]);
    expect(steers).toEqual([1]);
  });
});
