import { Component, ElementRef, afterRenderEffect, input, output, viewChild } from '@angular/core';

/**
 * Menu de pause : <dialog> natif ouvert en modal tant que `open` est vrai.
 * Échap (événement cancel) et la touche P reprennent la course.
 */
@Component({
  selector: 'app-pause-dialog',
  template: `
    <dialog
      #dialog
      aria-labelledby="pause-title"
      class="m-auto w-[min(92vw,26rem)] rounded-[2rem] border-4 border-leaf-200 bg-white p-8 text-leaf-900 shadow-2xl backdrop:bg-slate-900/60"
      (cancel)="onCancel($event)"
      (close)="onClose()"
      (keydown)="onKeydown($event)"
    >
      <h2 id="pause-title" class="text-center text-4xl font-black">Pause</h2>
      <div class="mt-6 flex flex-col gap-3">
        <button #resumeButton type="button" class="btn btn-primary" (click)="resumeRequested.emit()">Reprendre</button>
        <button type="button" class="btn btn-sun" (click)="restartRequested.emit()">Recommencer</button>
        <button type="button" class="btn btn-light" (click)="quitRequested.emit()">Quitter</button>
      </div>
    </dialog>
  `,
})
export class PauseDialog {
  readonly open = input(false);
  readonly resumeRequested = output<void>();
  readonly restartRequested = output<void>();
  readonly quitRequested = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly resumeButton = viewChild.required<ElementRef<HTMLButtonElement>>('resumeButton');

  constructor() {
    afterRenderEffect({
      write: () => {
        const dialog = this.dialog().nativeElement;
        if (this.open()) this.show(dialog);
        else this.hide(dialog);
      },
    });
  }

  protected onCancel(event: Event): void {
    // Le dialogue se refermera quand le jeu signalera la reprise.
    event.preventDefault();
    this.resumeRequested.emit();
  }

  /** Fermeture imposée par le navigateur (cancel non annulable) alors que le jeu est encore en pause. */
  protected onClose(): void {
    if (this.open()) this.resumeRequested.emit();
  }

  /** Les touches restent dans le menu : le jeu (qui écoute window) ne doit pas les intercepter. */
  protected onKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    // Échap maintenu (répétition de la touche qui a mis en pause) : on ne referme pas aussitôt.
    if (event.code === 'Escape' && event.repeat) event.preventDefault();
    else if (event.code === 'KeyP' && !event.repeat) this.resumeRequested.emit();
  }

  private show(dialog: HTMLDialogElement): void {
    if (isOpen(dialog)) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', ''); // jsdom et navigateurs anciens
    this.resumeButton().nativeElement.focus();
  }

  private hide(dialog: HTMLDialogElement): void {
    if (!isOpen(dialog)) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }
}

function isOpen(dialog: HTMLDialogElement): boolean {
  return dialog.open === true || dialog.hasAttribute('open');
}
