import { Component, model, output } from '@angular/core';

/**
 * Boutons du HUD : pause et son (bouton bascule, aria-pressed = son coupé).
 * Le nom accessible du bouton son reste « Couper le son » : pour un bouton bascule, c'est aria-pressed
 * qui porte l'état (un nom qui change en plus ferait lire « Activer le son, enfoncé », contradictoire).
 */
@Component({
  selector: 'app-race-toolbar',
  host: {
    class: 'flex gap-2',
    '(keydown)': 'rememberSpace($event)',
    '(keyup)': 'ignoreGameSpace($event)',
  },
  template: `
    <button type="button" [class]="buttonClass" aria-label="Pause" title="Pause" (click)="pauseRequested.emit()">
      <svg viewBox="0 0 24 24" class="size-7" aria-hidden="true" focusable="false">
        <rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
        <rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" />
      </svg>
    </button>
    <button
      type="button"
      [class]="buttonClass"
      aria-label="Couper le son"
      title="Couper le son"
      [attr.aria-pressed]="muted()"
      (click)="muted.set(!muted())"
    >
      <svg viewBox="0 0 24 24" class="size-7" aria-hidden="true" focusable="false">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        @if (muted()) {
          <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        } @else {
          <path
            d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        }
      </svg>
    </button>
  `,
})
export class RaceToolbar {
  readonly muted = model(false);
  readonly pauseRequested = output<void>();

  protected readonly buttonClass =
    'grid size-12 cursor-pointer place-items-center rounded-full border-2 border-white/85 bg-slate-900/80 ' +
    'text-white shadow-lg transition-colors hover:bg-slate-800 aria-pressed:bg-carrot-500 aria-pressed:text-slate-900';

  /** Dernier appui sur Espace reçu par un bouton de la barre. */
  private spaceKeydown: KeyboardEvent | null = null;

  protected rememberSpace(event: KeyboardEvent): void {
    if (event.code === 'Space') this.spaceKeydown = event;
  }

  /**
   * Espace sert aussi au dérapage. Quand le jeu a intercepté l'appui (preventDefault sur keydown, écouteur
   * sur window), son relâchement ne doit pas activer le bouton resté focalisé après un clic (Firefox active
   * un bouton au keyup même si le keydown a été annulé) : sinon chaque dérapage mettrait en pause ou couperait
   * le son. Entrée active toujours les boutons au clavier.
   */
  protected ignoreGameSpace(event: KeyboardEvent): void {
    if (event.code === 'Space' && this.spaceKeydown?.defaultPrevented) event.preventDefault();
    this.spaceKeydown = null;
  }
}
