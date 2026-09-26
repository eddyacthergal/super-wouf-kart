import { Component, computed, input } from '@angular/core';
import type { TrackDefinition } from '../../../game/track/track-definition';
import { createTrack, trackOutline } from '../../../game/track/track';
import { minimapFrame } from '../race/hud/minimap';

/** Plan d'un circuit vu du ciel (même orientation que la mini-carte), avec la ligne de départ. Décoratif. */
@Component({
  selector: 'app-track-preview',
  host: { class: 'block' },
  template: `
    @if (frame(); as map) {
      <svg
        class="block size-full"
        [attr.viewBox]="map.viewBox"
        aria-hidden="true"
        focusable="false"
      >
        <polygon
          [attr.points]="map.points"
          fill="none"
          stroke="#1d6b34"
          stroke-linejoin="round"
          [attr.stroke-width]="map.unit * 9"
        />
        <polygon
          [attr.points]="map.points"
          fill="none"
          stroke="#c9b48a"
          stroke-linejoin="round"
          [attr.stroke-width]="map.unit * 5.5"
        />
        <circle
          [attr.cx]="start().x"
          [attr.cy]="start().z"
          [attr.r]="map.unit * 5"
          fill="#ffcf3f"
          stroke="#0f3d1f"
          [attr.stroke-width]="map.unit * 1.6"
        />
      </svg>
    }
  `,
})
export class TrackPreview {
  readonly track = input.required<TrackDefinition>();

  private readonly outline = computed(() => trackOutline(createTrack(this.track())));
  protected readonly frame = computed(() => minimapFrame(this.outline()));
  protected readonly start = computed(() => this.outline()[0]);
}
