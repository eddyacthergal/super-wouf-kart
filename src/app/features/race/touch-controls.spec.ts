import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { TouchControls, type TouchControlChange } from './touch-controls';

interface Rendered {
  fixture: ComponentFixture<TouchControls>;
  element: HTMLElement;
  changes: TouchControlChange[];
}

async function render(): Promise<Rendered> {
  const fixture = TestBed.createComponent(TouchControls);
  const changes: TouchControlChange[] = [];
  fixture.componentInstance.control.subscribe((change) => changes.push(change));
  await fixture.whenStable();
  return { fixture, element: fixture.nativeElement as HTMLElement, changes };
}

/** Événement de pointeur synthétique (MouseEvent + pointerId : jsdom n'a pas toujours PointerEvent). */
function pointer(target: Element, type: string, pointerId: number, clientX = 0): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  target.dispatchEvent(event);
}

function control(element: HTMLElement, name: string): HTMLElement {
  const found = element.querySelector<HTMLElement>(`[data-control="${name}"]`);
  if (!found) throw new Error(`Commande « ${name} » introuvable`);
  return found;
}

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

  it('un bouton est appuyé tant que le doigt reste posé, avec un retour visuel', async () => {
    const { fixture, element, changes } = await render();
    const drift = control(element, 'drift');
    pointer(drift, 'pointerdown', 1);
    await fixture.whenStable();
    expect(changes).toEqual([{ action: 'drift', pressed: true }]);
    expect(drift.classList.contains('touch-held')).toBe(true);

    pointer(drift, 'pointerup', 1);
    // Perte de capture après le relâchement : pas de second signal.
    pointer(drift, 'lostpointercapture', 1);
    await fixture.whenStable();
    expect(changes).toEqual([
      { action: 'drift', pressed: true },
      { action: 'drift', pressed: false },
    ]);
    expect(drift.classList.contains('touch-held')).toBe(false);
  });

  it('plusieurs doigts à la fois : chacun relâche sa propre commande', async () => {
    const { element, changes } = await render();
    pointer(control(element, 'drift'), 'pointerdown', 1);
    pointer(control(element, 'brake'), 'pointerdown', 2);
    pointer(control(element, 'item'), 'pointerdown', 3);
    pointer(control(element, 'brake'), 'pointercancel', 2);
    expect(changes).toEqual([
      { action: 'drift', pressed: true },
      { action: 'brake', pressed: true },
      { action: 'item', pressed: true },
      { action: 'brake', pressed: false },
    ]);
  });

  it('pavé de direction : le côté suit le doigt qui glisse, tout droit au centre', async () => {
    const { element, changes } = await render();
    const pad = control(element, 'steer');
    // jsdom : rectangle vide, le centre du pavé est en x = 0.
    pointer(pad, 'pointerdown', 4, -30);
    expect(changes).toEqual([{ action: 'left', pressed: true }]);

    pointer(pad, 'pointermove', 4, 30);
    expect(changes.slice(1)).toEqual([
      { action: 'left', pressed: false },
      { action: 'right', pressed: true },
    ]);

    pointer(pad, 'pointermove', 4, 0);
    expect(changes.slice(3)).toEqual([{ action: 'right', pressed: false }]);

    pointer(pad, 'pointermove', 4, -30);
    pointer(pad, 'pointerup', 4, -30);
    expect(changes.slice(4)).toEqual([
      { action: 'left', pressed: true },
      { action: 'left', pressed: false },
    ]);
  });

  it('ignore les mouvements d’un doigt qui n’a pas commencé sur le pavé', async () => {
    const { element, changes } = await render();
    pointer(control(element, 'steer'), 'pointermove', 9, -30);
    pointer(control(element, 'steer'), 'pointerup', 9, -30);
    expect(changes).toEqual([]);
  });
});
