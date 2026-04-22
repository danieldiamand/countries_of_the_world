/** Shared constants used across the app. Single source of truth. */

export const IS_MOBILE =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);

/** Continent lon/lat centers for gravity, preview, and zoom. */
export const CONTINENT_CENTERS: Record<string, [number, number]> = {
  'Africa': [20, 0],
  'Asia': [90, 30],
  'Europe': [15, 52],
  'North America': [-95, 40],
  'South America': [-60, -15],
  'Oceania': [140, -25],
};

/** Continent zoom regions (center + scale) for map animations. */
export const CONTINENT_REGIONS: Record<string, { center: [number, number]; scale: number }> = {
  'Africa': { center: [20, 2], scale: 1.8 },
  'Asia': { center: [90, 30], scale: 1.7 },
  'Europe': { center: [15, 52], scale: 2.8 },
  'North America': { center: [-95, 40], scale: 1.9 },
  'South America': { center: [-60, -15], scale: 1.9 },
  'Oceania': { center: [140, -25], scale: 2.2 },
};
