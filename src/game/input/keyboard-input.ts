/**
 * Lecture du clavier pour le joueur. Les touches sont identifiées par `event.code`
 * (position PHYSIQUE) : ZQSD sur AZERTY et WASD sur QWERTY donnent les mêmes codes.
 * Aucune dépendance au DOM à l'import : la cible par défaut (window) n'est lue qu'à la construction.
 */
import type { DriverInput } from '../core/types';

export type GameAction = 'accelerate' | 'brake' | 'left' | 'right' | 'drift' | 'item' | 'pause';

export interface KeyBinding {
  action: GameAction;
  /** Valeurs de `KeyboardEvent.code` associées à l'action. */
  codes: readonly string[];
  /** Libellé français pour l'aide, ex. « ↑ ou Z/W ». */
  label: string;
}

export const KEY_BINDINGS: readonly KeyBinding[] = [
  { action: 'accelerate', codes: ['ArrowUp', 'KeyW'], label: '↑ ou Z/W' },
  { action: 'brake', codes: ['ArrowDown', 'KeyS'], label: '↓ ou S' },
  { action: 'left', codes: ['ArrowLeft', 'KeyA'], label: '← ou Q/A' },
  { action: 'right', codes: ['ArrowRight', 'KeyD'], label: '→ ou D' },
  { action: 'drift', codes: ['Space'], label: 'Espace' },
  { action: 'item', codes: ['KeyE', 'ShiftLeft', 'ShiftRight'], label: 'E ou Maj' },
  { action: 'pause', codes: ['Escape', 'KeyP'], label: 'Échap ou P' },
];

/** Cible d'écoute minimale (window en pratique, un faux objet dans les tests). */
export interface KeyTarget {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface KeyboardInputOptions {
  /** Cible des écouteurs, window par défaut. */
  target?: KeyTarget;
  /** Appelé à chaque nouvel appui sur une touche de pause (répétition ignorée). */
  onPauseRequest?: () => void;
}

const ACTION_BY_CODE: ReadonlyMap<string, GameAction> = new Map(
  KEY_BINDINGS.flatMap((binding) => binding.codes.map((code) => [code, binding.action] as const)),
);

const CODES_BY_ACTION: ReadonlyMap<GameAction, readonly string[]> = new Map(
  KEY_BINDINGS.map((binding) => [binding.action, binding.codes] as const),
);

/** Échap reste au navigateur : fermeture native des <dialog>, sortie du plein écran. */
const DEFAULT_ALLOWED_CODES: ReadonlySet<string> = new Set(['Escape']);

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Touche Cmd/Windows (« OS* » : anciens Firefox). Sur macOS, les touches relâchées pendant
 * que Cmd est tenu n'émettent pas de keyup : on relâche tout quand Cmd se relâche.
 */
const META_CODES: ReadonlySet<string> = new Set(['MetaLeft', 'MetaRight', 'OSLeft', 'OSRight']);

export class KeyboardInput {
  private readonly target: KeyTarget;
  private readonly onPauseRequest: (() => void) | undefined;
  /** Codes actuellement enfoncés (plusieurs touches peuvent servir la même action). */
  private readonly pressedCodes = new Set<string>();
  /** Front montant de la touche d'objet, en attente de lecture. */
  private itemRequested = false;
  private attached = false;

  constructor(options: KeyboardInputOptions = {}) {
    this.target = options.target ?? window;
    this.onPauseRequest = options.onPauseRequest;
  }

  /** Branche les écouteurs (sans effet si c'est déjà fait). */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.target.addEventListener('blur', this.onBlur);
  }

  /** Retire les écouteurs et relâche toutes les touches (sans effet si c'est déjà fait). */
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    this.reset();
  }

  /** Commandes du joueur pour le pas courant ; consomme le front montant de la touche d'objet. */
  readDriverInput(): DriverInput {
    const useItem = this.itemRequested;
    this.itemRequested = false;
    return {
      throttle: this.isHeld('accelerate'),
      brake: this.isHeld('brake'),
      steer: (this.isHeld('right') ? 1 : 0) - (this.isHeld('left') ? 1 : 0),
      drift: this.isHeld('drift'),
      useItem,
    };
  }

  /** Relâche toutes les touches et oublie l'appui d'objet en attente. */
  reset(): void {
    this.pressedCodes.clear();
    this.itemRequested = false;
  }

  private isHeld(action: GameAction): boolean {
    const codes = CODES_BY_ACTION.get(action) ?? [];
    return codes.some((code) => this.pressedCodes.has(code));
  }

  private readonly onKeyDown = (event: Event): void => {
    const code = readCode(event);
    const action = code === null ? undefined : ACTION_BY_CODE.get(code);
    if (code === null || action === undefined) return;
    if (isEditableTarget(event.target) || hasShortcutModifier(event)) return;
    if (!DEFAULT_ALLOWED_CODES.has(code)) event.preventDefault();

    // Un nouvel appui : ni répétition automatique, ni touche déjà connue comme enfoncée.
    const isNewPress = !readRepeat(event) && !this.pressedCodes.has(code);
    this.pressedCodes.add(code);
    if (!isNewPress) return;
    if (action === 'item') this.itemRequested = true;
    else if (action === 'pause') this.onPauseRequest?.();
  };

  private readonly onKeyUp = (event: Event): void => {
    // Relâchement toujours pris en compte, même depuis un champ éditable : pas de touche bloquée.
    const code = readCode(event);
    if (code === null) return;
    if (META_CODES.has(code)) this.pressedCodes.clear();
    else this.pressedCodes.delete(code);
  };

  private readonly onBlur = (): void => {
    this.reset();
  };
}

// Lecture structurelle des événements : fonctionne avec KeyboardEvent comme avec un faux objet de test.

function readCode(event: Event): string | null {
  return 'code' in event && typeof event.code === 'string' ? event.code : null;
}

function readRepeat(event: Event): boolean {
  return 'repeat' in event && event.repeat === true;
}

/** Ctrl, Cmd ou Alt : raccourci du navigateur ou du système, on ne l'intercepte pas. */
function hasShortcutModifier(event: Event): boolean {
  return (
    ('ctrlKey' in event && event.ctrlKey === true) ||
    ('metaKey' in event && event.metaKey === true) ||
    ('altKey' in event && event.altKey === true)
  );
}

/** Champ de saisie (input, textarea, select) ou zone contenteditable. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== 'object') return false;
  const element = target as Partial<HTMLElement>;
  const tagName = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (EDITABLE_TAGS.has(tagName)) return true;
  if (typeof element.isContentEditable === 'boolean') return element.isContentEditable;
  // Repli (jsdom n'implémente pas isContentEditable) : attribut contenteditable le plus proche.
  if (typeof element.closest === 'function') {
    const host = element.closest('[contenteditable]');
    return host !== null && host.getAttribute('contenteditable') !== 'false';
  }
  return false;
}
