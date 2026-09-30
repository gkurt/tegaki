// Stage 4 of the pipeline — see commands/generate.ts.
// Skeletonization: reduce a filled bitmap to its 1-pixel-wide medial axis,
// then trace it into ordered centerline polylines. This module's `skeletonize`
// function is the stage entry point; it dispatches between the voronoi-based
// medial axis (which produces polylines directly from the outline) and the
// classical thinning path (Zhang-Suen / Guo-Hall / Lee / morphological /
// distance-ordered) followed by junction cleanup, component restoration and
// `traceAndSimplify`.

import type { BBox, Point } from 'tegaki/internal';
import type { SkeletonMethod } from '../../constants.ts';
import type { RasterResult } from '../rasterize.ts';
import { traceAndSimplify } from '../trace.ts';
import { voronoiMedialAxis } from '../voronoi-medial-axis.ts';
import { cleanJunctionClusters, restoreErasedComponents, type ThinFn } from './cleanup.ts';
import { guoHallThin } from './guo-hall.ts';
import { leeThin } from './lee.ts';
import { medialAxisThin } from './medial-axis.ts';
import { morphologicalThin } from './morphological.ts';
import { zhangSuenThin } from './zhang-suen.ts';

export interface SkeletonizeOptions {
  skeletonMethod: SkeletonMethod;
  rdpTolerance: number;
  spurLengthRatio: number;
  traceLookback: number;
  curvatureBias: number;
  thinMaxIterations: number;
  junctionCleanupIterations: number;
  voronoiSamplingInterval: number;
}

export interface SkeletonizeInput {
  subPaths: Point[][];
  pathBBox: BBox;
  raster: RasterResult;
  inverseDT: Float32Array;
  options: SkeletonizeOptions;
  /** Right-to-left script hint; flips the trace entry side for Arabic/Hebrew/… */
  rtl?: boolean;
}

export interface SkeletonizeResult {
  /** 1-pixel skeleton bitmap. Synthesized from polylines for the voronoi path (debug viz only). */
  skeleton: Uint8Array;
  /** Centerline polylines in bitmap-space coordinates. */
  polylines: Point[][];
  /** Per-point widths set only by the voronoi path; thinning derives width from inverseDT downstream. */
  widths?: number[][];
}

/**
 * Stage 4 entry point: turn a rasterized glyph into ordered centerline polylines.
 *
 * Two approaches share the same input/output shape:
 * - voronoi: samples the outline, builds a Voronoi medial axis, returns polylines + widths
 * - thinning (default): runs the chosen thinning algorithm, cleans junction clusters,
 *   restores fully-erased components, and traces the resulting skeleton into polylines
 */
export function skeletonize({ subPaths, pathBBox, raster, inverseDT, options, rtl = false }: SkeletonizeInput): SkeletonizeResult {
  if (options.skeletonMethod === 'voronoi') {
    const v = voronoiMedialAxis(subPaths, pathBBox, raster.transform, raster.width, raster.height, options.voronoiSamplingInterval);
    // Synthesize a skeleton bitmap from polylines so debug visualization stays uniform across methods.
    const skeleton = new Uint8Array(raster.width * raster.height);
    for (const pl of v.polylines) {
      for (const p of pl) {
        const px = Math.round(p.x);
        const py = Math.round(p.y);
        if (px >= 0 && px < raster.width && py >= 0 && py < raster.height) {
          skeleton[py * raster.width + px] = 1;
        }
      }
    }
    return { skeleton, polylines: v.polylines, widths: v.widths };
  }

  const thinFns: Record<string, ThinFn> = {
    'zhang-suen': zhangSuenThin,
    'guo-hall': guoHallThin,
    lee: leeThin,
    thin: (bmp, w, h) => morphologicalThin(bmp, w, h, options.thinMaxIterations),
  };
  const thinFn = thinFns[options.skeletonMethod] ?? zhangSuenThin;

  let skeleton: Uint8Array;
  if (options.skeletonMethod === 'medial-axis') {
    skeleton = medialAxisThin(raster.bitmap, inverseDT, raster.width, raster.height);
  } else {
    const raw = thinFn(raster.bitmap, raster.width, raster.height);
    skeleton = cleanJunctionClusters(raw, inverseDT, raster.width, raster.height, thinFn, options.junctionCleanupIterations);
  }
  restoreErasedComponents(raster.bitmap, skeleton, inverseDT, raster.width, raster.height);

  const spurMinLength = Math.min(Math.round(Math.max(raster.width, raster.height) * options.spurLengthRatio), 10);
  const polylines = traceAndSimplify(
    skeleton,
    raster.width,
    raster.height,
    options.rdpTolerance,
    spurMinLength,
    options.traceLookback,
    options.curvatureBias,
    rtl,
  );
  return { skeleton, polylines };
}
