import { Component, computed, input } from '@angular/core';
import type { BreedId } from '../../game/core/types';
import { BREEDS, type EarStyle } from '../../game/dogs/breeds';

/** Portrait dessiné pour une race, d'après sa fiche d'apparence (couleurs, oreilles, museau…). */
export interface DogFace {
  earStyle: EarStyle;
  fur: string;
  ear: string;
  innerEar: string;
  muzzle: string;
  /** Masque sombre autour des yeux (carlin) ou null. */
  mask: string | null;
  /** Tache sur un œil (jack russell) ou null. */
  patch: string | null;
  wrinkles: boolean;
  tongue: boolean;
  /** Demi-largeur de la tête (unités du viewBox 120 × 120). */
  headRx: number;
  /** Museau : court et large (carlin), moyen, ou long et étroit (teckel). */
  muzzleRx: number;
  muzzleRy: number;
  muzzleCy: number;
  noseCy: number;
  eyeR: number;
}

/** Traduit la fiche d'apparence 3D d'une race en proportions du portrait. */
export function dogFace(breed: BreedId): DogFace {
  const look = BREEDS[breed].look;
  const flat = look.muzzleLength < 0.01;
  const long = look.muzzleLength > 0.1;
  return {
    earStyle: look.earStyle,
    fur: look.furColor,
    ear: look.earColor,
    innerEar: look.innerEarColor,
    muzzle: look.muzzleColor,
    mask: look.eyeMaskColor,
    patch: look.patchColor,
    wrinkles: look.wrinkles,
    tongue: look.tongue,
    headRx: Math.round(34 * look.headScale.x),
    muzzleRx: flat ? 22 : long ? 15 : 19,
    muzzleRy: flat ? 12 : long ? 18 : 14,
    muzzleCy: flat ? 80 : long ? 84 : 81,
    noseCy: flat ? 74 : long ? 72 : 74,
    eyeR: Math.round(look.eyeRadius * 85),
  };
}

/**
 * Portrait de la race choisie (tête de face), sur une pastille jaune. Décoratif : le nom de la race
 * est toujours écrit à côté.
 */
@Component({
  selector: 'app-dog-portrait',
  host: { class: 'inline-block' },
  template: `
    @let f = face();
    <svg class="size-full" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <circle cx="60" cy="60" r="56" fill="#ffcf3f" />

      <!-- Oreilles derrière la tête : dressées (avec leur intérieur) ou repliées. -->
      @switch (f.earStyle) {
        @case ('erect') {
          <path d="M26 52 L30 8 L52 34 Z" [attr.fill]="f.ear" />
          <path d="M94 52 L90 8 L68 34 Z" [attr.fill]="f.ear" />
          <path d="M31 44 L33 19 L46 34 Z" [attr.fill]="f.innerEar" />
          <path d="M89 44 L87 19 L74 34 Z" [attr.fill]="f.innerEar" />
        }
        @case ('folded') {
          <path d="M28 44 Q24 26 46 30 Q42 40 34 48 Z" [attr.fill]="f.ear" />
          <path d="M92 44 Q96 26 74 30 Q78 40 86 48 Z" [attr.fill]="f.ear" />
        }
      }

      <ellipse
        cx="60"
        cy="64"
        [attr.rx]="f.headRx"
        ry="32"
        [attr.fill]="f.fur"
        stroke="#0f3d1f"
        stroke-opacity="0.18"
        stroke-width="2"
      />

      <!-- Oreilles devant la tête : tombantes (teckel) ou pliées vers l'avant (jack russell). -->
      @switch (f.earStyle) {
        @case ('floppy') {
          <ellipse
            cx="27"
            cy="68"
            rx="11"
            ry="27"
            transform="rotate(12 27 68)"
            [attr.fill]="f.ear"
          />
          <ellipse
            cx="93"
            cy="68"
            rx="11"
            ry="27"
            transform="rotate(-12 93 68)"
            [attr.fill]="f.ear"
          />
        }
        @case ('semi-floppy') {
          <path d="M26 40 L52 32 L36 58 Z" [attr.fill]="f.ear" />
          <path d="M94 40 L68 32 L84 58 Z" [attr.fill]="f.ear" />
        }
      }

      @if (f.patch; as patch) {
        <ellipse cx="45" cy="57" rx="14" ry="13" [attr.fill]="patch" />
      }
      @if (f.mask; as mask) {
        <circle cx="46" cy="59" r="11" [attr.fill]="mask" />
        <circle cx="74" cy="59" r="11" [attr.fill]="mask" />
      }
      @if (f.wrinkles) {
        <g
          fill="none"
          stroke="#2b2320"
          stroke-opacity="0.45"
          stroke-width="2.4"
          stroke-linecap="round"
        >
          <path d="M48 42 Q60 36 72 42" />
          <path d="M51 48 Q60 44 69 48" />
        </g>
      }

      <ellipse
        cx="60"
        [attr.cy]="f.muzzleCy"
        [attr.rx]="f.muzzleRx"
        [attr.ry]="f.muzzleRy"
        [attr.fill]="f.muzzle"
      />
      <circle cx="46" cy="59" [attr.r]="f.eyeR" fill="#1b1b1b" />
      <circle cx="74" cy="59" [attr.r]="f.eyeR" fill="#1b1b1b" />
      <circle cx="48" cy="57" r="2" fill="#fff" />
      <circle cx="76" cy="57" r="2" fill="#fff" />
      <ellipse cx="60" [attr.cy]="f.noseCy" rx="7" ry="5" fill="#1b1b1b" />
      @if (f.tongue) {
        <path d="M54 88 Q60 100 66 88 Z" fill="#e8657a" />
      }
    </svg>
  `,
})
export class DogPortrait {
  readonly breed = input.required<BreedId>();

  protected readonly face = computed(() => dogFace(this.breed()));
}
