// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NEUTRAL_INPUT, type DriverInput } from '../core/types';
import { KEY_BINDINGS, KeyboardInput, type GameAction, type KeyTarget } from './keyboard-input';

const created: KeyboardInput[] = [];

/** Clavier branché sur window (cible par défaut), détaché automatiquement après chaque test. */
function createInput(onPauseRequest?: () => void): KeyboardInput {
  const input = new KeyboardInput({ onPauseRequest });
  input.attach();
  created.push(input);
  return input;
}

function dispatchKey(
  type: 'keydown' | 'keyup',
  code: string,
  init: KeyboardEventInit = {},
  target: EventTarget = window,
): KeyboardEvent {
  const event = new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const press = (code: string, init?: KeyboardEventInit, target?: EventTarget): KeyboardEvent =>
  dispatchKey('keydown', code, init, target);
const release = (code: string, init?: KeyboardEventInit, target?: EventTarget): KeyboardEvent =>
  dispatchKey('keyup', code, init, target);

/** Commandes attendues quand seule l'action donnée est active (hors pause). */
const EXPECTED: Record<Exclude<GameAction, 'pause'>, Partial<DriverInput>> = {
  accelerate: { throttle: true },
  brake: { brake: true },
  left: { steer: -1 },
  right: { steer: 1 },
  drift: { drift: true },
  item: { useItem: true },
};

const ALL_BOUND = KEY_BINDINGS.flatMap((binding) =>
  binding.codes.map((code) => ({ action: binding.action, code })),
);

afterEach(() => {
  for (const input of created.splice(0)) input.detach();
  document.body.replaceChildren();
});

describe('KEY_BINDINGS', () => {
  it('associe chaque action aux touches physiques prévues', () => {
    const codes = Object.fromEntries(
      KEY_BINDINGS.map((binding) => [binding.action, binding.codes]),
    );
    expect(codes).toEqual({
      accelerate: ['ArrowUp', 'KeyW'],
      brake: ['ArrowDown', 'KeyS'],
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
      drift: ['Space'],
      item: ['KeyE', 'ShiftLeft', 'ShiftRight'],
      pause: ['Escape', 'KeyP'],
    });
  });

  it('n’attribue jamais une touche à deux actions et fournit un libellé', () => {
    const allCodes = ALL_BOUND.map(({ code }) => code);
    expect(new Set(allCodes).size).toBe(allCodes.length);
    for (const binding of KEY_BINDINGS) expect(binding.label.trim()).not.toBe('');
    expect(KEY_BINDINGS.find((binding) => binding.action === 'accelerate')?.label).toContain('Z');
    expect(KEY_BINDINGS.find((binding) => binding.action === 'left')?.label).toContain('Q');
  });
});

describe('KeyboardInput', () => {
  it('ne produit aucune commande sans touche enfoncée', () => {
    expect(createInput().readDriverInput()).toEqual(NEUTRAL_INPUT);
  });

  it.each(ALL_BOUND.filter(({ action }) => action !== 'pause'))(
    '$code déclenche « $action »',
    ({ action, code }) => {
      const input = createInput();
      press(code);
      expect(input.readDriverInput()).toEqual({
        ...NEUTRAL_INPUT,
        ...EXPECTED[action as Exclude<GameAction, 'pause'>],
      });
      release(code);
      expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
    },
  );

  it('lit les touches physiques : ZQSD sur AZERTY produit les codes KeyW/KeyA/KeyS/KeyD', () => {
    const input = createInput();
    press('KeyW', { key: 'z' });
    press('KeyA', { key: 'q' });
    expect(input.readDriverInput()).toMatchObject({ throttle: true, steer: -1 });
    release('KeyA', { key: 'q' });
    press('KeyD', { key: 'd' });
    press('KeyS', { key: 's' });
    expect(input.readDriverInput()).toMatchObject({ throttle: true, brake: true, steer: 1 });
  });

  it('ignore la lettre produite : seules les positions physiques comptent', () => {
    const input = createInput();
    // Lettres « w » et « a » sur AZERTY : touches physiques KeyZ et KeyQ, non liées.
    press('KeyZ', { key: 'w' });
    press('KeyQ', { key: 'a' });
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
  });

  it('calcule steer : gauche -1, droite +1, les deux ou aucune 0', () => {
    const input = createInput();
    expect(input.readDriverInput().steer).toBe(0);
    press('ArrowLeft');
    expect(input.readDriverInput().steer).toBe(-1);
    press('ArrowRight');
    expect(input.readDriverInput().steer).toBe(0);
    release('ArrowLeft');
    expect(input.readDriverInput().steer).toBe(1);
    release('ArrowRight');
    expect(input.readDriverInput().steer).toBe(0);
  });

  it('garde l’action tant qu’une de ses touches reste enfoncée', () => {
    const input = createInput();
    press('ArrowUp');
    press('KeyW');
    release('ArrowUp');
    expect(input.readDriverInput().throttle).toBe(true);
    release('KeyW');
    expect(input.readDriverInput().throttle).toBe(false);
  });

  it('useItem n’est vrai qu’une fois par appui (front montant consommé à la lecture)', () => {
    const input = createInput();
    press('KeyE');
    expect(input.readDriverInput().useItem).toBe(true);
    expect(input.readDriverInput().useItem).toBe(false);
    press('KeyE', { repeat: true });
    expect(input.readDriverInput().useItem).toBe(false);
    release('KeyE');
    expect(input.readDriverInput().useItem).toBe(false);

    // Appui bref entre deux lectures : il n'est pas perdu.
    press('ShiftLeft', { shiftKey: true });
    release('ShiftLeft');
    expect(input.readDriverInput().useItem).toBe(true);
    expect(input.readDriverInput().useItem).toBe(false);
  });

  it('ignore la répétition automatique pour les fronts mais garde la touche maintenue', () => {
    const onPause = vi.fn();
    const input = createInput(onPause);
    press('KeyE', { repeat: true });
    press('Escape', { repeat: true });
    expect(input.readDriverInput().useItem).toBe(false);
    expect(onPause).not.toHaveBeenCalled();

    // Une répétition après un reset (touche encore physiquement enfoncée) rétablit l'état maintenu.
    press('ArrowUp');
    input.reset();
    press('ArrowUp', { repeat: true });
    expect(input.readDriverInput().throttle).toBe(true);
  });

  it('appelle onPauseRequest à chaque nouvel appui sur Échap ou P, sans commande de conduite', () => {
    const onPause = vi.fn();
    const input = createInput(onPause);
    press('Escape');
    expect(onPause).toHaveBeenCalledTimes(1);
    release('Escape');
    press('KeyP');
    expect(onPause).toHaveBeenCalledTimes(2);
    press('KeyP'); // keydown sans keyup ni repeat : déjà enfoncée
    expect(onPause).toHaveBeenCalledTimes(2);
    release('KeyP');
    expect(onPause).toHaveBeenCalledTimes(2);
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
  });

  it('relâche tout quand la fenêtre perd le focus', () => {
    const input = createInput();
    press('ArrowUp');
    press('ArrowLeft');
    press('Space');
    press('KeyE');
    window.dispatchEvent(new Event('blur'));
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
  });

  it('reset() relâche tout et oublie l’objet en attente', () => {
    const input = createInput();
    press('ArrowDown');
    press('KeyE');
    input.reset();
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
  });

  it('empêche l’action par défaut des touches du jeu, pas des autres', () => {
    createInput();
    for (const code of [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Space',
      'KeyW',
      'KeyE',
      'ShiftLeft',
      'KeyP',
    ]) {
      expect(press(code).defaultPrevented, code).toBe(true);
    }
    for (const code of ['KeyX', 'Tab', 'Enter', 'F5', 'PageDown']) {
      expect(press(code).defaultPrevented, code).toBe(false);
    }
    // Échap reste au navigateur (fermeture des <dialog>, plein écran).
    expect(press('Escape').defaultPrevented).toBe(false);
  });

  it('empêche aussi l’action par défaut des répétitions (pas de défilement en maintenant une flèche)', () => {
    const input = createInput();
    for (const code of ['ArrowDown', 'Space', 'ArrowUp']) {
      expect(press(code).defaultPrevented, code).toBe(true);
      expect(press(code, { repeat: true }).defaultPrevented, `${code} répétée`).toBe(true);
    }
    expect(input.readDriverInput()).toMatchObject({ throttle: true, brake: true, drift: true });
  });

  it('relâche les touches maintenues quand Cmd est relâché (keyup perdus sur macOS)', () => {
    const input = createInput();
    press('ArrowUp');
    press('ArrowLeft');
    press('KeyE');
    press('MetaLeft', { metaKey: true });
    // ArrowUp relâchée pendant que Cmd est tenu : macOS n'émet pas de keyup.
    release('MetaLeft');
    // L'appui d'objet déjà fait n'est pas perdu, mais plus rien n'est maintenu.
    expect(input.readDriverInput()).toEqual({ ...NEUTRAL_INPUT, useItem: true });
  });

  it('ignore les raccourcis avec Ctrl, Cmd ou Alt', () => {
    const input = createInput();
    const withCtrl = press('KeyD', { ctrlKey: true });
    const withMeta = press('KeyW', { metaKey: true });
    const withAlt = press('ArrowLeft', { altKey: true });
    expect([withCtrl, withMeta, withAlt].map((event) => event.defaultPrevented)).toEqual([
      false,
      false,
      false,
    ]);
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const host = document.createElement('div');
        host.setAttribute('contenteditable', 'true');
        const child = document.createElement('span');
        host.append(child);
        document.body.append(host);
        return child;
      },
    ],
  ] as const)('ignore les touches tapées dans un champ éditable (%s)', (_name, createField) => {
    const onPause = vi.fn();
    const input = createInput(onPause);
    const field = createField();
    if (!field.isConnected) document.body.append(field);
    const events = [
      press('ArrowUp', {}, field),
      press('Space', {}, field),
      press('KeyE', {}, field),
      press('KeyP', {}, field),
    ];
    expect(events.some((event) => event.defaultPrevented)).toBe(false);
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
    expect(onPause).not.toHaveBeenCalled();
  });

  it('se fie à isContentEditable quand le navigateur le fournit', () => {
    const input = createInput();
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    // Attribut présent mais propriété fausse (ex. ancêtre contenteditable="false") : la propriété gagne.
    const readOnly = document.createElement('div');
    readOnly.setAttribute('contenteditable', 'true');
    Object.defineProperty(readOnly, 'isContentEditable', { value: false });
    document.body.append(editable, readOnly);

    expect(press('ArrowUp', {}, editable).defaultPrevented).toBe(false);
    expect(input.readDriverInput().throttle).toBe(false);
    expect(press('ArrowUp', {}, readOnly).defaultPrevented).toBe(true);
    expect(input.readDriverInput().throttle).toBe(true);
  });

  it('ne traite pas contenteditable="false" comme un champ éditable', () => {
    const input = createInput();
    const host = document.createElement('div');
    host.setAttribute('contenteditable', 'false');
    document.body.append(host);
    press('ArrowUp', {}, host);
    expect(input.readDriverInput().throttle).toBe(true);
  });

  it('prend en compte un relâchement venu d’un champ éditable (pas de touche bloquée)', () => {
    const input = createInput();
    const field = document.createElement('input');
    document.body.append(field);
    press('ArrowUp');
    release('ArrowUp', {}, field);
    expect(input.readDriverInput().throttle).toBe(false);
  });

  it('detach() retire les écouteurs et relâche les touches', () => {
    const onPause = vi.fn();
    const input = createInput(onPause);
    press('ArrowUp');
    input.detach();
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
    const event = press('ArrowRight');
    press('KeyE');
    press('Escape');
    expect(event.defaultPrevented).toBe(false);
    expect(input.readDriverInput()).toEqual(NEUTRAL_INPUT);
    expect(onPause).not.toHaveBeenCalled();

    input.attach();
    press('ArrowRight');
    expect(input.readDriverInput().steer).toBe(1);
  });

  it('attach() et detach() sont idempotents et retirent exactement les écouteurs ajoutés', () => {
    const added: [string, (event: Event) => void][] = [];
    const removed: [string, (event: Event) => void][] = [];
    const target: KeyTarget = {
      addEventListener: (type, listener) => added.push([type, listener]),
      removeEventListener: (type, listener) => removed.push([type, listener]),
    };
    const input = new KeyboardInput({ target });
    input.attach();
    input.attach();
    expect(added.map(([type]) => type).sort()).toEqual(['blur', 'keydown', 'keyup']);
    input.detach();
    input.detach();
    expect(removed).toEqual(added);
  });

  it('fonctionne avec une cible quelconque et des événements minimaux', () => {
    const target = new EventTarget();
    const input = new KeyboardInput({ target });
    input.attach();
    const event = Object.assign(new Event('keydown', { cancelable: true }), {
      code: 'Space',
      repeat: false,
    });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input.readDriverInput().drift).toBe(true);
    target.dispatchEvent(new Event('blur'));
    expect(input.readDriverInput().drift).toBe(false);
    input.detach();
  });
});
