import { Component, ElementRef, afterNextRender, input, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Écran d'erreur de la course (WebGL indisponible, chargement impossible…).
 * Le message est annoncé (role="alert") et le focus passe sur son titre : il ne reste pas
 * sur un bouton disparu (barre d'outils, menu de pause) quand l'erreur survient.
 */
@Component({
  selector: 'app-race-error',
  imports: [RouterLink],
  host: { class: 'absolute inset-0 grid place-items-center bg-leaf-100 p-4' },
  template: `
    <div role="alert" class="card max-w-lg p-8 text-center text-leaf-900">
      <h2 #title id="race-error-title" tabindex="-1" class="text-3xl font-black">Oh non !</h2>
      <p class="mt-3 text-lg">{{ message() }}</p>
      <a routerLink="/" class="btn btn-primary mt-6">Retour à l’accueil</a>
    </div>
  `,
})
export class RaceError {
  readonly message = input.required<string>();

  private readonly title = viewChild.required<ElementRef<HTMLHeadingElement>>('title');

  constructor() {
    afterNextRender({ write: () => this.title().nativeElement.focus() });
  }
}
