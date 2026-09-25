import { Component, input } from '@angular/core';
import type { HudSnapshot, RaceInfo } from '../../../../game/game-api';
import { HudDrift } from './hud-drift';
import { HudItem } from './hud-item';
import { HudLap } from './hud-lap';
import { HudPosition } from './hud-position';
import { HudSpeed } from './hud-speed';
import { HudTimer } from './hud-timer';
import { Minimap } from './minimap';
import { WrongWayBanner } from './wrong-way-banner';

/**
 * Disposition du HUD autour du canvas (non interactif : les clics traversent vers le jeu).
 * Avec les commandes tactiles (`touch`), les coins du bas sont aux pouces : la mini-carte remonte
 * au-dessus du pavé de direction (masquée si l'écran manque de place : téléphone, portrait) et la
 * jauge de dérapage et le compteur passent au centre, entre les deux pouces (au-dessus en portrait).
 */
@Component({
  selector: 'app-race-hud',
  imports: [HudPosition, HudLap, HudTimer, HudSpeed, HudItem, HudDrift, Minimap, WrongWayBanner],
  host: { class: 'pointer-events-none absolute inset-0 block select-none' },
  template: `
    <div class="absolute top-3 left-3 flex flex-col items-start gap-2 sm:top-5 sm:left-5">
      <app-hud-position [rank]="hud().rank" [total]="hud().racerCount" />
      <app-hud-lap [lap]="hud().lap" [laps]="hud().laps" />
      <app-hud-timer [seconds]="hud().raceTime" />
    </div>

    <div class="absolute top-20 right-3 sm:top-24 sm:right-5">
      <app-hud-item [item]="hud().item" [rolling]="hud().itemRolling" />
    </div>

    @if (hud().wrongWay) {
      <app-wrong-way-banner class="absolute top-28 left-1/2 -translate-x-1/2" />
    }

    @if (info(); as race) {
      <app-minimap
        class="absolute left-3 sm:left-5"
        [class]="touch() ? minimapTouchClass : minimapClass"
        [outline]="race.trackOutline"
        [racers]="race.racers"
        [dots]="hud().dots"
      />
    }

    <div class="absolute flex flex-col gap-2" [class]="touch() ? gaugesTouchClass : gaugesClass">
      <app-hud-drift
        [drifting]="hud().drifting"
        [tier]="hud().driftTier"
        [boosting]="hud().boosting"
      />
      <app-hud-speed [kmh]="hud().speedKmh" />
    </div>
  `,
})
export class RaceHud {
  readonly hud = input.required<HudSnapshot>();
  readonly info = input<RaceInfo | null>(null);
  /** Commandes tactiles affichées dans les coins du bas. */
  readonly touch = input(false);

  protected readonly minimapClass = 'bottom-3 sm:bottom-5';
  protected readonly minimapTouchClass =
    'bottom-36 portrait:hidden [@media(max-height:560px)]:hidden';
  protected readonly gaugesClass = 'right-3 bottom-3 items-end sm:right-5 sm:bottom-5';
  protected readonly gaugesTouchClass =
    'bottom-3 left-1/2 -translate-x-1/2 items-center portrait:bottom-48';
}
