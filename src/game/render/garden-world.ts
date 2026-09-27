/**
 * Monde en plein air autour du circuit : sol, piste (allée, bas-côtés, bordures, départ), haies,
 * décor géant, nuages et éléments propres au thème (neige qui tombe, mer, animaux…).
 * Le jardin est le style par défaut ; les autres thèmes changent couleurs, décor et extras.
 * Construit sans WebGL (testable en Node).
 */
import * as THREE from 'three';
import type { TrackQuery } from '../core/types';
import type { TrackDecorHints } from '../track/track-definition';
import { buildDecor, type DecorColors, GARDEN_DECOR_COLORS } from './decor';
import { type DecorPlan, type DecorRecipe, GARDEN_RECIPE, planDecor } from './decor-plan';
import { buildHedges, GARDEN_HEDGES, type HedgeStyle } from './hedges';
import { PALETTE } from './palette';
import { DisposalBag } from './resources';
import type { CloudStyle, ThemeWorld } from './scene-theme';
import { buildClouds, SUMMER_CLOUDS } from './sky';
import { createTerrain, TERRAIN_FADE, type Terrain } from './terrain';
import { type Bounds, trackBounds } from './track-geometry';
import { buildTrackSurface, GARDEN_SURFACE, type SurfaceStyle } from './track-surface';
import { createLawnTexture } from './textures';

/** Côté de la pelouse (m) : ses bords se perdent dans le brouillard. */
const LAWN_SIZE = 2400;
/** Largeur (m) couverte par une répétition de la texture de pelouse (deux bandes de tonte). */
const LAWN_TILE = 20;
/** Sous le maillage de relief, la pelouse lointaine est abaissée d'autant (m). */
const LAWN_DROP = -0.5;
/** Maille du relief (m) et marge autour de la piste et du décor. */
const TERRAIN_CELL = 4;
const TERRAIN_MARGIN = 20;

/** Élément animé propre à un thème ; `focus` est la position de la caméra. */
export interface WorldPart {
  object: THREE.Object3D;
  update?(time: number, focus: THREE.Vector3): void;
}

/** Ce que les extras d'un thème savent du monde construit. */
export interface WorldContext {
  track: TrackQuery;
  plan: DecorPlan;
  /** Emprise de la ligne médiane du circuit. */
  bounds: Bounds;
  bag: DisposalBag;
  terrain: Terrain;
}

export interface OutdoorStyle {
  /** Nom du groupe racine (débogage, tests). */
  name: string;
  /** Couleurs des deux bandes du sol (pelouse tondue, neige, sable…). */
  ground: readonly [string, string];
  surface: SurfaceStyle;
  hedges: HedgeStyle;
  decor: DecorColors;
  recipe: DecorRecipe;
  clouds: CloudStyle;
  extras?: (context: WorldContext) => WorldPart[];
}

export const GARDEN_STYLE: OutdoorStyle = {
  name: 'garden-world',
  ground: [PALETTE.lawnLight, PALETTE.lawnDark],
  surface: GARDEN_SURFACE,
  hedges: GARDEN_HEDGES,
  decor: GARDEN_DECOR_COLORS,
  recipe: GARDEN_RECIPE,
  clouds: SUMMER_CLOUDS,
};

/** Monde construit : le rendu appelle `update` à chaque image. */
export type GardenWorld = ThemeWorld;

function buildLawn(
  centerX: number,
  centerZ: number,
  colors: readonly [string, string],
  bag: DisposalBag,
): THREE.Mesh {
  const texture = bag.add(createLawnTexture(colors[0], colors[1]));
  texture.repeat.set(LAWN_SIZE / LAWN_TILE, LAWN_SIZE / LAWN_TILE);
  const lawn = new THREE.Mesh(
    bag.add(new THREE.PlaneGeometry(LAWN_SIZE, LAWN_SIZE).rotateX(-Math.PI / 2)),
    bag.add(new THREE.MeshStandardMaterial({ map: texture, roughness: 1 })),
  );
  lawn.name = 'lawn';
  lawn.position.set(centerX, 0, centerZ);
  lawn.receiveShadow = true;
  return lawn;
}

/** Union de l'emprise de la piste (relief compris), de la clôture et de l'encombrement du décor. */
function terrainArea(track: TrackQuery, plan: DecorPlan): Bounds {
  const trackArea = trackBounds(track, track.wallHalfWidth + TERRAIN_FADE + TERRAIN_MARGIN);
  let minX = Math.min(trackArea.minX, plan.fence.minX - TERRAIN_MARGIN);
  let maxX = Math.max(trackArea.maxX, plan.fence.maxX + TERRAIN_MARGIN);
  let minZ = Math.min(trackArea.minZ, plan.fence.minZ - TERRAIN_MARGIN);
  let maxZ = Math.max(trackArea.maxZ, plan.fence.maxZ + TERRAIN_MARGIN);
  for (const placement of plan.placements) {
    minX = Math.min(minX, placement.x - placement.radius);
    maxX = Math.max(maxX, placement.x + placement.radius);
    minZ = Math.min(minZ, placement.z - placement.radius);
    maxZ = Math.max(maxZ, placement.z + placement.radius);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Maillage du relief sous la piste et le décor : suit `terrain.heightAt`, bord rabattu au niveau
 * de la pelouse lointaine (LAWN_DROP) pour un raccord sans couture.
 */
function buildTerrainMesh(
  area: Bounds,
  terrain: Terrain,
  colors: readonly [string, string],
  bag: DisposalBag,
): THREE.Mesh {
  const width = area.maxX - area.minX;
  const depth = area.maxZ - area.minZ;
  const segX = Math.ceil(width / TERRAIN_CELL);
  const segZ = Math.ceil(depth / TERRAIN_CELL);
  const geometry = bag.add(new THREE.PlaneGeometry(width, depth, segX, segZ).rotateX(-Math.PI / 2));
  const centerX = (area.minX + area.maxX) / 2;
  const centerZ = (area.minZ + area.maxZ) / 2;
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const col = i % (segX + 1);
    const row = Math.floor(i / (segX + 1));
    const border = col === 0 || row === 0 || col === segX || row === segZ;
    const x = positions.getX(i) + centerX;
    const z = positions.getZ(i) + centerZ;
    positions.setY(i, border ? LAWN_DROP : terrain.heightAt(x, z));
  }
  geometry.computeVertexNormals();
  const texture = bag.add(createLawnTexture(colors[0], colors[1]));
  texture.repeat.set(width / LAWN_TILE, depth / LAWN_TILE);
  const mesh = new THREE.Mesh(
    geometry,
    bag.add(new THREE.MeshStandardMaterial({ map: texture, roughness: 1 })),
  );
  mesh.name = 'terrain';
  mesh.position.set(centerX, 0, centerZ);
  mesh.receiveShadow = true;
  return mesh;
}

/** Monde en plein air autour de `track`, avec les indications de décor du circuit. */
export function buildGardenWorld(
  track: TrackQuery,
  decorHints?: TrackDecorHints,
  style: OutdoorStyle = GARDEN_STYLE,
  terrain: Terrain = createTerrain(track),
): GardenWorld {
  const bag = new DisposalBag();
  const bounds = trackBounds(track, 0);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  const root = new THREE.Group();
  root.name = style.name;
  const plan = planDecor(track, decorHints, style.recipe);
  const decor = buildDecor(plan, bag, style.decor, terrain);
  const clouds = buildClouds(bag, centerX, centerZ, style.clouds);
  const extras = style.extras?.({ track, plan, bounds, bag, terrain }) ?? [];
  const lawn = buildLawn(centerX, centerZ, style.ground, bag);
  if (terrain.hilly) lawn.position.y = LAWN_DROP;
  root.add(
    lawn,
    buildTrackSurface(track, bag, style.surface),
    buildHedges(track, bag, style.hedges, terrain).group,
    decor.group,
    clouds.group,
    ...extras.map((part) => part.object),
  );
  if (terrain.hilly) {
    root.add(buildTerrainMesh(terrainArea(track, plan), terrain, style.ground, bag));
  }

  const focus = new THREE.Vector3(centerX, 0, centerZ);
  let disposed = false;
  return {
    root,
    update(time: number, camera?: THREE.Vector3): void {
      if (disposed) return;
      if (camera) focus.copy(camera);
      decor.update(time);
      clouds.update(time);
      for (const part of extras) part.update?.(time, focus);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      bag.dispose();
    },
  };
}
