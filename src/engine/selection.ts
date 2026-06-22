/**
 * Auto-advance selection with directional inertia.
 * Uses geodesic (great-circle) distance for accurate globe proximity.
 */

import * as d3 from 'd3';
import type { Country } from '../data/countries';

const INERTIA_WEIGHT = 0.15;
const CROSS_CONTINENT_PENALTY = 2.0; // radians — very large

export interface SelectionContext {
  /** Centroid lookup [lon, lat] */
  centroids: Map<string, [number, number]>;
  /** Last N selected country IDs for direction inference */
  selectionHistory: string[];
  /** Skip history to prevent cycling */
  skipHistory: Set<string>;
  /** Override location for distance calc (e.g. territory click point) */
  referenceGeo?: [number, number];
  /** Continent of the current country (for cross-continent penalty) */
  currentContinent?: string;
}

/**
 * Find the next country to auto-select after answering or skipping.
 *
 * @param currentId - The country just answered/skipped
 * @param candidates - Remaining unguessed countries
 * @param ctx - Centroids, history, skip history
 * @returns The best next country, or null if no candidates
 */
export function selectNext(
  currentId: string,
  candidates: Country[],
  ctx: SelectionContext
): Country | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const currentGeo = ctx.referenceGeo ?? ctx.centroids.get(currentId);
  if (!currentGeo) return candidates[0];

  // When using a territory reference point, continent is ambiguous — skip penalty
  const useContinent = !ctx.referenceGeo;
  const currentContinent = useContinent ? (ctx.currentContinent || getContinent(currentId, candidates)) : null;

  // Compute direction vector from last 2 selections (if available)
  let direction: [number, number] | null = null;
  const hist = ctx.selectionHistory;
  if (hist.length >= 2) {
    const prev = ctx.centroids.get(hist[hist.length - 2]);
    const curr = ctx.centroids.get(hist[hist.length - 1]);
    if (prev && curr) {
      direction = [curr[0] - prev[0], curr[1] - prev[1]];
      const mag = Math.sqrt(direction[0] ** 2 + direction[1] ** 2);
      if (mag > 0.001) {
        direction = [direction[0] / mag, direction[1] / mag];
      } else {
        direction = null;
      }
    }
  }

  let bestScore = Infinity;
  let bestCountry: Country | null = null;

  for (const candidate of candidates) {
    // Skip recently skipped countries
    if (ctx.skipHistory.has(candidate.id)) continue;

    const candidateGeo = ctx.centroids.get(candidate.id);
    if (!candidateGeo) continue;

    // Geodesic distance (great circle, in radians)
    const dist = d3.geoDistance(currentGeo, candidateGeo);

    // Direction bonus: reward candidates in the same direction we've been going
    let dirBonus = 0;
    if (direction) {
      const toCandidate: [number, number] = [
        candidateGeo[0] - currentGeo[0],
        candidateGeo[1] - currentGeo[1],
      ];
      const mag = Math.sqrt(toCandidate[0] ** 2 + toCandidate[1] ** 2);
      if (mag > 0.001) {
        const cosAngle = (direction[0] * toCandidate[0] + direction[1] * toCandidate[1]) / mag;
        dirBonus = Math.max(0, cosAngle) * INERTIA_WEIGHT * dist;
      }
    }

    // Continent penalty (skipped when using territory reference geo)
    const penalty = useContinent && candidate.continent !== currentContinent ? CROSS_CONTINENT_PENALTY : 0;

    const score = dist - dirBonus + penalty;
    if (score < bestScore) {
      bestScore = score;
      bestCountry = candidate;
    }
  }

  // If all candidates were in skip history, relax and pick nearest (ignoring skip history)
  if (!bestCountry) {
    for (const candidate of candidates) {
      const candidateGeo = ctx.centroids.get(candidate.id);
      if (!candidateGeo) continue;
      const dist = d3.geoDistance(currentGeo, candidateGeo);
      if (dist < bestScore) {
        bestScore = dist;
        bestCountry = candidate;
      }
    }
  }

  return bestCountry;
}

function getContinent(id: string, candidates: Country[]): string {
  for (const c of candidates) {
    if (c.id === id) return c.continent;
  }
  return '';
}

/**
 * Manage skip history with a sliding window (5-20% of pool size).
 */
export function addToSkipHistory(skipHistory: Set<string>, id: string, poolSize: number): void {
  skipHistory.add(id);
  const maxSize = Math.max(3, Math.min(Math.ceil(poolSize * 0.15), Math.ceil(poolSize * 0.2)));
  if (skipHistory.size > maxSize) {
    // Remove oldest
    const first = skipHistory.values().next().value;
    if (first !== undefined) skipHistory.delete(first);
  }
}
