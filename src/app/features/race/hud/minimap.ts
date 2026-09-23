import { Component, computed, input } from '@angular/core';
import type { Vec2 } from '../../../../game/core/types';
import type { MinimapDot, RacerInfo } from '../../../../game/game-api';

interface MapFrame {
  viewBox: string;
  points: string;
  /** Unité de dessin proportionnelle à la taille du circuit (1/100 de sa plus grande dimension). */
  unit: number;
}

interface Marker {
  id: number;
  x: number;
  z: number;
  color: string;
  isPlayer: boolean;
}

const round = (value: number): number => Math.round(value * 10) / 10;

/** Emprise du tracé (avec une marge) et polygone SVG ; x vers la droite, z vers le bas. */
export function minimapFrame(outline: readonly Vec2[]): MapFrame | null {
  if (outline.length < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const point of outline) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }
  const size = Math.max(maxX - minX, maxZ - minZ, 1);
  const margin = size * 0.08;
  return {
    viewBox: [minX - margin, minZ - margin, maxX - minX + margin * 2, maxZ - minZ + margin * 2].map(round).join(' '),
    points: outline.map((point) => `${round(point.x)},${round(point.z)}`).join(' '),
    unit: size / 100,
  };
}

/** Mini-carte décorative : tracé du circuit et position des pilotes (le joueur en plus gros, cerclé de blanc). */
@Component({
  selector: 'app-minimap',
  host: { class: 'hud-panel block p-2', 'aria-hidden': 'true' },
  template: `
    @if (frame(); as map) {
      <svg class="block size-36 sm:size-44" [attr.viewBox]="map.viewBox" focusable="false">
        <polygon
          [attr.points]="map.points"
          fill="none"
          stroke="#ffffff"
          stroke-opacity="0.9"
          stroke-linejoin="round"
          [attr.stroke-width]="map.unit * 7"
        />
        <polygon
          [attr.points]="map.points"
          fill="none"
          stroke="#c9b48a"
          stroke-linejoin="round"
          [attr.stroke-width]="map.unit * 4"
        />
        @for (marker of markers(); track marker.id) {
          <circle
            [attr.cx]="marker.x"
            [attr.cy]="marker.z"
            [attr.r]="map.unit * (marker.isPlayer ? 5.5 : 3.4)"
            [attr.fill]="marker.color"
            [attr.stroke]="marker.isPlayer ? '#ffffff' : '#0f172a'"
            [attr.stroke-width]="map.unit * (marker.isPlayer ? 2 : 0.9)"
          />
        }
      </svg>
    }
  `,
})
export class Minimap {
  readonly outline = input.required<readonly Vec2[]>();
  readonly racers = input<readonly RacerInfo[]>([]);
  readonly dots = input<readonly MinimapDot[]>([]);

  protected readonly frame = computed(() => minimapFrame(this.outline()));

  /** Points colorés par kart ; le joueur est dessiné en dernier, donc au-dessus. */
  protected readonly markers = computed<Marker[]>(() => {
    const racers = new Map(this.racers().map((racer) => [racer.id, racer]));
    return this.dots()
      .map((dot) => {
        const racer = racers.get(dot.id);
        return {
          id: dot.id,
          x: round(dot.x),
          z: round(dot.z),
          color: racer?.kartColor ?? '#ffffff',
          isPlayer: racer?.isPlayer ?? false,
        };
      })
      .sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer));
  });
}
