import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import type { RaceSetup } from '../../../game/game-api';
import { GameSessionService } from '../../core/game-session.service';
import { SettingsStore } from '../../core/settings.store';
import { blockBrowserGestures } from '../../shared/block-browser-gestures';
import { prefersReducedMotion } from '../../shared/reduced-motion';
import { prefersTouchControls } from '../../shared/touch-device';
import { Countdown } from './countdown';
import { RaceHud } from './hud/race-hud';
import { PauseDialog } from './pause-dialog';
import { RaceAnnouncer } from './race-announcer';
import { RaceError } from './race-error';
import { RaceResults } from './race-results';
import { RaceToolbar } from './race-toolbar';
import { TouchControls } from './touch-controls';

/** Paramètre d'URL booléen : actif si « 1 » ou « true ». */
export function isFlagOn(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

/**
 * Page de course : canvas plein écran piloté par GameSessionService, avec HUD, compte à rebours,
 * pause, résultats et erreurs, et commandes tactiles sur téléphone et tablette. Paramètres d'URL :
 * `?autopilot=1` (démo), `?debug=1` (journal), `?touch=1` ou `?touch=0` (force ou retire les
 * commandes tactiles, détectées sinon d'après l'appareil).
 */
@Component({
  selector: 'app-race-page',
  imports: [
    RaceHud,
    Countdown,
    RaceAnnouncer,
    RaceToolbar,
    TouchControls,
    PauseDialog,
    RaceResults,
    RaceError,
  ],
  template: `
    <main #main class="fixed inset-0 overflow-hidden bg-azure-200">
      <h1 #heading tabindex="-1" class="sr-only">Course</h1>

      <!-- Un canvas neuf à chaque partie (on alterne deux blocs) : le contexte WebGL d'une partie terminée n'est jamais réutilisé. -->
      <!-- touch-none : sur écran tactile, ni défilement ni zoom pendant la course. -->
      @if (run() % 2 === 0) {
        <canvas #canvas class="fixed inset-0 block size-full touch-none" role="img" aria-label="Course en cours"></canvas>
      } @else {
        <canvas #canvas class="fixed inset-0 block size-full touch-none" role="img" aria-label="Course en cours"></canvas>
      }

      @if (visibleHud(); as hud) {
        <app-race-hud [hud]="hud" [info]="session.info()" [touch]="touchMode()" />
      }

      @if (showTouchControls()) {
        <app-touch-controls
          (control)="session.setTouchControl($event.action, $event.pressed)"
          (steer)="session.setTouchSteer($event)"
        />
        <p
          class="hud-panel pointer-events-none absolute inset-x-4 top-48 mx-auto hidden max-w-xs text-center text-sm font-bold portrait:block"
        >
          Tourne ton appareil à l’horizontale pour mieux voir la piste.
        </p>
      }

      <app-countdown [phase]="session.phase()" [value]="countdown()" />
      <app-race-announcer [lap]="lap()" [laps]="laps()" [finishRank]="finishRank()" />

      <!-- Région de statut présente dès le départ : son contenu (chargement) est annoncé quand il apparaît. -->
      <div role="status" class="pointer-events-none absolute inset-0 grid place-items-center">
        @if (session.loading()) {
          <p class="hud-panel px-6 py-3 text-2xl font-black">Chargement du jardin…</p>
        }
      </div>

      @if (showToolbar()) {
        <app-race-toolbar
          class="absolute top-3 right-3 sm:top-5 sm:right-5"
          [muted]="settings.muted()"
          (mutedChange)="setMuted($event)"
          (pauseRequested)="session.pause()"
        />
      }

      <app-pause-dialog
        [open]="session.paused()"
        (resumeRequested)="session.resume()"
        (restartRequested)="restart()"
        (quitRequested)="quit()"
      />

      @if (session.results(); as results) {
        <app-race-results [results]="results" (replay)="restart()" />
      }

      @if (session.error(); as message) {
        <app-race-error [message]="message" />
      }
    </main>
  `,
})
export class RacePage {
  /** Query param `autopilot` (lié par withComponentInputBinding). */
  readonly autopilot = input<string>();
  /** Query param `debug`. */
  readonly debug = input<string>();
  /** Query param `touch` : « 1 » force les commandes tactiles, « 0 » les retire. */
  readonly touch = input<string>();

  protected readonly session = inject(GameSessionService);
  protected readonly settings = inject(SettingsStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly view = inject(DOCUMENT).defaultView;

  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly heading = viewChild.required<ElementRef<HTMLHeadingElement>>('heading');
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');

  /** Numéro de la partie en cours (sa parité choisit le bloc du canvas). */
  protected readonly run = signal(0);

  /** Course en cours d'affichage : ni résultats ni erreur par-dessus. */
  private readonly racing = computed(() => this.session.results() === null && this.session.error() === null);
  protected readonly visibleHud = computed(() => (this.racing() ? this.session.hud() : null));
  protected readonly showToolbar = computed(() => this.racing() && this.session.info() !== null);
  /** Commandes tactiles : forcées par l'URL, sinon d'après l'appareil (pointeur « doigt »). */
  protected readonly touchMode = computed(() => {
    const flag = this.touch();
    return flag === undefined ? prefersTouchControls(this.view) : isFlagOn(flag);
  });
  /** Masquées en pause : le jeu relâche alors toutes les commandes, on repart d'un état propre. */
  protected readonly showTouchControls = computed(
    () => this.touchMode() && this.showToolbar() && !this.session.paused(),
  );
  protected readonly countdown = computed(() => this.session.hud()?.countdown ?? null);
  protected readonly lap = computed(() => this.session.hud()?.lap ?? null);
  protected readonly laps = computed(() => this.session.hud()?.laps ?? this.session.info()?.laps ?? null);
  protected readonly finishRank = computed(
    () => this.session.results()?.find((entry) => entry.isPlayer)?.rank ?? null,
  );

  private destroyed = false;

  constructor() {
    this.launchAfterRender();
    let releaseGestures: (() => void) | null = null;
    // Écran tactile : pas de zoom ni de défilement du navigateur sous les doigts pendant la course.
    afterNextRender(() => {
      if (this.touchMode() && !this.destroyed) {
        releaseGestures = blockBrowserGestures(this.main().nativeElement);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      releaseGestures?.();
      this.session.stop();
    });
  }

  /** Recommence : arrête la partie, remplace le canvas puis relance avec les réglages actuels. */
  protected restart(): void {
    this.session.stop();
    this.run.update((run) => run + 1);
    this.launchAfterRender();
  }

  protected quit(): void {
    void this.router.navigateByUrl('/');
  }

  protected setMuted(muted: boolean): void {
    this.settings.setMuted(muted);
    this.session.setMuted(muted);
  }

  private launchAfterRender(): void {
    afterNextRender(
      {
        write: () => {
          const canvas = this.canvas()?.nativeElement;
          if (!canvas || this.destroyed) return;
          void this.session.start(canvas, this.buildSetup());
        },
        // Le focus va au titre (masqué) de la page, pas sur un bouton que la barre d'espace (dérapage) activerait.
        read: () => {
          if (!this.destroyed) this.heading().nativeElement.focus({ preventScroll: true });
        },
      },
      { injector: this.injector },
    );
  }

  private buildSetup(): RaceSetup {
    return {
      playerBreed: this.settings.breed(),
      playerSkins: this.settings.skins(),
      muted: this.settings.muted(),
      reducedMotion: prefersReducedMotion(this.view),
      autopilot: isFlagOn(this.autopilot()),
      debug: isFlagOn(this.debug()),
      touchControls: this.touchMode(),
    };
  }
}
