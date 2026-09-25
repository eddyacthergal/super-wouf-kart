import { describe, expect, it } from 'vitest';
import { EMPTY_SKINS } from '../../game/core/types';
import {
  breedName,
  describeDog,
  equippedSkinNames,
  formatPlace,
  formatRaceTime,
  formatRank,
  formatRankDisplay,
  itemHint,
  itemName,
  joinWithEt,
  skinName,
} from './format';

describe('formatRaceTime', () => {
  it('affiche minutes, secondes et centièmes', () => {
    expect(formatRaceTime(65.32)).toBe('1:05.32');
    expect(formatRaceTime(0)).toBe('0:00.00');
    expect(formatRaceTime(9.5)).toBe('0:09.50');
    expect(formatRaceTime(125.999)).toBe('2:05.99');
    expect(formatRaceTime(600)).toBe('10:00.00');
  });

  it('résiste aux erreurs d’arrondi flottant', () => {
    expect(formatRaceTime(0.29)).toBe('0:00.29');
    expect(formatRaceTime(1.1)).toBe('0:01.10');
  });

  it('ramène les valeurs invalides à zéro', () => {
    expect(formatRaceTime(-3)).toBe('0:00.00');
    expect(formatRaceTime(Number.NaN)).toBe('0:00.00');
    expect(formatRaceTime(Number.POSITIVE_INFINITY)).toBe('0:00.00');
  });

  it('peut n’afficher que les dixièmes (chrono du HUD)', () => {
    expect(formatRaceTime(65.39, 1)).toBe('1:05.3');
    expect(formatRaceTime(0, 1)).toBe('0:00.0');
    expect(formatRaceTime(59.99, 1)).toBe('0:59.9');
    expect(formatRaceTime(0.3, 1)).toBe('0:00.3');
    expect(formatRaceTime(-1, 1)).toBe('0:00.0');
  });
});

describe('rangs', () => {
  it('formatRank donne « 1er », « 2e »…', () => {
    expect(formatRank(1)).toBe('1er');
    expect(formatRank(2)).toBe('2e');
    expect(formatRank(8)).toBe('8e');
  });

  it('formatRankDisplay donne la variante typographique', () => {
    expect(formatRankDisplay(1)).toBe('1ᵉʳ');
    expect(formatRankDisplay(3)).toBe('3ᵉ');
  });

  it('formatPlace accorde au féminin', () => {
    expect(formatPlace(1)).toBe('1re place');
    expect(formatPlace(3)).toBe('3e place');
  });
});

describe('noms', () => {
  it('breedName, skinName et itemName traduisent les identifiants', () => {
    expect(breedName('chihuahua')).toBe('Chihuahua');
    expect(breedName('jack-russell')).toBe('Jack Russell');
    expect(skinName('cap')).toBe('Casquette');
    expect(skinName('inconnu')).toBe('inconnu');
    expect(itemName('tennis-ball')).toBe('Balle de tennis');
    expect(itemHint('mud')).toBe('Déposée derrière toi');
  });

  it('joinWithEt énumère à la française', () => {
    expect(joinWithEt([])).toBe('');
    expect(joinWithEt(['a'])).toBe('a');
    expect(joinWithEt(['a', 'b'])).toBe('a et b');
    expect(joinWithEt(['a', 'b', 'c'])).toBe('a, b et c');
  });

  it('describeDog résume le pilote et ses accessoires', () => {
    expect(describeDog('chihuahua', { head: 'cap', neck: 'bandana', body: null })).toBe(
      'chihuahua avec casquette et bandana',
    );
    expect(describeDog('teckel', EMPTY_SKINS)).toBe('teckel sans accessoire');
    expect(equippedSkinNames({ head: null, neck: 'bowtie', body: 'cape' })).toEqual([
      'Nœud papillon',
      'Cape de héros',
    ]);
  });
});
