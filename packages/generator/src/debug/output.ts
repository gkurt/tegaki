import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { LineCap } from 'tegaki';
import type { PipelineResult } from '../commands/generate.ts';
import type { GeometryPipelineResult } from '../geometry/types.ts';
import { type GeometryStage, renderGeometryStage } from '../geometry/visualize.ts';
import { charToFilename, glyphToAnimatedSVG } from '../processing/animated-svg.ts';
import {
  renderBitmap,
  renderCurvature,
  renderDebugAnimation,
  renderDistance,
  renderFlattened,
  renderOutline,
  renderOverlay,
  renderSkeleton,
  renderStrokes,
  renderTraced,
} from '../processing/visualize.ts';

export { charToFilename };

export async function writeDebugOutput(debugDir: string, char: string, result: PipelineResult): Promise<void> {
  const name = charToFilename(char);
  const glyphDir = join(debugDir, name);
  mkdirSync(glyphDir, { recursive: true });

  await Bun.write(join(glyphDir, '1-outline.svg'), renderOutline(result));
  await Bun.write(join(glyphDir, '2-flattened.svg'), renderFlattened(result));
  await Bun.write(join(glyphDir, '3-bitmap.png'), renderBitmap(result));
  await Bun.write(join(glyphDir, '4-skeleton.png'), renderSkeleton(result));
  await Bun.write(join(glyphDir, '5-overlay.png'), renderOverlay(result));
  await Bun.write(join(glyphDir, '6-distance.png'), renderDistance(result));
  await Bun.write(join(glyphDir, '7-traced.svg'), renderTraced(result));
  await Bun.write(join(glyphDir, '8-curvature.svg'), renderCurvature(result));
  await Bun.write(join(glyphDir, '9-strokes.svg'), renderStrokes(result));
  await Bun.write(join(glyphDir, '10-animation.svg'), renderDebugAnimation(result));
}

const GEOMETRY_STAGES: GeometryStage[] = ['contours', 'corners', 'cuts', 'faces', 'segments', 'strokes', 'order', 'reference'];

/** The geometry pipeline's debug files: each Studio stage as an SVG, the animation, and the glyph's warnings. */
export async function writeGeometryDebugOutput(
  debugDir: string,
  char: string,
  result: GeometryPipelineResult,
  lineCap: LineCap,
): Promise<void> {
  const glyphDir = join(debugDir, charToFilename(char));
  mkdirSync(glyphDir, { recursive: true });

  for (const [i, stage] of GEOMETRY_STAGES.entries()) {
    await Bun.write(join(glyphDir, `${i + 1}-${stage}.svg`), renderGeometryStage(result, stage));
  }
  await Bun.write(
    join(glyphDir, `${GEOMETRY_STAGES.length + 1}-animation.svg`),
    glyphToAnimatedSVG(result.strokesFontUnits, result.advanceWidth, result.ascender, result.descender, lineCap),
  );
  if (result.warnings.length > 0) await Bun.write(join(glyphDir, 'warnings.txt'), `${result.warnings.join('\n')}\n`);
}
