// Trial-merge scoring for continuation matching.
//
// Continuation pairing ranks candidate joins from PER-PARTITION end data —
// tangents, widths, cut midpoints — all measured on each segment's own
// skeleton. But an end tangent is read exactly at a cut mouth, the one place
// a per-face skeleton is least trustworthy (bisector vertices crowd the
// mouth, ports cap the width). The trial join instead acts as if the join
// already happened: merge the two candidate segments' member faces with the
// junction faces between them, build the straight skeleton of that union,
// and measure how straight its spine flows through the junction. The merged
// shape is the ground truth the end-tangent heuristic approximates.
//
// This is deliberately a SCORER, not a geometry producer: stroke identity is
// still decided by matchContinuations' gate + greedy selection, and the final
// axis is still rebuilt later by refineStrokesThroughJunctions. Any failure
// (merge rejected, wasm rejection, anchor mismatch) returns null and the
// tangent-based score stands.

import { mergeSegmentFaces } from './face-merge.ts';
import { straightSkeletonJoinAlignment } from './face-straight-skeleton.ts';
import type { Face, JunctionInfo, ResolvedGeometryOptions, SegmentInfo } from './types.ts';

/**
 * Alignment (cos of through-bend, 1 = perfectly straight) of the candidate
 * join between two segment ends, measured on the straight skeleton of their
 * merged region. Returns null whenever the trial cannot be run honestly —
 * loop segments, unknown member faces, a merge the edge-cancellation rejects,
 * or a skeleton build/anchor failure.
 */
export function trialJoinAlignment(
  segments: SegmentInfo[],
  a: { segmentIndex: number; endIndex: number },
  b: { segmentIndex: number; endIndex: number },
  junction: JunctionInfo,
  faceById: Map<number, Face>,
  segmentMemberFaces: Map<number, number[]>,
  options: ResolvedGeometryOptions,
): number | null {
  const segA = segments[a.segmentIndex];
  const segB = segments[b.segmentIndex];
  if (!segA || !segB || segA.isLoop || segB.isLoop) return null;
  const endA = segA.ends[a.endIndex];
  const endB = segB.ends[b.endIndex];
  if (!endA || !endB || segA.axis.length < 2 || segB.axis.length < 2) return null;
  const memberA = segmentMemberFaces.get(a.segmentIndex);
  const memberB = segmentMemberFaces.get(b.segmentIndex);
  if (!memberA || !memberB) return null;

  const ids = new Set<number>([...memberA, ...memberB, ...junction.faceIds]);
  if (ids.size < 2) return null;
  const group: Face[] = [];
  for (const id of ids) {
    const face = faceById.get(id);
    if (!face) return null;
    group.push(face);
  }
  const merged = mergeSegmentFaces(group);
  if (!merged) return null;

  // Anchor the trial spine at the two FAR endpoints so the path crosses the
  // junction with each arm's full approach direction in view.
  const farA = a.endIndex === 0 ? segA.axis[segA.axis.length - 1]! : segA.axis[0]!;
  const farB = b.endIndex === 0 ? segB.axis[segB.axis.length - 1]! : segB.axis[0]!;
  return straightSkeletonJoinAlignment(merged, options, [endA, endB], [farA, farB]);
}
