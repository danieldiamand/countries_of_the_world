import type { Country } from '../data/countries';
import type { GuessResult } from './types';

/**
 * Strip accents/diacritics and lowercase a string.
 */
export function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Levenshtein distance (no external dep).
 */
export function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[][] = [];
  for (let i = 0; i <= an; i++) matrix[i] = [i];
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[an][bn];
}

function getThreshold(name: string): number {
  if (name.length <= 4) return 1;
  if (name.length <= 8) return 2;
  return 3;
}

/**
 * Check a guess against a single country's accepted names.
 */
export function checkGuess(input: string, country: Country): GuessResult {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return { status: 'incorrect' };

  const acceptedList = country.acceptedNames;

  // Exact match
  for (const accepted of acceptedList) {
    if (normalize(accepted) === normalizedInput) {
      return { status: 'correct', country };
    }
  }

  // Near-miss
  let bestDistance = Infinity;
  let bestSuggestion = '';
  for (const accepted of acceptedList) {
    const dist = levenshtein(normalizedInput, normalize(accepted));
    if (dist < bestDistance) {
      bestDistance = dist;
      bestSuggestion = country.name;
    }
  }

  const threshold = getThreshold(bestSuggestion);
  if (bestDistance <= threshold) {
    return {
      status: 'near-miss',
      country,
      suggestion: bestSuggestion,
      distance: bestDistance,
    };
  }

  return { status: 'incorrect' };
}

/**
 * Free-Type matching: there is no pre-selected country, so the input is checked
 * against a whole set of candidates at once.
 *
 * - Exact match on any candidate → 'correct' for that country.
 * - Otherwise, gather near-miss candidates within their per-name threshold. A
 *   near-miss is only surfaced when EXACTLY ONE country qualifies — if two
 *   countries have similar names we must not reveal which one the player meant,
 *   so an ambiguous fuzzy match is reported as 'incorrect' (with `ambiguous`).
 */
export function findFreeMatch(
  input: string,
  candidates: Country[],
): GuessResult & { ambiguous?: boolean } {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return { status: 'incorrect' };

  // Exact match first.
  for (const country of candidates) {
    for (const accepted of country.acceptedNames) {
      if (normalize(accepted) === normalizedInput) {
        return { status: 'correct', country };
      }
    }
  }

  // Collect near-miss candidates.
  const nearMisses: { country: Country; distance: number }[] = [];
  for (const country of candidates) {
    let best = Infinity;
    for (const accepted of country.acceptedNames) {
      const dist = levenshtein(normalizedInput, normalize(accepted));
      if (dist < best) best = dist;
    }
    if (best <= getThreshold(country.name)) {
      nearMisses.push({ country, distance: best });
    }
  }

  if (nearMisses.length === 1) {
    const { country, distance } = nearMisses[0];
    return { status: 'near-miss', country, suggestion: country.name, distance };
  }

  // Zero or ambiguous (>1) — don't reveal anything.
  return { status: 'incorrect', ambiguous: nearMisses.length > 1 };
}
