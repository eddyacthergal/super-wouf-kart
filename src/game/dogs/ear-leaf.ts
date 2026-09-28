/**
 * Feuille d'oreille dressée : contour triangulaire au bout arrondi, extrudé avec un biseau (bords
 * épais et ronds), puis creusé en cuillère. Repère de la feuille : base en y = 0 (une partie
 * s'enfonce dessous, dans le crâne), bout en y = length, largeur le long de X, creux tourné vers +Z.
 */
import * as THREE from 'three';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Creux en cuillère : les sommets avancent vers +Z, d'autant plus qu'ils sont loin de l'axe,
 * rapporté à la demi-largeur de l'oreille à leur hauteur : l'oreille reste creuse jusqu'au bout.
 * Une même forme de creux pour l'oreille et son intérieur : les deux feuilles restent parallèles.
 */
export interface EarCup {
  /** Avance des bords (m), à la base. */
  depth: number;
  /** Demi-largeur de la base (m). */
  halfWidth: number;
  /** Longueur de référence (m) : du bas de l'oreille (0) à son bout (1). */
  length: number;
  /** Rétrécissement de la demi-largeur de référence au bout (0 = aucun, 1 = nulle). */
  narrowing: number;
  /** Part du creux perdue au bout (0 = creux uniforme, 1 = plat au bout). */
  tipFade: number;
}

export interface EarLeafSpec {
  /** Largeur totale à la base (m). */
  width: number;
  /** De la base au bout (m). */
  length: number;
  /** Rayon du bout arrondi (m). */
  tipRadius: number;
  /** Bombé des flancs : avance du point de contrôle vers l'extérieur, en fraction de la demi-largeur. */
  bulge: number;
  /** Partie enfoncée sous la base, dans le crâne (m). */
  sink: number;
  /** Épaisseur totale (m). */
  thickness: number;
  /** Rayon du biseau qui arrondit les bords (m), moins de la moitié de l'épaisseur. */
  bevel: number;
  /** Position du milieu de l'épaisseur le long de Z, avant le creux (m). */
  offsetZ: number;
  cup: EarCup;
}

/**
 * Finesse du maillage : les longues arêtes sont coupées jusqu'à cette longueur (m), pour que le
 * creux courbe aussi le milieu des faces. Plus fin, les triangles se multiplient sans gain visible.
 */
const MAX_EDGE = 0.05;
/**
 * Assez d'itérations pour que toutes les arêtes passent sous `MAX_EDGE` : une arête coupée d'un
 * côté l'est aussi de l'autre, au même milieu, sans fente.
 */
const MAX_ITERATIONS = 40;
/** Points par courbe du contour et tranches du biseau. */
const CURVE_SEGMENTS = 10;
const BEVEL_SEGMENTS = 2;
/** Hauteur du point de contrôle des flancs, en fraction de la hauteur du contour. */
const FLANK_CONTROL_HEIGHT = 0.4;

/** Contour avant biseau (le biseau l'élargit de `bevel` tout autour). */
function leafShape(spec: EarLeafSpec): THREE.Shape {
  const halfWidth = spec.width / 2 - spec.bevel;
  const radius = spec.tipRadius - spec.bevel;
  const top = spec.length - spec.bevel;
  const center = new THREE.Vector2(0, top - radius);
  // Point de contrôle des flancs, et point où le flanc touche l'arrondi du bout : la tangente
  // y est celle du cercle, le contour reste lisse.
  const control = new THREE.Vector2(halfWidth * (1 + spec.bulge), top * FLANK_CONTROL_HEIGHT);
  const toControl = control.clone().sub(center);
  const tangent = Math.atan2(toControl.y, toControl.x) + Math.acos(radius / toControl.length());

  const shape = new THREE.Shape();
  shape.moveTo(halfWidth, 0);
  shape.quadraticCurveTo(
    control.x,
    control.y,
    center.x + radius * Math.cos(tangent),
    center.y + radius * Math.sin(tangent),
  );
  shape.absarc(center.x, center.y, radius, tangent, Math.PI - tangent, false);
  shape.quadraticCurveTo(-control.x, control.y, -halfWidth, 0);
  shape.lineTo(-halfWidth, -spec.sink);
  shape.lineTo(halfWidth, -spec.sink);
  return shape;
}

/** Avance du creux au point (x, y). */
function cupAt(cup: EarCup, x: number, y: number): number {
  const along = THREE.MathUtils.clamp(y / cup.length, 0, 1);
  const halfWidth = cup.halfWidth * (1 - cup.narrowing * along);
  return cup.depth * (x / halfWidth) ** 2 * (1 - cup.tipFade * along);
}

/**
 * Géométrie indexée et soudée (une normale par position : ombrage lisse), déterministe.
 * Le maillage est affiné pour que le creux courbe aussi le milieu des faces.
 */
export function earLeafGeometry(spec: EarLeafSpec): THREE.BufferGeometry {
  const depth = spec.thickness - 2 * spec.bevel;
  const extruded = new THREE.ExtrudeGeometry(leafShape(spec), {
    depth,
    curveSegments: CURVE_SEGMENTS,
    bevelEnabled: true,
    bevelThickness: spec.bevel,
    bevelSize: spec.bevel,
    bevelSegments: BEVEL_SEGMENTS,
  });
  extruded.translate(0, 0, spec.offsetZ - depth / 2);
  // Seules les positions comptent : les normales sont recalculées après le creux.
  extruded.deleteAttribute('normal');
  extruded.deleteAttribute('uv');
  const fine = new TessellateModifier(MAX_EDGE, MAX_ITERATIONS).modify(extruded);
  extruded.dispose();
  const leaf = mergeVertices(fine);
  fine.dispose();

  const positions = leaf.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const lift = cupAt(spec.cup, positions.getX(i), positions.getY(i));
    positions.setZ(i, positions.getZ(i) + lift);
  }
  leaf.computeVertexNormals();
  return leaf;
}
