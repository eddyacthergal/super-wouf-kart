import { Component, computed, output, signal } from '@angular/core';
import type { TouchAction } from '../../../game/game-api';

export interface TouchControlChange {
  action: TouchAction;
  pressed: boolean;
}

/** Joystick affiché : coin haut gauche de sa base (px, dans la zone de direction) et décalage du bouton. */
interface Stick {
  left: number;
  top: number;
  dx: number;
  dy: number;
}

const ACTIONS: readonly TouchAction[] = ['brake', 'drift', 'item'];

/** Course du bouton du joystick (px) : le braquage est maximal à cette distance du centre. */
export const STICK_RADIUS = 56;
/** Demi-côté de la base du joystick (px), cf. `.touch-stick-base` (8rem) dans styles.css. */
const STICK_BASE_HALF = 64;
/** Zone morte (fraction de la course) : un pouce qui tremble ne fait pas zigzaguer le kart. */
const DEAD_ZONE = 0.12;

/**
 * Commandes tactiles de la course (téléphone, tablette), sur le modèle des jeux mobiles.
 * Pouce gauche : joystick flottant, qui apparaît là où le pouce se pose dans la moitié gauche de
 * l'écran ; le braquage suit l'écart horizontal (analogique). Pouce droit : Saut (maintenu =
 * dérapage), Objet, Frein. Accélération automatique. Chaque doigt est capturé par sa commande, qui
 * reçoit donc toujours son relâchement. Réservées au toucher : masquées aux technologies
 * d'assistance, le clavier offre les mêmes commandes.
 */
@Component({
  selector: 'app-touch-controls',
  host: {
    class: 'pointer-events-none absolute inset-0 select-none',
    'aria-hidden': 'true',
    '(contextmenu)': '$event.preventDefault()',
  },
  template: `
    <!-- Zone de direction : moitié gauche, sous la barre du haut (HUD). -->
    <div
      data-control="steer"
      class="touch-surface pointer-events-auto absolute bottom-0 left-0 top-24 w-1/2"
      (pointerdown)="stickDown($event)"
      (pointermove)="stickMove($event)"
      (pointerup)="stickUp($event)"
      (pointercancel)="stickUp($event)"
      (lostpointercapture)="stickUp($event)"
    >
      @if (stick(); as current) {
        <div
          class="touch-stick-base absolute"
          [style.left.px]="current.left"
          [style.top.px]="current.top"
        >
          <div class="touch-stick-knob" [style.transform]="knobTransform()"></div>
        </div>
      } @else {
        <!-- Repère au repos : où poser le pouce. -->
        <div
          class="touch-stick-base absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-[max(1.5rem,env(safe-area-inset-left))] opacity-60"
        >
          <div class="touch-stick-knob"></div>
        </div>
      }
    </div>

    <div
      class="absolute right-0 bottom-0 grid grid-cols-[auto_auto] items-end gap-3 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <div
        data-control="item"
        class="touch-surface touch-button col-start-2 size-18 justify-self-center"
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
        class="touch-surface touch-button col-start-1 row-start-2 size-18"
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
        class="touch-surface touch-button col-start-2 row-start-2 size-24 border-sun-400"
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
  /** Appui ou relâchement d'un bouton (une émission par changement d'état). */
  readonly control = output<TouchControlChange>();
  /** Braquage du joystick, de -1 (gauche) à +1 (droite) ; émis à chaque changement. */
  readonly steer = output<number>();

  /** Boutons actuellement appuyés (retour visuel). */
  protected readonly held = signal<ReadonlySet<TouchAction>>(new Set<TouchAction>());
  /** Joystick sous le pouce, ou null au repos. */
  protected readonly stick = signal<Stick | null>(null);
  protected readonly knobTransform = computed(() => {
    const current = this.stick();
    return current ? `translate(${current.dx}px, ${current.dy}px)` : null;
  });

  /** Doigt qui tient le joystick (un seul à la fois). */
  private stickPointer: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lastSteer = 0;
  /** Doigts posés sur un bouton. */
  private readonly buttons = new Map<number, TouchAction>();

  protected stickDown(event: PointerEvent): void {
    if (this.stickPointer !== null) return;
    capture(event);
    this.stickPointer = event.pointerId;
    const zone = zoneRect(event);
    this.stickOrigin = { x: event.clientX, y: event.clientY };
    // Base centrée sous le pouce.
    this.stick.set({
      left: event.clientX - zone.left - STICK_BASE_HALF,
      top: event.clientY - zone.top - STICK_BASE_HALF,
      dx: 0,
      dy: 0,
    });
    this.emitSteer(0);
  }

  protected stickMove(event: PointerEvent): void {
    const current = this.stick();
    if (event.pointerId !== this.stickPointer || !current) return;
    let dx = event.clientX - this.stickOrigin.x;
    let dy = event.clientY - this.stickOrigin.y;
    // Le bouton reste dans le cercle de la base ; au-delà, seul son angle suit le doigt.
    const distance = Math.hypot(dx, dy);
    if (distance > STICK_RADIUS) {
      dx = (dx / distance) * STICK_RADIUS;
      dy = (dy / distance) * STICK_RADIUS;
    }
    this.stick.set({ ...current, dx, dy });
    this.emitSteer(steerFor(dx));
  }

  protected stickUp(event: PointerEvent): void {
    if (event.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.stick.set(null);
    this.emitSteer(0);
  }

  protected buttonDown(action: TouchAction, event: PointerEvent): void {
    capture(event);
    this.buttons.set(event.pointerId, action);
    this.syncButtons();
  }

  protected buttonUp(event: PointerEvent): void {
    if (this.buttons.delete(event.pointerId)) this.syncButtons();
  }

  private emitSteer(value: number): void {
    if (value === this.lastSteer) return;
    this.lastSteer = value;
    this.steer.emit(value);
  }

  /** Recalcule les boutons appuyés et signale ceux qui changent. */
  private syncButtons(): void {
    const next = new Set<TouchAction>(this.buttons.values());
    const previous = this.held();
    for (const action of ACTIONS) {
      const pressed = next.has(action);
      if (pressed !== previous.has(action)) this.control.emit({ action, pressed });
    }
    this.held.set(next);
  }
}

/**
 * Braquage (-1 à 1) pour un écart horizontal du bouton (px) : nul dans la zone morte, puis
 * progressif jusqu'au bord de la course, arrondi au centième.
 */
export function steerFor(dx: number): number {
  const ratio = Math.max(-1, Math.min(1, dx / STICK_RADIUS));
  const magnitude = Math.abs(ratio);
  if (!(magnitude > DEAD_ZONE)) return 0;
  const scaled = (magnitude - DEAD_ZONE) / (1 - DEAD_ZONE);
  return (Math.sign(ratio) * Math.round(scaled * 100)) / 100;
}

/** Garde le doigt sur sa commande même s'il en sort, et évite les effets du navigateur (sélection, souris simulée). */
function capture(event: PointerEvent): void {
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

/** Rectangle de la zone qui a reçu l'événement (origine nulle si indisponible). */
function zoneRect(event: PointerEvent): { left: number; top: number } {
  const target = event.currentTarget;
  return target instanceof Element ? target.getBoundingClientRect() : { left: 0, top: 0 };
}
