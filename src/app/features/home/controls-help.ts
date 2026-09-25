import { Component } from '@angular/core';
import { KEY_BINDINGS, type GameAction } from '../../../game/input/keyboard-input';

const ACTION_LABELS: Readonly<Record<GameAction, string>> = {
  accelerate: 'Accélérer',
  brake: 'Freiner, reculer',
  left: 'Tourner à gauche',
  right: 'Tourner à droite',
  drift: 'Sauter, déraper',
  item: 'Utiliser l’objet',
  pause: 'Pause',
};

/** Nom prononcé des flèches (les glyphes seuls sont mal lus par les synthèses vocales). */
const SPOKEN_KEYS: Readonly<Record<string, string>> = {
  '↑': 'Flèche haut',
  '↓': 'Flèche bas',
  '←': 'Flèche gauche',
  '→': 'Flèche droite',
};

export type KeyToken =
  | { kind: 'key'; text: string; spoken: string | null }
  | { kind: 'separator'; visual: string; spoken: string };

/** « ↑ ou Z/W » → touches ↑, Z, W séparées par « ou » (la barre oblique est lue « ou »). */
export function keyTokens(label: string): KeyToken[] {
  const tokens: KeyToken[] = [];
  label.split(' ou ').forEach((group, groupIndex) => {
    if (groupIndex > 0) tokens.push({ kind: 'separator', visual: ' ou ', spoken: ' ou ' });
    group.split('/').forEach((key, keyIndex) => {
      if (keyIndex > 0) tokens.push({ kind: 'separator', visual: '/', spoken: ' ou ' });
      const text = key.trim();
      tokens.push({ kind: 'key', text, spoken: SPOKEN_KEYS[text] ?? null });
    });
  });
  return tokens;
}

/** Aide des commandes : clavier (générée depuis les touches réelles du jeu) et écran tactile. */
@Component({
  selector: 'app-controls-help',
  template: `
    <section class="card h-full p-6" aria-labelledby="controls-title">
      <h2 id="controls-title" class="text-2xl font-extrabold">Commandes</h2>
      <dl class="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
        @for (binding of bindings; track binding.action) {
          <dt class="font-bold">{{ binding.label }}</dt>
          <dd class="flex flex-wrap items-center gap-1 text-moss-700">
            @for (token of binding.tokens; track $index) {
              @if (token.kind === 'key') {
                <kbd>
                  @if (token.spoken) {
                    <span aria-hidden="true">{{ token.text }}</span><span class="sr-only">{{ token.spoken }}</span>
                  } @else {
                    {{ token.text }}
                  }
                </kbd>
              } @else if (token.visual === token.spoken) {
                <span>{{ token.visual }}</span>
              } @else {
                <span aria-hidden="true">{{ token.visual }}</span><span class="sr-only">{{ token.spoken }}</span>
              }
            }
          </dd>
        }
      </dl>
      <p class="mt-4 text-sm text-moss-700">
        Les lettres suivent leur position sur le clavier : Z, Q, S, D en AZERTY ou W, A, S, D en QWERTY.
      </p>
      <h3 class="mt-6 text-lg font-extrabold">Sur téléphone ou tablette</h3>
      <ul class="mt-2 list-disc space-y-1 pl-5 text-moss-700">
        <li>Le kart accélère tout seul ; tiens l’appareil à l’horizontale.</li>
        <li>Pouce gauche : pose-le n’importe où sur la moitié gauche de l’écran, un joystick apparaît ; glisse à gauche ou à droite pour tourner.</li>
        <li>Pouce droit : maintiens <strong>Saut</strong> en tournant pour déraper, <strong>Objet</strong> pour l’utiliser, <strong>Frein</strong> pour freiner ou reculer.</li>
      </ul>
    </section>
  `,
})
export class ControlsHelp {
  protected readonly bindings = KEY_BINDINGS.map((binding) => ({
    action: binding.action,
    label: ACTION_LABELS[binding.action],
    tokens: keyTokens(binding.label),
  }));
}
