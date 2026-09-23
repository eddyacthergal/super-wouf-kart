import { Component, computed, effect, input, signal } from '@angular/core';
import type { RacePhase } from '../../../game/core/types';

/** Durée d'affichage de « Partez ! » (ms). */
export const GO_DISPLAY_MS = 1000;

/**
 * Compte à rebours géant : « 3 », « 2 », « 1 », puis « Partez ! » au départ.
 * Placé dans le tiers supérieur de l'écran : le kart du joueur, au centre, reste visible.
 */
@Component({
  selector: 'app-countdown',
  host: {
    class: 'pointer-events-none absolute inset-x-0 top-[16%] flex justify-center select-none',
  },
  template: `
    <!-- Un bloc par valeur : chaque changement recrée l'élément et rejoue l'animation. -->
    @if (text(); as value) {
      @switch (value) {
        @case ('3') {
          <p [class]="bubbleClass">3</p>
        }
        @case ('2') {
          <p [class]="bubbleClass">2</p>
        }
        @case ('1') {
          <p [class]="bubbleClass">1</p>
        }
        @default {
          <p [class]="bubbleClass">{{ value }}</p>
        }
      }
    }
  `,
  styles: `
    .countdown-pop {
      animation: countdown-pop 0.35s ease-out;
    }
    @keyframes countdown-pop {
      from {
        transform: scale(1.6);
        opacity: 0;
      }
    }
  `,
})
export class Countdown {
  readonly phase = input<RacePhase | null>(null);
  readonly value = input<number | null>(null);

  protected readonly bubbleClass =
    'countdown-pop rounded-[2rem] bg-slate-900/80 px-10 py-4 text-8xl font-black text-sun-400 shadow-2xl sm:text-9xl';

  private readonly go = signal(false);

  protected readonly text = computed(() => {
    const value = this.value();
    if (this.phase() === 'countdown' && value !== null && value > 0) return String(value);
    return this.go() && this.phase() === 'racing' ? 'Partez !' : null;
  });

  constructor() {
    let previous: RacePhase | null = null;
    effect((onCleanup) => {
      const phase = this.phase();
      const started = previous === 'countdown' && phase === 'racing';
      previous = phase;
      if (!started) return;
      this.go.set(true);
      const timer = setTimeout(() => this.go.set(false), GO_DISPLAY_MS);
      onCleanup(() => {
        clearTimeout(timer);
        this.go.set(false);
      });
    });
  }
}
