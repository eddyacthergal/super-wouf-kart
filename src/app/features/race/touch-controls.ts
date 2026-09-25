import { Component, output, signal } from '@angular/core';
import type { TouchAction } from '../../../game/game-api';

export interface TouchControlChange {
  action: TouchAction;
  pressed: boolean;
}

type Side = 'left' | 'right';
type ButtonAction = Exclude<TouchAction, Side>;

const ACTIONS: readonly TouchAction[] = ['left', 'right', 'brake', 'drift', 'item'];

/** Zone morte au centre du pavé de direction (fraction de sa largeur) : on roule tout droit. */
const DEAD_ZONE = 0.12;

/**
 * Commandes tactiles de la course (téléphone, tablette). Pouce gauche : pavé de direction, on
 * glisse d'un côté à l'autre. Pouce droit : Saut (maintenu = dérapage), Objet, Frein. Accélération
 * automatique. Plusieurs doigts à la fois ; chaque doigt est capturé par sa commande, qui reçoit
 * donc toujours son relâchement. Réservées au toucher : masquées aux technologies d'assistance,
 * le clavier offre les mêmes commandes.
 */
@Component({
  selector: 'app-touch-controls',
  host: {
    class:
      'pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 select-none ' +
      'pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] ' +
      'pl-[max(1rem,env(safe-area-inset-left))]',
    'aria-hidden': 'true',
    '(contextmenu)': '$event.preventDefault()',
  },
  template: `
    <div
      data-control="steer"
      class="touch-surface pointer-events-auto flex h-24 w-44 overflow-hidden rounded-full border-2 border-white/80 bg-slate-900/75 text-white shadow-lg portrait:w-36"
      (pointerdown)="steerDown($event)"
      (pointermove)="steerMove($event)"
      (pointerup)="steerUp($event)"
      (pointercancel)="steerUp($event)"
      (lostpointercapture)="steerUp($event)"
    >
      <span class="grid flex-1 place-items-center" [class.touch-held]="held().has('left')">
        <svg viewBox="0 0 24 24" class="size-10" focusable="false">
          <path
            d="M15 5 8 12l7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="w-0.5 bg-white/40"></span>
      <span class="grid flex-1 place-items-center" [class.touch-held]="held().has('right')">
        <svg viewBox="0 0 24 24" class="size-10" focusable="false">
          <path
            d="m9 5 7 7-7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </span>
    </div>

    <div class="grid grid-cols-[auto_auto] items-end gap-3">
      <div
        data-control="item"
        class="touch-surface touch-button col-start-2 size-16 justify-self-center"
        [class.touch-held]="held().has('item')"
        (pointerdown)="buttonDown('item', $event)"
        (pointerup)="buttonUp($event)"
        (pointercancel)="buttonUp($event)"
        (lostpointercapture)="buttonUp($event)"
      >
        <svg viewBox="0 0 24 24" class="size-7" focusable="false">
          <rect
            x="4"
            y="4"
            width="16"
            height="16"
            rx="3"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
          />
          <path
            d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
          />
          <circle cx="12" cy="16.8" r="1.2" fill="currentColor" />
        </svg>
        <span class="text-xs font-black">Objet</span>
      </div>
      <div
        data-control="brake"
        class="touch-surface touch-button col-start-1 row-start-2 size-16"
        [class.touch-held]="held().has('brake')"
        (pointerdown)="buttonDown('brake', $event)"
        (pointerup)="buttonUp($event)"
        (pointercancel)="buttonUp($event)"
        (lostpointercapture)="buttonUp($event)"
      >
        <svg viewBox="0 0 24 24" class="size-7" focusable="false">
          <path
            d="m6 7 6 5 6-5M6 13l6 5 6-5"
            fill="none"
            stroke="currentColor"
            stroke-width="2.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span class="text-xs font-black">Frein</span>
      </div>
      <div
        data-control="drift"
        class="touch-surface touch-button col-start-2 row-start-2 size-22 border-sun-400"
        [class.touch-held]="held().has('drift')"
        (pointerdown)="buttonDown('drift', $event)"
        (pointerup)="buttonUp($event)"
        (pointercancel)="buttonUp($event)"
        (lostpointercapture)="buttonUp($event)"
      >
        <svg viewBox="0 0 24 24" class="size-9" focusable="false">
          <path
            d="M4 18c3-8 13-8 16 0"
            fill="none"
            stroke="currentColor"
            stroke-width="2.6"
            stroke-linecap="round"
          />
          <path d="m12 3-3 4h6z" fill="currentColor" />
        </svg>
        <span class="text-sm font-black">Saut</span>
      </div>
    </div>
  `,
})
export class TouchControls {
  /** Appui ou relâchement d'une commande (une émission par changement d'état). */
  readonly control = output<TouchControlChange>();

  /** Commandes actuellement appuyées (retour visuel). */
  protected readonly held = signal<ReadonlySet<TouchAction>>(new Set<TouchAction>());
  /** Doigts posés sur le pavé de direction, avec le côté visé (null : zone morte). */
  private readonly steering = new Map<number, Side | null>();
  /** Doigts posés sur un bouton. */
  private readonly buttons = new Map<number, ButtonAction>();

  protected steerDown(event: PointerEvent): void {
    this.capture(event);
    this.steering.set(event.pointerId, sideOf(event));
    this.sync();
  }

  protected steerMove(event: PointerEvent): void {
    if (!this.steering.has(event.pointerId)) return;
    this.steering.set(event.pointerId, sideOf(event));
    this.sync();
  }

  protected steerUp(event: PointerEvent): void {
    if (this.steering.delete(event.pointerId)) this.sync();
  }

  protected buttonDown(action: ButtonAction, event: PointerEvent): void {
    this.capture(event);
    this.buttons.set(event.pointerId, action);
    this.sync();
  }

  protected buttonUp(event: PointerEvent): void {
    if (this.buttons.delete(event.pointerId)) this.sync();
  }

  /** Garde le doigt sur sa commande même s'il en sort, et évite les effets du navigateur (sélection, souris simulée). */
  private capture(event: PointerEvent): void {
    event.preventDefault();
    const target = event.currentTarget;
    if (target instanceof Element && typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Pointeur déjà relâché : son relâchement arrive quand même par pointerup.
      }
    }
  }

  /** Recalcule les commandes appuyées et signale celles qui changent. */
  private sync(): void {
    const next = new Set<TouchAction>();
    for (const side of this.steering.values()) if (side) next.add(side);
    for (const action of this.buttons.values()) next.add(action);
    const previous = this.held();
    for (const action of ACTIONS) {
      const pressed = next.has(action);
      if (pressed !== previous.has(action)) this.control.emit({ action, pressed });
    }
    this.held.set(next);
  }
}

/** Côté du pavé visé par le doigt (null au centre, dans la zone morte). */
function sideOf(event: PointerEvent): Side | null {
  const pad = event.currentTarget;
  if (!(pad instanceof Element)) return null;
  const rect = pad.getBoundingClientRect();
  const offset = event.clientX - (rect.left + rect.width / 2);
  const dead = (rect.width * DEAD_ZONE) / 2;
  if (offset < -dead) return 'left';
  if (offset > dead) return 'right';
  return null;
}
