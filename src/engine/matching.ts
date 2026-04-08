import type { Country } from '../data/countries';
import type { GuessResult } from './types';

/**
 * Strip accents/diacritics and lowercase a string.
 * "Côte d'Ivoire" → "cote d'ivoire", "España" → "espana"
 */
export function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Simple Levenshtein distance (no external dep needed for this size).
 */
export function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[][] = [];
  for (let i = 0; i <= an; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bn; j++) {
    matrix[0][j] = j;
  }
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

/**
 * Get the max edit distance threshold for a given word length.
 */
function getThreshold(name: string): number {
  if (name.length <= 4) return 1;
  if (name.length <= 8) return 2;
  return 3;
}

/**
 * Check a guess against a country's accepted names (or capitals for mode 5).
 */
export function checkGuess(
  input: string,
  country: Country,
  useCapitals: boolean
): GuessResult {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return { status: 'incorrect' };

  const acceptedList = useCapitals
    ? country.acceptedCapitals
    : country.acceptedNames;

  // Exact match against any accepted variant
  for (const accepted of acceptedList) {
    if (normalize(accepted) === normalizedInput) {
      return { status: 'correct', country };
    }
  }

  // Near-miss: check Levenshtein distance against all variants
  let bestDistance = Infinity;
  let bestSuggestion = '';
  for (const accepted of acceptedList) {
    const normalAccepted = normalize(accepted);
    const dist = levenshtein(normalizedInput, normalAccepted);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestSuggestion = useCapitals ? country.capital : country.name;
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
 * For Mode 2 (free type): check guess against ALL unguessed countries.
 * Returns the best match.
 */
export function checkGuessAgainstAll(
  input: string,
  countries: Country[],
  useCapitals: boolean
): GuessResult {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return { status: 'incorrect' };

  // First pass: exact matches
  for (const country of countries) {
    const acceptedList = useCapitals
      ? country.acceptedCapitals
      : country.acceptedNames;
    for (const accepted of acceptedList) {
      if (normalize(accepted) === normalizedInput) {
        return { status: 'correct', country };
      }
    }
  }

  // Second pass: near-misses
  let bestDistance = Infinity;
  let bestCountry: Country | undefined;
  for (const country of countries) {
    const acceptedList = useCapitals
      ? country.acceptedCapitals
      : country.acceptedNames;
    for (const accepted of acceptedList) {
      const dist = levenshtein(normalizedInput, normalize(accepted));
      if (dist < bestDistance) {
        bestDistance = dist;
        bestCountry = country;
      }
    }
  }

  if (bestCountry) {
    const threshold = getThreshold(
      useCapitals ? bestCountry.capital : bestCountry.name
    );
    if (bestDistance <= threshold) {
      return {
        status: 'near-miss',
        country: bestCountry,
        suggestion: useCapitals ? bestCountry.capital : bestCountry.name,
        distance: bestDistance,
      };
    }
  }

  return { status: 'incorrect' };
}
