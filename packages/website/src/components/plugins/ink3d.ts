import { type Box, createPlugin, expandBox, type InkStyle, type PathPoint, type StrokePath, unionBoxes } from 'tegaki/core';
import {
  ACESFilmicToneMapping,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  type Material,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  type Texture,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { canvasColor } from './color.ts';

/**
 * The key this plugin's `geometry` hook puts each point's height above the
 * page under, in px (see `PathPoint.data`). Any `geometry` plugin before the
 * painting can set it too: the ink is drawn that far off the page.
 */
export const DEPTH_KEY = 'ink3d.z';

// ---------------------------------------------------------------------------
// The tube: a stroke's ink as a mesh
// ---------------------------------------------------------------------------

export interface TubeShape {
  /** The tube's width over the pen's. */
  thickness: number;
  /** How tall it stands over how wide it is: 1 is round, less a flatter bead. */
  depth: number;
  /** How far over the page its underside is, px. */
  lift: number;
  /** Vertices round each ring. */
  radial: number;
  /** Rings in each rounded end. */
  caps: number;
}

export interface TubeMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/**
 * A stroke's points as a tube, in 3D px about `origin` with y up and z off
 * the page: each point a ring (an ellipse `depth` as tall as it is wide,
 * standing on the page `lift` px up, plus the point's own {@link DEPTH_KEY}),
 * both ends rounded off, so a dot is a bead. `colorAt(t)` colors each ring
 * by its draw progress, as linear RGB. Triangles face outward.
 */
export function tubeMesh(
  points: readonly PathPoint[],
  origin: { x: number; y: number },
  shape: TubeShape,
  colorAt: (t: number) => readonly [number, number, number],
): TubeMesh {
  const pts: PathPoint[] = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.25) pts[pts.length - 1] = { ...p, t: p.t };
    else pts.push(p);
  }
  if (pts.length === 0)
    return { positions: new Float32Array(), normals: new Float32Array(), colors: new Float32Array(), indices: new Uint32Array() };

  interface Ring {
    p: PathPoint;
    tx: number;
    ty: number;
    /** 0 round the middle, π/2 at a tip. */
    phi: number;
    /** Which end a cap ring rounds: -1 the start, 1 the end. */
    side: number;
  }
  const rings: Ring[] = [];
  let tx = 1;
  let ty = 0;
  const tangents = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(pts.length - 1, i + 1)]!;
    // y up: the page's y runs down.
    const dx = b.x - a.x;
    const dy = a.y - b.y;
    const len = Math.hypot(dx, dy);
    if (len > 0) {
      tx = dx / len;
      ty = dy / len;
    }
    return [tx, ty] as const;
  });
  const caps = Math.max(1, shape.caps);
  for (let k = 0; k < caps; k++)
    rings.push({ p: pts[0]!, tx: tangents[0]![0], ty: tangents[0]![1], phi: (Math.PI / 2) * (1 - k / caps), side: -1 });
  for (let i = 0; i < pts.length; i++) rings.push({ p: pts[i]!, tx: tangents[i]![0], ty: tangents[i]![1], phi: 0, side: 0 });
  const last = pts.length - 1;
  for (let k = caps - 1; k >= 0; k--) {
    rings.push({ p: pts[last]!, tx: tangents[last]![0], ty: tangents[last]![1], phi: (Math.PI / 2) * (1 - k / caps), side: 1 });
  }

  const n = shape.radial;
  const d = Math.max(0.05, shape.depth);
  const positions = new Float32Array(rings.length * n * 3);
  const normals = new Float32Array(rings.length * n * 3);
  const colors = new Float32Array(rings.length * n * 3);
  let v = 0;
  for (const { p, tx, ty, phi, side } of rings) {
    const r = (p.width / 2) * shape.thickness;
    const cx = p.x - origin.x;
    const cy = origin.y - p.y;
    const cz = shape.lift + (p.data?.[DEPTH_KEY] ?? 0) + r * d;
    // Along the stroke (T), across it on the page (N, T turned left) and off the page (B = z).
    const nx = -ty;
    const ny = tx;
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    const [red, green, blue] = colorAt(p.t);
    for (let j = 0; j < n; j++) {
      const theta = (2 * Math.PI * j) / n;
      const a = side * r * sin;
      const b = r * cos * Math.cos(theta);
      const c = r * d * cos * Math.sin(theta);
      positions[v] = cx + tx * a + nx * b;
      positions[v + 1] = cy + ty * a + ny * b;
      positions[v + 2] = cz + c;
      // The ellipsoid's normal: each axis over its radius squared.
      const ma = side * sin;
      const mb = cos * Math.cos(theta);
      const mc = (cos * Math.sin(theta)) / d;
      let ox = tx * ma + nx * mb;
      let oy = ty * ma + ny * mb;
      let oz = mc;
      const len = Math.hypot(ox, oy, oz) || 1;
      ox /= len;
      oy /= len;
      oz /= len;
      normals[v] = ox;
      normals[v + 1] = oy;
      normals[v + 2] = oz;
      colors[v] = red;
      colors[v + 1] = green;
      colors[v + 2] = blue;
      v += 3;
    }
  }
  const indices = new Uint32Array((rings.length - 1) * n * 6);
  let i = 0;
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let j = 0; j < n; j++) {
      const a = k * n + j;
      const b = k * n + ((j + 1) % n);
      const c = a + n;
      const e = b + n;
      indices.set([a, b, c, b, e, c], i);
      i += 6;
    }
  }
  return { positions, normals, colors, indices };
}

// ---------------------------------------------------------------------------
// The camera: the page seen square on, pixel for pixel
// ---------------------------------------------------------------------------

/** How the page is turned, in radians: leaned back (`tilt`, top away), then turned (`turn`, right side away). */
export interface PageTurn {
  tilt: number;
  turn: number;
}

/** The pivot the page turns about (text-box px) and how far in front of it the camera is (px). */
export interface PageCamera {
  x: number;
  y: number;
  distance: number;
}

/**
 * Where a point on the page — (`x`, `y`) text-box px, `z` px off the page —
 * lands on the canvas once the page is turned and seen in perspective, in
 * text-box px. The camera looks straight at the pivot, so an unturned page
 * (z = 0) lands exactly where the canvas lays it out; the rest moves by the
 * turn and grows as it comes nearer. Three's camera ({@link fitCamera}) sees
 * the same.
 */
export function projectPoint(x: number, y: number, z: number, turn: PageTurn, cam: PageCamera): { x: number; y: number } {
  // About the pivot, y up.
  const px = x - cam.x;
  const py = cam.y - y;
  // Leaned back about x, then turned about y (a YXZ Euler: X first).
  const ct = Math.cos(-turn.tilt);
  const st = Math.sin(-turn.tilt);
  const y1 = py * ct - z * st;
  const z1 = py * st + z * ct;
  const cr = Math.cos(turn.turn);
  const sr = Math.sin(turn.turn);
  const x2 = px * cr + z1 * sr;
  const z2 = -px * sr + z1 * cr;
  const k = cam.distance / Math.max(cam.distance * 0.05, cam.distance - z2);
  return { x: cam.x + x2 * k, y: cam.y - y1 * k };
}

/**
 * The box the ink can reach on the canvas: the corners of `box` from the
 * page up to `height` px off it, turned each way in `turns` and projected,
 * and the shadows they cast on the page along `toLight` (page x, y up, z).
 */
export function reachBox(
  box: Box,
  height: number,
  turns: readonly PageTurn[],
  cam: PageCamera,
  toLight: readonly [number, number, number],
): Box {
  const out = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (p: { x: number; y: number }) => {
    out.minX = Math.min(out.minX, p.x);
    out.minY = Math.min(out.minY, p.y);
    out.maxX = Math.max(out.maxX, p.x);
    out.maxY = Math.max(out.maxY, p.y);
  };
  // A point `height` up casts its shadow this far along the page (y down).
  const sx = (-toLight[0] / toLight[2]) * height;
  const sy = (toLight[1] / toLight[2]) * height;
  for (const turn of turns) {
    for (const x of [box.minX, box.maxX]) {
      for (const y of [box.minY, box.maxY]) {
        add(projectPoint(x, y, 0, turn, cam));
        add(projectPoint(x, y, height, turn, cam));
        add(projectPoint(x + sx, y + sy, 0, turn, cam));
      }
    }
  }
  return out;
}

/** The canvas the ink is drawn on: its size and how text-box px map to its pixels (`ctx.getTransform()`: scale `k`, offset `e`, `f`). */
export interface CanvasView {
  width: number;
  height: number;
  k: number;
  e: number;
  f: number;
}

/** A stretch of the canvas, in its pixels. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Three's camera for {@link projectPoint}'s: at the pivot, `distance` px in
 * front of the page, looking straight at it, its view the canvas's size
 * centred on the pivot's pixel — and of that, only `region` rendered.
 */
export function fitCamera(camera: PerspectiveCamera, view: CanvasView, cam: PageCamera, region: Region): void {
  const h = view.height / view.k;
  camera.fov = (2 * Math.atan(h / 2 / cam.distance) * 180) / Math.PI;
  camera.aspect = view.width / view.height;
  camera.near = cam.distance / 20;
  camera.far = cam.distance * 4;
  camera.position.set(cam.x, -cam.y, cam.distance);
  camera.lookAt(cam.x, -cam.y, 0);
  // The full view is the canvas's size centred on the pivot; the region is a window of it.
  const left = cam.x * view.k + view.e - view.width / 2;
  const top = cam.y * view.k + view.f - view.height / 2;
  camera.setViewOffset(view.width, view.height, region.x - left, region.y - top, region.w, region.h);
}

// ---------------------------------------------------------------------------
// One WebGL renderer for every instance
// ---------------------------------------------------------------------------

interface Gl {
  renderer: WebGLRenderer;
  environment: Texture;
}

// Browsers keep only a few WebGL contexts alive at once, so every instance —
// every renderer on the page with the plugin on — draws with this one, each
// its own scene, and copies the picture onto its own canvas.
let shared: Gl | null | undefined;

function gl(): Gl | null {
  if (shared !== undefined) return shared;
  try {
    const renderer = new WebGLRenderer({
      canvas: document.createElement('canvas'),
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.outputColorSpace = SRGBColorSpace;
    const pmrem = new PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    shared = { renderer, environment };
  } catch {
    shared = null;
  }
  return shared;
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

const MATERIALS = {
  gloss: () => new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
  satin: () => new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
  metal: () => new MeshStandardMaterial({ vertexColors: true, metalness: 1, roughness: 0.26 }),
  clay: () => new MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
};
type MaterialName = keyof typeof MATERIALS;

const RAD = Math.PI / 180;
/** Drawings in a sway, 30 a second: one swing there and back every 8 seconds. */
const SWAY_STEPS = 240;

/**
 * The ink as tubes in 3D, lit and shaded, on a page you can tilt and turn —
 * drawn with Three.js inside the renderer's own canvas, so the plugins after
 * it (a shadow, grain, a cathode tube) treat it as the ink. `paint` keeps
 * each stroke's color and draws nothing flat; the `ink` hook builds a tube
 * per stroke (the finished ones once, the one being written each frame, up
 * to the pen), renders the scene with a camera that sees the untilted page
 * pixel for pixel, and lays the picture on the canvas. The `geometry` hook
 * gives the points a height off the page, on `PathPoint.data`, so the text
 * can ride a wave or an arch; the sway runs on `steps` (paint-only: the
 * strokes aren't placed again per step) with `idle` so it keeps swinging.
 */
export const ink3dPlugin = createPlugin({
  name: 'ink3d',
  label: '3D ink',
  description:
    'The ink as lit tubes in 3D on a page you can tilt and turn, rendered with Three.js inside the canvas. geometry (depth on point data) + paint + ink + steps.',
  params: {
    tilt: {
      type: 'number',
      label: 'Tilt',
      description: 'How far the page leans back, in degrees.',
      default: 28,
      min: -70,
      max: 70,
      step: 1,
    },
    turn: {
      type: 'number',
      label: 'Turn',
      description: 'How far the page turns, in degrees (right side away).',
      default: -16,
      min: -70,
      max: 70,
      step: 1,
    },
    sway: {
      type: 'number',
      label: 'Sway',
      description: 'How far the page swings back and forth, in degrees.',
      default: 0,
      min: 0,
      max: 45,
      step: 1,
    },
    material: {
      type: 'select',
      label: 'Material',
      default: 'gloss',
      options: [
        { value: 'gloss', label: 'Gloss' },
        { value: 'satin', label: 'Satin' },
        { value: 'metal', label: 'Metal' },
        { value: 'clay', label: 'Clay' },
      ],
    },
    thickness: {
      type: 'number',
      label: 'Thickness',
      description: 'The tube’s width over the pen’s.',
      default: 1.15,
      min: 0.4,
      max: 2.5,
      step: 0.05,
    },
    depth: {
      type: 'number',
      label: 'Depth',
      description: 'How tall the tube stands over how wide it is.',
      default: 0.8,
      min: 0.1,
      max: 1.5,
      step: 0.05,
    },
    lift: {
      type: 'number',
      label: 'Lift',
      description: 'How far over the page the ink floats, in ems.',
      default: 0.04,
      min: 0,
      max: 0.6,
      step: 0.01,
    },
    surface: {
      type: 'select',
      label: 'Surface',
      description: 'What the text rides on, off the page.',
      default: 'flat',
      options: [
        { value: 'flat', label: 'Flat' },
        { value: 'wave', label: 'Wave' },
        { value: 'arch', label: 'Arch' },
      ],
    },
    rise: {
      type: 'number',
      label: 'Rise',
      description: 'How high the wave or arch rises, in ems.',
      default: 0.4,
      min: 0,
      max: 2,
      step: 0.05,
    },
    shadow: {
      type: 'number',
      label: 'Shadow',
      description: 'How dark the shadow the ink casts on the page is.',
      default: 0.3,
      min: 0,
      max: 1,
      step: 0.05,
    },
    light: {
      type: 'number',
      label: 'Light',
      description: 'Where the light comes from, in degrees round the page (90 is above).',
      default: 125,
      min: 0,
      max: 360,
      step: 5,
    },
    own: { type: 'boolean', label: 'Own color', description: 'Its color rather than the ink’s.', default: false },
    color: { type: 'color', label: 'Color', default: '#d4a640' },
  },
  presets: {
    Gold: { material: 'metal', own: true, color: '#d9a740', depth: 0.9, lift: 0.02 },
    Balloon: { material: 'gloss', own: true, color: '#ff4f7b', thickness: 2, depth: 1, lift: 0.3, tilt: 20, turn: -22, shadow: 0.25 },
    Clay: { material: 'clay', own: true, color: '#e7835c', thickness: 1.5, depth: 0.7, tilt: 38, turn: 0 },
    Ribbon: { surface: 'wave', rise: 0.6, lift: 0.1, tilt: 50, turn: -10, sway: 18, depth: 0.35, thickness: 1.3 },
    Arch: { surface: 'arch', rise: 1.2, tilt: 58, turn: 0, lift: 0.05 },
  },
  setup: ({ tilt, turn, sway, material, thickness, depth, lift, surface, rise, shadow, light, own, color }) => {
    const scene = new Scene();
    const camera = new PerspectiveCamera();
    const page = new Group();
    const content = new Group();
    const sun = new DirectionalLight(0xffffff, 1.6);
    const floor = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: shadow }));
    sun.castShadow = shadow > 0;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.radius = 3;
    sun.shadow.normalBias = 0.5;
    floor.receiveShadow = true;
    floor.visible = shadow > 0;
    page.add(content, sun, sun.target, floor);
    scene.add(page);
    const inkMaterial: Material = MATERIALS[material as MaterialName]();

    // The tube of every finished stroke, by its path (the same object until
    // the layout changes), with the colors it was built in and the render it
    // was last drawn in.
    const tubes = new Map<StrokePath, { mesh: Mesh; key: string; used: number }>();
    let renders = 0;
    // Each stroke's style, as `paint` saw it this frame.
    const styles = new Map<string, InkStyle>();
    // No hook tells a plugin it's been dropped, so a dropped instance's tubes
    // are let go of once it's collected — `styles` lives as long as its hooks.
    finalizer.register(styles, tubes);
    let colorCtx: CanvasRenderingContext2D | null = null;
    const parsed = new Map<string, readonly [number, number, number]>();
    const shape: TubeShape = { thickness, depth, lift: 0, radial: 14, caps: 5 };
    const toLight = [Math.cos(light * RAD), Math.sin(light * RAD), 1.4] as const;
    const turnAt = (step: number): PageTurn => ({
      tilt: tilt * RAD,
      turn: (turn + sway * Math.sin((2 * Math.PI * step) / SWAY_STEPS)) * RAD,
    });
    // The sway's extremes and the way there, for the box the canvas must hold.
    const turns = sway > 0 ? [-1, -0.5, 0, 0.5, 1].map((f) => ({ tilt: tilt * RAD, turn: (turn + sway * f) * RAD })) : [turnAt(0)];

    /**
     * The page the strokes lie on: the pivot (the middle of all the ink, drawn
     * or not, so it holds still while the text writes), the camera's distance
     * (far enough that the perspective is gentle) and the box the turned ink
     * and its shadow can reach — the same every frame of a layout.
     */
    const layout = (strokes: readonly { path: StrokePath }[], fontSize: number) => {
      const box = unionBoxes(strokes.map((s) => s.path.bounds()));
      if (!box) return null;
      let widest = 0;
      for (const s of strokes) for (const p of s.path.points) widest = Math.max(widest, p.width);
      let highest = 0;
      for (const s of strokes) for (const p of s.path.points) highest = Math.max(highest, p.data?.[DEPTH_KEY] ?? 0);
      const cam: PageCamera = {
        x: (box.minX + box.maxX) / 2,
        y: (box.minY + box.maxY) / 2,
        distance: 2.5 * Math.max(box.maxX - box.minX, box.maxY - box.minY, fontSize * 4),
      };
      const height = lift * fontSize + highest + widest * thickness * Math.max(0.05, depth);
      return { cam, reach: expandBox(reachBox(box, height, turns, cam, toLight), widest * thickness) };
    };

    /** A CSS color as linear RGB, read back through a canvas (which knows every CSS color). */
    const linear = (css: string): readonly [number, number, number] => {
      let rgb = parsed.get(css);
      if (!rgb) {
        const c = (colorCtx && canvasColor(colorCtx, css)) ?? [0, 0, 0, 1];
        const lin = new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace);
        rgb = [lin.r, lin.g, lin.b];
        parsed.set(css, rgb);
      }
      return rgb;
    };
    const colorOf = (style: InkStyle | undefined, ink: string): ((t: number) => readonly [number, number, number]) => {
      if (own) return () => linear(color);
      if (typeof style === 'function') return (t) => linear(style(t));
      const css = typeof style === 'string' ? style : ink;
      return () => linear(css);
    };
    const colorKey = (style: InkStyle | undefined, ink: string) =>
      own ? color : typeof style === 'function' ? `${style(0)}|${style(0.5)}|${style(1)}` : typeof style === 'string' ? style : ink;

    const build = (
      points: readonly PathPoint[],
      origin: { x: number; y: number },
      colorAt: (t: number) => readonly [number, number, number],
    ) => {
      const m = tubeMesh(points, origin, shape, colorAt);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(m.positions, 3));
      geometry.setAttribute('normal', new BufferAttribute(m.normals, 3));
      geometry.setAttribute('color', new BufferAttribute(m.colors, 3));
      geometry.setIndex(new BufferAttribute(m.indices, 1));
      const mesh = new Mesh(geometry, inkMaterial);
      mesh.castShadow = shadow > 0;
      return mesh;
    };

    return {
      steps: sway > 0 ? { count: SWAY_STEPS, fps: 30, idle: true, paintOnly: true } : undefined,
      bounds: ({ strokes, fontSize }) => layout(strokes, fontSize)?.reach ?? null,
      geometry(path, g) {
        if (surface === 'flat' || rise === 0) return path;
        const { minX, maxX } = g.textBox;
        const width = Math.max(1, maxX - minX);
        const height = rise * g.fontSize;
        const z =
          surface === 'wave'
            ? (x: number) => height * 0.5 * (1 + Math.sin(((x - minX) / (g.fontSize * 3)) * 2 * Math.PI))
            : (x: number) => height * (1 - ((2 * (x - minX)) / width - 1) ** 2);
        return path.map((p) => ({ ...p, data: { ...p.data, [DEPTH_KEY]: (p.data?.[DEPTH_KEY] ?? 0) + z(p.x) } }));
      },
      paint(s, next) {
        // Without WebGL, the ink stays flat.
        if (!gl()) return next(s);
        styles.set(s.stroke.id, s.style);
      },
      ink({ ctx, frame, fontSize, color: ink, step }) {
        const g = gl();
        const page3d = g && layout(frame.strokes, fontSize);
        if (!g || !page3d) return;
        const { cam } = page3d;
        colorCtx ??= document.createElement('canvas').getContext('2d');
        renders++;

        // The page: pivoting about the ink's middle, turned, the light fixed to it.
        const at = turnAt(step);
        page.position.set(cam.x, -cam.y, 0);
        page.rotation.set(-at.tilt, at.turn, 0, 'YXZ');
        const span = cam.distance / 2.5;
        sun.position.set(toLight[0] * span, toLight[1] * span, toLight[2] * span);
        sun.target.position.set(0, 0, 0);
        const shadowCam = sun.shadow.camera;
        shadowCam.left = -span;
        shadowCam.right = span;
        shadowCam.top = span;
        shadowCam.bottom = -span;
        shadowCam.near = 0.1;
        shadowCam.far = span * 4;
        shadowCam.updateProjectionMatrix();
        floor.scale.set(span * 3, span * 3, 1);
        scene.environment = g.environment;
        shape.lift = lift * fontSize;

        // The strokes: finished ones from the cache, the one being written up to the pen.
        content.clear();
        const fresh: Mesh[] = [];
        for (const s of frame.strokes) {
          if (s.state === 'pending') continue;
          const style = styles.get(s.id);
          const colorAt = colorOf(style, ink);
          if (s.state === 'drawing') {
            const mesh = build(s.path.slice(0, s.progress).points, cam, (t) => colorAt(t * s.progress));
            fresh.push(mesh);
            content.add(mesh);
            continue;
          }
          const key = colorKey(style, ink);
          let tube = tubes.get(s.path);
          if (tube && tube.key !== key) {
            tube.mesh.geometry.dispose();
            tube = undefined;
          }
          if (!tube) tubes.set(s.path, (tube = { mesh: build(s.path.points, cam, colorAt), key, used: renders }));
          tube.used = renders;
          content.add(tube.mesh);
        }
        // Tubes of a layout that's gone (their paths no longer drawn) go too.
        for (const [path, tube] of tubes) {
          if (renders - tube.used > 120) {
            tube.mesh.geometry.dispose();
            tubes.delete(path);
          }
        }

        // Only the stretch of the canvas the turned ink can reach is rendered.
        const m = ctx.getTransform();
        const view: CanvasView = { width: ctx.canvas.width, height: ctx.canvas.height, k: m.a, e: m.e, f: m.f };
        const x0 = Math.max(0, Math.floor(m.a * page3d.reach.minX + m.e));
        const y0 = Math.max(0, Math.floor(m.d * page3d.reach.minY + m.f));
        const x1 = Math.min(view.width, Math.ceil(m.a * page3d.reach.maxX + m.e));
        const y1 = Math.min(view.height, Math.ceil(m.d * page3d.reach.maxY + m.f));
        if (x1 <= x0 || y1 <= y0) return;
        const region: Region = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        fitCamera(camera, view, cam, region);
        const r = g.renderer;
        r.toneMapping = material === 'metal' ? ACESFilmicToneMapping : NeutralToneMapping;
        r.setSize(region.w, region.h, false);
        r.render(scene, camera);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(r.domElement, region.x, region.y);
        for (const mesh of fresh) mesh.geometry.dispose();
        // Nothing left in the scene keeps the tubes, so the finalizer can let them go.
        content.clear();
      },
    };
  },
});

const finalizer = new FinalizationRegistry<Map<StrokePath, { mesh: Mesh }>>((tubes) => {
  for (const { mesh } of tubes.values()) mesh.geometry.dispose();
});
