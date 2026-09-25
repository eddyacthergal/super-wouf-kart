import { describe, expect, it } from 'vitest';
import { prefersTouchControls } from './touch-device';

const viewMatching = (matches: boolean, queries: string[] = []): Window =>
  ({
    matchMedia: (query: string) => {
      queries.push(query);
      return { matches } as MediaQueryList;
    },
  }) as unknown as Window;

describe('prefersTouchControls', () => {
  it('suit la media query « pointeur grossier » (doigt)', () => {
    const queries: string[] = [];
    expect(prefersTouchControls(viewMatching(true, queries))).toBe(true);
    expect(queries).toEqual(['(pointer: coarse)']);
    expect(prefersTouchControls(viewMatching(false))).toBe(false);
  });

  it('faux sans fenêtre, sans matchMedia ou si matchMedia échoue', () => {
    expect(prefersTouchControls(null)).toBe(false);
    expect(prefersTouchControls(undefined)).toBe(false);
    expect(prefersTouchControls({} as Window)).toBe(false);
    const failing = {
      matchMedia: () => {
        throw new Error('non supporté');
      },
    } as unknown as Window;
    expect(prefersTouchControls(failing)).toBe(false);
  });
});
