/**
 * Ciel d'été : dôme en dégradé (bleu vif au zénith, bleu pâle à l'horizon) avec un soleil,
 * et quelques nuages cartoon lointains. Le dôme suit la caméra ; l'horizon a la couleur du brouillard.
 */
import * as THREE from 'three';
import { createRng } from '../core/rng';
import { PALETTE } from './palette';
import type { DisposalBag } from './resources';

/** Direction du soleil (du sol vers le soleil) : dans le dos de la caméra sur la ligne droite de départ. */
export const SUN_DIRECTION = new THREE.Vector3(0.45, 0.8, -0.38).normalize();

export const FOG_NEAR = 160;
export const FOG_FAR = 700;
const SKY_RADIUS = 900;

const vertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  varying vec3 vDirection;
  void main() {
    vec3 direction = normalize(vDirection);
    float height = max(direction.y, 0.0);
    vec3 color = mix(horizonColor, topColor, pow(height, 0.5));
    float facing = max(dot(direction, sunDirection), 0.0);
    color += sunColor * (smoothstep(0.9991, 0.9995, facing) * 2.0 + pow(facing, 80.0) * 0.35 + pow(facing, 8.0) * 0.08);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export function buildSkyDome(bag: DisposalBag): THREE.Mesh {
  const material = bag.add(
    new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(PALETTE.skyTop) },
        horizonColor: { value: new THREE.Color(PALETTE.skyHorizon) },
        sunColor: { value: new THREE.Color(PALETTE.sun) },
        sunDirection: { value: SUN_DIRECTION.clone() },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  const dome = new THREE.Mesh(bag.add(new THREE.SphereGeometry(SKY_RADIUS, 32, 16)), material);
  dome.name = 'sky';
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

export interface Clouds {
  group: THREE.Group;
  update(time: number): void;
}

/** Nuages ronds et lointains, qui dérivent très lentement autour du jardin. */
export function buildClouds(bag: DisposalBag, centerX: number, centerZ: number): Clouds {
  const rng = createRng(0xc10d);
  const matrices: THREE.Matrix4[] = [];
  for (let c = 0; c < 14; c++) {
    const angle = (c / 14) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const distance = rng.range(520, 820);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const y = rng.range(120, 220);
    const size = rng.range(22, 38);
    const blobs = rng.int(4, 6);
    for (let b = 0; b < blobs; b++) {
      const t = blobs === 1 ? 0 : b / (blobs - 1) - 0.5;
      const along = t * size * 2.4;
      const s = size * (1 - Math.abs(t) * 0.8) * rng.range(0.8, 1.1);
      matrices.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(
            x - Math.sin(angle) * along,
            y + rng.range(-0.1, 0.25) * size,
            z + Math.cos(angle) * along,
          ),
          new THREE.Quaternion(),
          new THREE.Vector3(s, s * 0.6, s),
        ),
      );
    }
  }
  const material = bag.add(
    new THREE.MeshStandardMaterial({
      color: PALETTE.cloud,
      emissive: '#dfefff',
      emissiveIntensity: 0.45,
      roughness: 1,
      fog: false,
    }),
  );
  const mesh = new THREE.InstancedMesh(
    bag.add(new THREE.IcosahedronGeometry(1, 2)),
    material,
    matrices.length,
  );
  mesh.name = 'clouds';
  matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
  mesh.computeBoundingSphere();
  const group = new THREE.Group();
  group.name = 'clouds';
  group.position.set(centerX, 0, centerZ);
  group.add(mesh);
  return {
    group,
    update(time: number): void {
      group.rotation.y = time * 0.004;
    },
  };
}
