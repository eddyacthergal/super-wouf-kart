import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  mirroredPair,
  paintFaces,
  RefCountedCache,
  ResourceScope,
  sharedGeometries,
  sharedMaterials,
  smoothTowards,
} from './model-resources';

describe('RefCountedCache', () => {
  it('crée une seule fois et libère au dernier release', () => {
    const cache = new RefCountedCache<{ dispose(): void }>();
    const dispose = vi.fn();
    const create = vi.fn(() => ({ dispose }));
    const a = cache.acquire('k', create);
    const b = cache.acquire('k', create);
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
    cache.release('k');
    expect(dispose).not.toHaveBeenCalled();
    expect(cache.size).toBe(1);
    cache.release('k');
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    // Un release de trop ne fait rien.
    cache.release('k');
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe('ResourceScope', () => {
  it('partage les matériaux par couleur (casse ignorée) et options', () => {
    const scope = new ResourceScope();
    const a = scope.material('#D7322E');
    const b = scope.material('#d7322e');
    const c = scope.material('#d7322e', { roughness: 0.2 });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    scope.dispose();
  });

  it('pose l’image d’environnement et le vernis sur le seul matériau qui les demande', () => {
    const scope = new ResourceScope();
    const environment = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    environment.mapping = THREE.EquirectangularReflectionMapping;
    const plain = scope.material('#d7322e', { roughness: 0.35 });
    const glossy = scope.material('#d7322e', {
      roughness: 0.35,
      envMap: environment,
      envMapIntensity: 0.5,
    });
    const varnished = scope.material('#d7322e', {
      roughness: 0.35,
      envMap: environment,
      envMapIntensity: 0.5,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    });
    expect(plain.envMap).toBeNull();
    expect(glossy.envMap).toBe(environment);
    expect(glossy.envMapIntensity).toBe(0.5);
    expect(glossy).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(varnished).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect((varnished as THREE.MeshPhysicalMaterial).clearcoat).toBe(1);
    expect((varnished as THREE.MeshPhysicalMaterial).clearcoatRoughness).toBe(0.1);
    // Chaque réglage des reflets distingue le matériau partagé.
    expect(new Set([plain, glossy, varnished]).size).toBe(3);
    const stronger = scope.material('#d7322e', {
      roughness: 0.35,
      envMap: environment,
      envMapIntensity: 1,
    });
    expect(stronger).not.toBe(glossy);
    // Une autre image (une autre course) donne un autre matériau : jamais de texture libérée.
    const other = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const next = scope.material('#d7322e', { roughness: 0.35, envMap: other, envMapIntensity: 0.5 });
    expect(next).not.toBe(glossy);
    expect(next.envMap).toBe(other);
    scope.dispose();
    environment.dispose();
    other.dispose();
  });

  it('fabrique des matériaux non éclairés, partagés et libérés avec le modèle', () => {
    const before = sharedMaterials.size;
    const first = new ResourceScope();
    const second = new ResourceScope();
    const shine = first.unlitMaterial('#ffffff');
    expect(shine).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect(shine.toneMapped).toBe(false);
    expect(shine.color.getHexString()).toBe('ffffff');
    expect(second.unlitMaterial('#FFFFFF')).toBe(shine);
    // Pas confondu avec un matériau éclairé de même couleur.
    expect(first.material('#ffffff')).not.toBe(shine);
    const onDispose = vi.fn();
    shine.addEventListener('dispose', onDispose);
    first.dispose();
    expect(onDispose).not.toHaveBeenCalled();
    second.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(sharedMaterials.size).toBe(before);
  });

  it('rend les ressources partagées et libère les ressources propres, une seule fois', () => {
    const geometriesBefore = sharedGeometries.size;
    const materialsBefore = sharedMaterials.size;
    const first = new ResourceScope();
    const second = new ResourceScope();
    const shared = first.geometry('test:box', () => new THREE.BoxGeometry());
    expect(second.geometry('test:box', () => new THREE.BoxGeometry())).toBe(shared);
    first.material('#123456');
    const owned = first.own(new THREE.BufferGeometry());
    const onShared = vi.fn();
    const onOwned = vi.fn();
    shared.addEventListener('dispose', onShared);
    owned.addEventListener('dispose', onOwned);

    first.dispose();
    first.dispose();
    expect(onOwned).toHaveBeenCalledTimes(1);
    expect(onShared).not.toHaveBeenCalled();
    expect(sharedMaterials.size).toBe(materialsBefore);

    second.dispose();
    expect(onShared).toHaveBeenCalledTimes(1);
    expect(sharedGeometries.size).toBe(geometriesBefore);
  });
});

describe('utilitaires de géométrie', () => {
  it('mirroredPair produit une paire symétrique par rapport à x = 0', () => {
    const geometry = mirroredPair(new THREE.SphereGeometry(0.1, 8, 6), {
      position: new THREE.Vector3(0.5, 1, 0.2),
      quaternion: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0.4, 0.5)),
      scale: new THREE.Vector3(1, 2, 1),
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox ?? new THREE.Box3();
    expect(box.min.x).toBeCloseTo(-box.max.x, 5);
    expect(box.max.x).toBeGreaterThan(0.5);
    expect(box.min.y).toBeGreaterThan(0.7);
  });

  it('paintFaces colore chaque face uniformément', () => {
    const red = new THREE.Color('#ff0000');
    const blue = new THREE.Color('#0000ff');
    const geometry = paintFaces(new THREE.BoxGeometry(1, 1, 1, 1, 2, 1), (center) =>
      center.y > 0 ? red : blue,
    );
    const colors = geometry.getAttribute('color');
    const positions = geometry.getAttribute('position');
    expect(geometry.index).toBeNull();
    expect(colors.count).toBe(positions.count);
    for (let i = 0; i < colors.count; i += 3) {
      expect(colors.getX(i)).toBe(colors.getX(i + 1));
      expect(colors.getZ(i)).toBe(colors.getZ(i + 2));
    }
  });

  it('smoothTowards converge sans dépasser et ignore dt = 0', () => {
    expect(smoothTowards(0, 1, 10, 0)).toBe(0);
    let value = 0;
    for (let i = 0; i < 120; i++) value = smoothTowards(value, 1, 10, 1 / 60);
    expect(value).toBeGreaterThan(0.99);
    expect(value).toBeLessThanOrEqual(1);
  });
});
