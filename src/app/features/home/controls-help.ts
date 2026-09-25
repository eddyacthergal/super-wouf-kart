import { Component } from '@angular/core';
import { KEY_BINDINGS, type GameAction } from '../../../game/input/keyboard-input';

/**
 * Une ligne par action, avec ses commandes au clavier (touches réelles du jeu, KEY_BINDINGS) et sur
 * écran tactile. Tourner à gauche et à droite partagent une ligne, comme le joystick.
 */
interface ControlRow {
  label: string;
  actions: readonly GameAction[];
  touch: string;
}

export const CONTROL_ROWS: readonly ControlRow[] = [
  { label: 'Accélérer', actions: ['accelerate'], touch: 'Auto' },
  { label: 'Tourner', actions: ['left', 'right'], touch: 'Joystick gauche' },
  { label: 'Freiner', actions: ['brake'], touch: 'Frein' },
  { label: 'Déraper', actions: ['drift'], touch: 'Saut (maintenir)' },
  { label: 'Objet', actions: ['item'], touch: 'Objet' },
  { label: 'Pause', actions: ['pause'], touch: 'Pause (en haut)' },
];

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

/** Séparateur entre deux groupes de touches d'une même ligne (gauche · droite). */
const GROUP_SEPARATOR: KeyToken = { kind: 'separator', visual: ' · ', spoken: ' ; ' };

/**
 * Touches d'une ligne, en version courte : pour chaque action, ses touches séparées par un simple
 * espace (lu « ou »), sans la variante QWERTY d'une lettre (« Z/W » → « Z », rappelé sous le tableau).
 */
export function rowTokens(actions: readonly GameAction[]): KeyToken[] {
  return actions.flatMap((action, index) => {
    const binding = KEY_BINDINGS.find((candidate) => candidate.action === action);
    const tokens = binding ? shortTokens(keyTokens(binding.label)) : [];
    return index > 0 && tokens.length > 0 ? [GROUP_SEPARATOR, ...tokens] : tokens;
  });
}

/** Retire les variantes « /X » et remplace les « ou » affichés par un espace (toujours lus « ou »). */
function shortTokens(tokens: readonly KeyToken[]): KeyToken[] {
  const kept: KeyToken[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'separator' && token.visual === '/') {
      i++; // Saute aussi la touche qui suit la barre oblique.
      continue;
    }
    kept.push(
      token.kind === 'separator' ? { kind: 'separator', visual: '', spoken: ' ou ' } : token,
    );
  }
  return kept;
}

/** Aide des commandes : un tableau, une ligne par action, clavier et écran tactile côte à côte. */
@Component({
  selector: 'app-controls-help',
  template: `
    <section class="card h-full p-6" aria-labelledby="controls-title">
      <h2 id="controls-title" class="text-2xl font-extrabold">Commandes</h2>
      <table class="mt-4 w-full border-collapse text-left text-sm sm:text-base">
        <caption class="sr-only">
          Commandes au clavier et sur écran tactile
        </caption>
        <thead>
          <tr class="border-b-2 border-leaf-200">
            <th scope="col" class="py-2 pr-2">Action</th>
            <th scope="col" class="px-2 py-2">Clavier</th>
            <th scope="col" class="py-2 pl-2">Écran tactile</th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows; track row.label) {
            <tr class="border-b border-leaf-100">
              <th scope="row" class="py-2 pr-2 font-bold">{{ row.label }}</th>
              <td class="px-2 py-2">
                <span class="flex flex-wrap items-center gap-1 text-moss-700">
                  @for (token of row.tokens; track $index) {
                    @if (token.kind === 'key') {
                      <kbd>
                        @if (token.spoken) {
                          <span aria-hidden="true">{{ token.text }}</span
                          ><span class="sr-only">{{ token.spoken }}</span>
                        } @else {
                          {{ token.text }}
                        }
                      </kbd>
                    } @else if (token.visual === token.spoken) {
                      <span>{{ token.visual }}</span>
                    } @else {
                      <span aria-hidden="true">{{ token.visual }}</span
                      ><span class="sr-only">{{ token.spoken }}</span>
                    }
                  }
                </span>
              </td>
              <td class="py-2 pl-2 text-moss-700">{{ row.touch }}</td>
            </tr>
          }
        </tbody>
      </table>
      <p class="mt-4 text-sm text-moss-700">
        En QWERTY : W A S D au lieu de Z Q S D. Sur mobile : à l’horizontale.
      </p>
    </section>
  `,
})
export class ControlsHelp {
  protected readonly rows = CONTROL_ROWS.map((row) => ({ ...row, tokens: rowTokens(row.actions) }));
}
