import { describe, expect, it } from 'vitest';
import { blockBrowserGestures } from './block-browser-gestures';

/** Événement tactile synthétique (jsdom n'a pas toujours TouchEvent) : `touches` et `timeStamp` imposés. */
function touch(target: Element, type: string, fingers = 1, timeStamp = 0): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: Array.from({ length: fingers }) });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  target.dispatchEvent(event);
  return event;
}

function setup(): {
  root: HTMLElement;
  plain: HTMLElement;
  button: HTMLElement;
  scrollable: HTMLElement;
} {
  const root = document.createElement('main');
  root.innerHTML = `
    <div id="plain"></div>
    <button id="button" type="button">Pause</button>
    <div data-scrollable><p id="scrollable">Résultats</p></div>
  `;
  const get = (id: string): HTMLElement => root.querySelector<HTMLElement>(`#${id}`)!;
  return { root, plain: get('plain'), button: get('button'), scrollable: get('scrollable') };
}

describe('blockBrowserGestures', () => {
  it('bloque le pincement (deux doigts) mais laisse passer un doigt seul', () => {
    const { root, plain } = setup();
    blockBrowserGestures(root);
    expect(touch(plain, 'touchstart', 2).defaultPrevented).toBe(true);
    expect(touch(plain, 'touchstart', 1).defaultPrevented).toBe(false);
    expect(touch(plain, 'touchmove', 2).defaultPrevented).toBe(true);
    const gesture = new Event('gesturestart', { bubbles: true, cancelable: true });
    plain.dispatchEvent(gesture);
    expect(gesture.defaultPrevented).toBe(true);
  });

  it('bloque le défilement, sauf dans une zone qui défile (résultats)', () => {
    const { root, plain, scrollable } = setup();
    blockBrowserGestures(root);
    expect(touch(plain, 'touchmove').defaultPrevented).toBe(true);
    expect(touch(scrollable, 'touchmove').defaultPrevented).toBe(false);
  });

  it('bloque le double appui hors des commandes, jamais le clic d’un bouton', () => {
    const { root, plain, button } = setup();
    blockBrowserGestures(root);
    expect(touch(plain, 'touchend', 1, 1000).defaultPrevented).toBe(false);
    expect(touch(plain, 'touchend', 1, 1200).defaultPrevented).toBe(true);
    expect(touch(plain, 'touchend', 1, 2000).defaultPrevented).toBe(false);
    expect(touch(button, 'touchend', 1, 2100).defaultPrevented).toBe(false);
  });

  it('se retire proprement', () => {
    const { root, plain } = setup();
    const release = blockBrowserGestures(root);
    release();
    expect(touch(plain, 'touchstart', 2).defaultPrevented).toBe(false);
    expect(touch(plain, 'touchmove').defaultPrevented).toBe(false);
  });
});
