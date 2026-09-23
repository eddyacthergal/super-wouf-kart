import { describe, expect, it } from 'vitest';
import { EMPTY_SKINS } from '../core/types';
import { isSkinInSlot, sanitizeSkins, SKINS, skinsForSlot } from './skins-catalog';

describe('catalogue des accessoires', () => {
  it('contient 9 accessoires aux identifiants uniques', () => {
    expect(SKINS).toHaveLength(9);
    expect(new Set(SKINS.map((skin) => skin.id)).size).toBe(9);
  });

  it('répartit 4 / 3 / 2 accessoires par emplacement, avec leurs noms français', () => {
    expect(skinsForSlot('head').map((skin) => [skin.id, skin.name])).toEqual([
      ['cap', 'Casquette'],
      ['crown', 'Couronne'],
      ['beanie', 'Bonnet à pompon'],
      ['party-hat', 'Chapeau de fête'],
    ]);
    expect(skinsForSlot('neck').map((skin) => [skin.id, skin.name])).toEqual([
      ['bandana', 'Bandana'],
      ['bowtie', 'Nœud papillon'],
      ['bell-collar', 'Collier à grelot'],
    ]);
    expect(skinsForSlot('body').map((skin) => [skin.id, skin.name])).toEqual([
      ['sweater', 'Pull rayé'],
      ['cape', 'Cape de héros'],
    ]);
  });

  it('skinsForSlot renvoie un nouveau tableau', () => {
    const list = skinsForSlot('head');
    list.pop();
    expect(skinsForSlot('head')).toHaveLength(4);
  });

  it('isSkinInSlot vérifie l’identifiant et l’emplacement', () => {
    expect(isSkinInSlot('crown', 'head')).toBe(true);
    expect(isSkinInSlot('crown', 'neck')).toBe(false);
    expect(isSkinInSlot('inconnu', 'head')).toBe(false);
    expect(isSkinInSlot(42, 'head')).toBe(false);
  });
});

describe('sanitizeSkins', () => {
  it('garde une sélection valide', () => {
    const valid = { head: 'party-hat', neck: 'bell-collar', body: 'cape' };
    expect(sanitizeSkins(valid)).toEqual(valid);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['une chaîne', 'crown'],
    ['un nombre', 12],
    ['un tableau', ['cap', 'bandana']],
    ['un objet vide', {}],
  ])('renvoie une sélection vide pour %s', (_label, value) => {
    expect(sanitizeSkins(value)).toEqual(EMPTY_SKINS);
  });

  it('remplace les identifiants inconnus ou mal typés par null', () => {
    expect(sanitizeSkins({ head: 'sombrero', neck: 3, body: { id: 'cape' } })).toEqual(EMPTY_SKINS);
    expect(sanitizeSkins({ head: 'cap', neck: 'licorne', body: null })).toEqual({
      head: 'cap',
      neck: null,
      body: null,
    });
  });

  it('refuse un accessoire placé dans le mauvais emplacement', () => {
    expect(sanitizeSkins({ head: 'cape', neck: 'crown', body: 'bandana' })).toEqual(EMPTY_SKINS);
    expect(sanitizeSkins({ head: 'beanie', neck: 'sweater', body: 'sweater' })).toEqual({
      head: 'beanie',
      neck: null,
      body: 'sweater',
    });
  });

  it('ignore les clés supplémentaires et renvoie un nouvel objet', () => {
    const result = sanitizeSkins({ head: 'cap', tail: 'bow', extra: 1 });
    expect(result).toEqual({ head: 'cap', neck: null, body: null });
    expect(Object.keys(result).sort()).toEqual(['body', 'head', 'neck']);
    expect(sanitizeSkins(null)).not.toBe(EMPTY_SKINS);
  });
});
