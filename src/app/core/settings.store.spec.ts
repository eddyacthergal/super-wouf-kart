import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SKINS } from '../../game/core/types';
import { MemoryStorage } from '../testing/memory-storage';
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE,
  SETTINGS_STORAGE_KEY,
  SettingsStore,
  parseSettings,
  type SettingsStorage,
} from './settings.store';

/** Stockage qui refuse toute opération (quota dépassé, accès interdit). */
class ThrowingStorage implements SettingsStorage {
  getItem(): string | null {
    throw new DOMException('Accès refusé', 'SecurityError');
  }
  setItem(): void {
    throw new DOMException('Plus de place', 'QuotaExceededError');
  }
}

function createStore(storage: SettingsStorage | null): SettingsStore {
  TestBed.configureTestingModule({ providers: [{ provide: SETTINGS_STORAGE, useValue: storage }] });
  return TestBed.inject(SettingsStore);
}

describe('SettingsStore', () => {
  it('utilise les valeurs par défaut sans données enregistrées', () => {
    const store = createStore(new MemoryStorage());
    expect(store.breed()).toBe('chihuahua');
    expect(store.skins()).toEqual(EMPTY_SKINS);
    expect(store.muted()).toBe(false);
  });

  it('enregistre chaque changement et le relit au démarrage suivant', () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    store.setBreed('teckel');
    store.setSkin('head', 'crown');
    store.setSkin('neck', 'bandana');
    store.setMuted(true);

    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? 'null')).toEqual({
      breed: 'teckel',
      skins: { head: 'crown', neck: 'bandana', body: null },
      muted: true,
    });

    TestBed.resetTestingModule();
    const reloaded = createStore(storage);
    expect(reloaded.breed()).toBe('teckel');
    expect(reloaded.skins()).toEqual({ head: 'crown', neck: 'bandana', body: null });
    expect(reloaded.muted()).toBe(true);
  });

  it('retire un accessoire avec null et ignore un accessoire du mauvais emplacement', () => {
    const store = createStore(new MemoryStorage());
    store.setSkin('head', 'cap');
    store.setSkin('head', 'bandana');
    expect(store.skins().head).toBe('cap');
    store.setSkin('head', null);
    expect(store.skins().head).toBeNull();
  });

  it('ignore une race inconnue', () => {
    const store = createStore(new MemoryStorage());
    store.setBreed('loup' as never);
    expect(store.breed()).toBe('chihuahua');
  });

  it('valide un stockage corrompu champ par champ', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ breed: 'dragon', skins: { head: 'cape', neck: 'bowtie', body: 42 }, muted: 'oui' }),
    );
    const store = createStore(storage);
    expect(store.breed()).toBe('chihuahua');
    expect(store.skins()).toEqual({ head: null, neck: 'bowtie', body: null });
    expect(store.muted()).toBe(false);
  });

  it('revient aux valeurs par défaut si le JSON est illisible', () => {
    expect(parseSettings('{pas du json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
  });

  it('fonctionne sans exception quand localStorage lève', () => {
    const store = createStore(new ThrowingStorage());
    expect(store.breed()).toBe('chihuahua');
    expect(() => store.setBreed('carlin')).not.toThrow();
    expect(store.breed()).toBe('carlin');
  });

  it('fonctionne sans stockage du tout', () => {
    const store = createStore(null);
    store.setMuted(true);
    expect(store.muted()).toBe(true);
  });
});

describe('SettingsStore avec le vrai localStorage', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('utilise localStorage par défaut', () => {
    const store = TestBed.inject(SettingsStore);
    store.setBreed('jack-russell');
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? 'null')).toMatchObject({ breed: 'jack-russell' });
  });

  it('ne lève jamais quand localStorage refuse lecture et écriture', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Plus de place', 'QuotaExceededError');
    });
    const store = TestBed.inject(SettingsStore);
    expect(store.breed()).toBe('chihuahua');
    expect(() => store.setSkin('body', 'cape')).not.toThrow();
    expect(store.skins().body).toBe('cape');
  });
});
