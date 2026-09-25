/**
 * Traces de pneus au sol : tronçons plats (deux triangles) posés sous les roues arrière des karts
 * qui dérapent, en tampon circulaire préalloué (un seul appel de dessin, aucune allocation pendant
 * la course). Chaque tronçon reste visible un moment puis s'efface en fondu.
 */
import * as THREE from 'three';
import type { DisposalBag } from './resources';

/** Hauteur des traces (m) : juste au-dessus de la route (0,02) et de ses marquages (0,028). */
const MARK_Y = 0.034;
/** Demi-largeur d'une trace (m), un peu moins que celle d'un pneu arrière. */
const HALF_WIDTH = 0.11;
/** Durée de vie d'un tronçon (s), dont les FADE dernières secondes en fondu. */
export const SKID_MARK_LIFE = 2.6;
const FADE = 1.2;
/** Opacité d'une trace fraîche. */
const OPACITY = 0.45;
const VERTICES_PER_SEGMENT = 6;

const vertexShader = /* glsl */ `
  attribute float alpha;
  varying float vAlpha;
  void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 markColor;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    gl_FragColor = vec4(markColor, vAlpha);
    #include <colorspace_fragment>
  }
`;

export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  /** Vie restante de chaque tronçon (s) ; 0 = emplacement libre. */
  private readonly life: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly alphaAttribute: THREE.BufferAttribute;
  private cursor = 0;
  private alive = 0;

  constructor(
    readonly capacity: number,
    color: THREE.ColorRepresentation,
    bag: DisposalBag,
  ) {
    this.positions = new Float32Array(capacity * VERTICES_PER_SEGMENT * 3);
    this.alphas = new Float32Array(capacity * VERTICES_PER_SEGMENT);
    this.life = new Float32Array(capacity);

    const geometry = bag.add(new THREE.BufferGeometry());
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.alphaAttribute = new THREE.BufferAttribute(this.alphas, 1).setUsage(
      THREE.DynamicDrawUsage,
    );
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('alpha', this.alphaAttribute);

    const material = bag.add(
      new THREE.ShaderMaterial({
        uniforms: { markColor: { value: new THREE.Color(color) } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        // Posées à plat sur la route : décalage de profondeur contre le scintillement.
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'skid-marks';
    // Sommets réécrits en continu : la sphère englobante calculée une fois serait fausse.
    this.mesh.frustumCulled = false;
    // Sous les particules (renderOrder 2), au-dessus de la route.
    this.mesh.renderOrder = 1;
  }

  /** Nombre de tronçons visibles. */
  get activeCount(): number {
    return this.alive;
  }

  /** Pose un tronçon de trace entre (x0, z0) et (x1, z1). */
  add(x0: number, z0: number, x1: number, z1: number): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    // Longueur nulle, infinie ou NaN : rien à tracer.
    if (!(length > 1e-3 && Number.isFinite(length))) return;
    // Demi-largeur portée par la normale au tronçon.
    const nx = (-dz / length) * HALF_WIDTH;
    const nz = (dx / length) * HALF_WIDTH;
    const i = this.cursor;
    this.cursor = (i + 1) % this.capacity;
    if (this.life[i] <= 0) this.alive++;
    this.life[i] = SKID_MARK_LIFE;
    // Deux triangles : (a0, b0, b1) et (a0, b1, a1), a et b étant les deux bords de la trace.
    const v = i * VERTICES_PER_SEGMENT;
    this.setVertex(v, x0 + nx, z0 + nz);
    this.setVertex(v + 1, x0 - nx, z0 - nz);
    this.setVertex(v + 2, x1 - nx, z1 - nz);
    this.setVertex(v + 3, x0 + nx, z0 + nz);
    this.setVertex(v + 4, x1 - nx, z1 - nz);
    this.setVertex(v + 5, x1 + nx, z1 + nz);
    this.alphas.fill(OPACITY, v, v + VERTICES_PER_SEGMENT);
    this.positionAttribute.needsUpdate = true;
    this.alphaAttribute.needsUpdate = true;
  }

  /** Vieillit les traces : fondu en fin de vie, puis emplacement libéré. */
  update(dt: number): void {
    if (this.alive === 0 || !(dt > 0)) return;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      const life = this.life[i] - dt;
      const v = i * VERTICES_PER_SEGMENT;
      if (life <= 0) {
        this.life[i] = 0;
        this.alphas.fill(0, v, v + VERTICES_PER_SEGMENT);
        // Tronçon replié sur un point : plus aucun pixel à dessiner.
        this.positions.fill(0, v * 3, (v + VERTICES_PER_SEGMENT) * 3);
        this.positionAttribute.needsUpdate = true;
        continue;
      }
      alive++;
      this.life[i] = life;
      this.alphas.fill(OPACITY * Math.min(1, life / FADE), v, v + VERTICES_PER_SEGMENT);
    }
    this.alive = alive;
    this.alphaAttribute.needsUpdate = true;
  }

  private setVertex(v: number, x: number, z: number): void {
    const i3 = v * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = MARK_Y;
    this.positions[i3 + 2] = z;
  }
}
