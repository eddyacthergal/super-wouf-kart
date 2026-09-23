/**
 * Réserve de particules préallouée (THREE.Points, un seul appel de dessin) :
 * tampon circulaire, couleur, taille et opacité par particule, gravité et traînée.
 * Aucune allocation pendant la course.
 */
import * as THREE from 'three';
import type { DisposalBag } from './resources';

const vertexShader = /* glsl */ `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float halfHeight;
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Taille en mètres convertie en pixels (projection perspective).
    gl_PointSize = min(size * projectionMatrix[1][1] * halfHeight / max(-mvPosition.z, 0.1), 256.0);
    gl_Position = projectionMatrix * mvPosition;
    vTint = tint;
    vAlpha = alpha;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vTint;
  varying float vAlpha;
  void main() {
    vec2 centered = gl_PointCoord - 0.5;
    float d = length(centered);
    if (d > 0.5 || vAlpha <= 0.0) discard;
    gl_FragColor = vec4(vTint, vAlpha * smoothstep(0.5, 0.2, d));
    #include <colorspace_fragment>
  }
`;

export interface ParticleOptions {
  /** Accélération verticale (m/s², négative = chute). */
  gravity?: number;
  /** Croissance de la taille (m/s). */
  growth?: number;
  /** Freinage de la vitesse (1/s). */
  drag?: number;
  /** Opacité de départ. */
  opacity?: number;
}

const NO_OPTIONS: ParticleOptions = {};

export class ParticlePool {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly tints: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly gravity: Float32Array;
  private readonly growth: Float32Array;
  private readonly drag: Float32Array;
  private readonly opacity: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly attributes: readonly THREE.BufferAttribute[];
  private readonly material: THREE.ShaderMaterial;
  private readonly bufferSize = new THREE.Vector2();
  private cursor = 0;
  private alive = 0;

  constructor(
    readonly capacity: number,
    additive: boolean,
    bag: DisposalBag,
  ) {
    this.positions = new Float32Array(capacity * 3);
    this.tints = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.growth = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.opacity = new Float32Array(capacity);

    this.geometry = bag.add(new THREE.BufferGeometry());
    const attribute = (array: Float32Array, itemSize: number): THREE.BufferAttribute =>
      new THREE.BufferAttribute(array, itemSize).setUsage(THREE.DynamicDrawUsage);
    this.attributes = [
      attribute(this.positions, 3),
      attribute(this.tints, 3),
      attribute(this.sizes, 1),
      attribute(this.alphas, 1),
    ];
    ['position', 'tint', 'size', 'alpha'].forEach((name, i) =>
      this.geometry.setAttribute(name, this.attributes[i]),
    );

    this.material = bag.add(
      new THREE.ShaderMaterial({
        uniforms: { halfHeight: { value: 400 } },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      }),
    );
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = additive ? 'particles-glow' : 'particles-soft';
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(this.bufferSize);
      this.material.uniforms['halfHeight'].value = this.bufferSize.y / 2;
    };
  }

  /** Nombre de particules vivantes. */
  get activeCount(): number {
    return this.alive;
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: THREE.Color,
    size: number,
    life: number,
    options: ParticleOptions = NO_OPTIONS,
  ): void {
    // Durée nulle, négative ou NaN : la particule ne s'éteindrait jamais (NaN) ou fausserait le compte.
    if (!(life > 0)) return;
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.life[i] <= 0) this.alive++;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.velocities[i3] = vx;
    this.velocities[i3 + 1] = vy;
    this.velocities[i3 + 2] = vz;
    this.tints[i3] = color.r;
    this.tints[i3 + 1] = color.g;
    this.tints[i3 + 2] = color.b;
    this.sizes[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.gravity[i] = options.gravity ?? 0;
    this.growth[i] = options.growth ?? 0;
    this.drag[i] = options.drag ?? 0;
    this.opacity[i] = options.opacity ?? 1;
    this.alphas[i] = this.opacity[i];
  }

  update(dt: number): void {
    if (this.alive === 0 || dt <= 0) return;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      const life = this.life[i] - dt;
      const i3 = i * 3;
      if (life <= 0) {
        this.life[i] = 0;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      alive++;
      this.life[i] = life;
      const damping = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      this.velocities[i3] *= damping;
      this.velocities[i3 + 1] = this.velocities[i3 + 1] * damping + this.gravity[i] * dt;
      this.velocities[i3 + 2] *= damping;
      this.positions[i3] += this.velocities[i3] * dt;
      this.positions[i3 + 1] = Math.max(
        0.03,
        this.positions[i3 + 1] + this.velocities[i3 + 1] * dt,
      );
      this.positions[i3 + 2] += this.velocities[i3 + 2] * dt;
      this.sizes[i] = Math.max(0, this.sizes[i] + this.growth[i] * dt);
      const t = life / this.maxLife[i];
      // Apparition rapide puis extinction progressive.
      this.alphas[i] = this.opacity[i] * Math.min(1, t * 1.6);
    }
    this.alive = alive;
    for (const attribute of this.attributes) attribute.needsUpdate = true;
  }
}
