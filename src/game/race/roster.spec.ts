import { describe, expect, it } from 'vitest';
import { RACER_COUNT } from '../core/constants';
import { createRng } from '../core/rng';
import { EMPTY_SKINS, type SkinSelection } from '../core/types';
import { BREED_LIST } from '../dogs/breeds';
import { isSkinInSlot, SKIN_SLOTS } from '../dogs/skins-catalog';
import { AI_NAMES, createRoster, PLAYER_KART_COLOR } from './roster';

const PLAYER_SKINS: SkinSelection = { head: 'crown', neck: null, body: 'cape' };

describe('createRoster', () => {
  it('compose 8 pilotes : 7 IA puis le joueur en dernier', () => {
    const roster = createRoster('carlin', PLAYER_SKINS, createRng(1));
    expect(roster).toHaveLength(RACER_COUNT);
    expect(roster.filter((entry) => entry.isPlayer)).toHaveLength(1);
    const player = roster[roster.length - 1];
    expect(player).toEqual({
      name: 'Toi',
      breed: 'carlin',
      skins: PLAYER_SKINS,
      kartColor: PLAYER_KART_COLOR,
      isPlayer: true,
      aiSkill: 1,
    });
    // Copie : modifier la sélection d'origine ne touche pas le plateau.
    expect(player.skins).not.toBe(PLAYER_SKINS);
  });

  it.each([1, 2, 3, 42, 1234, 99999])(
    'graine %d : IA aux noms, couleurs et niveaux valides',
    (seed) => {
      const roster = createRoster('chihuahua', EMPTY_SKINS, createRng(seed));
      const ais = roster.filter((entry) => !entry.isPlayer);
      expect(ais).toHaveLength(RACER_COUNT - 1);

      const names = ais.map((entry) => entry.name);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(AI_NAMES).toContain(name);

      const colors = roster.map((entry) => entry.kartColor);
      expect(new Set(colors).size).toBe(colors.length);
      for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
      for (const entry of ais) expect(entry.kartColor).not.toBe(PLAYER_KART_COLOR);

      const breeds = new Set(ais.map((entry) => entry.breed));
      for (const breed of BREED_LIST) expect(breeds.has(breed.id)).toBe(true);

      for (const entry of ais) {
        expect(entry.aiSkill).toBeGreaterThanOrEqual(0.93);
        expect(entry.aiSkill).toBeLessThanOrEqual(1);
        for (const slot of SKIN_SLOTS) {
          const skin = entry.skins[slot];
          if (skin !== null) expect(isSkinInSlot(skin, slot)).toBe(true);
        }
      }
    },
  );

  it('habille les IA au hasard : certains emplacements vides, d’autres non', () => {
    const skins = Array.from({ length: 20 }, (_, seed) =>
      createRoster('teckel', EMPTY_SKINS, createRng(seed)),
    )
      .flat()
      .filter((entry) => !entry.isPlayer)
      .flatMap((entry) => SKIN_SLOTS.map((slot) => entry.skins[slot]));
    const empty = skins.filter((skin) => skin === null).length;
    // 420 emplacements, 50 % vides en moyenne.
    expect(empty / skins.length).toBeGreaterThan(0.35);
    expect(empty / skins.length).toBeLessThan(0.65);
  });

  it('est déterministe : même graine, même plateau ; autre graine, autre plateau', () => {
    const a = createRoster('jack-russell', PLAYER_SKINS, createRng(7));
    const b = createRoster('jack-russell', PLAYER_SKINS, createRng(7));
    const c = createRoster('jack-russell', PLAYER_SKINS, createRng(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
