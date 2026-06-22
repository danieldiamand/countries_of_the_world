/** Shared constants — adapted for orthographic globe. */

export const IS_MOBILE =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 0 && window.innerWidth < 1024);

/** Continent lon/lat centers for globe rotation targets. */
export const CONTINENT_CENTERS: Record<string, [number, number]> = {
  'Africa': [20, 0],
  'Asia': [90, 30],
  'Europe': [15, 52],
  'North America': [-95, 40],
  'South America': [-60, -15],
  'Oceania': [140, -25],
};

/** Continent zoom scales for the orthographic globe (base scale = globe fills viewport). */
export const CONTINENT_SCALES: Record<string, number> = {
  'Africa': 1.8,
  'Asia': 1.7,
  'Europe': 2.8,
  'North America': 1.9,
  'South America': 1.9,
  'Oceania': 2.2,
};

/**
 * Zoom tiers for flyTo — how far to zoom in when selecting a country.
 * Values are multipliers on the base globe scale.
 */
export const ZOOM_TIERS: Record<string, number> = {
  MASSIVE: 1.5,   // Russia, Canada
  BIG: 2.0,       // USA, China, Brazil, Australia
  VERY_BIG: 2.5,  // India, Argentina, Kazakhstan
  STANDARD: 3.0,  // ~160 countries
  TINY: 5.0,      // micro-states
};

/** Country ID → zoom tier override (everything else = STANDARD). */
export const COUNTRY_ZOOM_TIER: Record<string, number> = {
  '643': ZOOM_TIERS.MASSIVE,  // Russia
  '124': ZOOM_TIERS.MASSIVE,  // Canada
  '840': ZOOM_TIERS.BIG,      // USA
  '156': ZOOM_TIERS.BIG,      // China
  '076': ZOOM_TIERS.BIG,      // Brazil
  '036': ZOOM_TIERS.BIG,      // Australia
  '356': ZOOM_TIERS.VERY_BIG, // India
  '032': ZOOM_TIERS.VERY_BIG, // Argentina
  '398': ZOOM_TIERS.VERY_BIG, // Kazakhstan
  '010': ZOOM_TIERS.VERY_BIG, // Antarctica
};

/** Centroid overrides [lon, lat] for countries with misleading geographic centers. */
export const CENTROID_OVERRIDES: Record<string, [number, number]> = {
  '250': [2.5, 46.5],     // France (metropolitan)
  '840': [-98, 39],        // USA (contiguous)
  '643': [90, 62],         // Russia
  '124': [-96, 56],        // Canada
  '528': [5.3, 52.1],      // Netherlands
  '156': [104, 35],        // China
  '554': [173, -41],       // New Zealand
  '242': [178, -17.8],     // Fiji
  '036': [134, -25],       // Australia
};

// Countries too small to have visible polygons — need dot markers.
export const MARKER_IDS_DESKTOP = new Set([
  '336',  // Vatican City
  '492',  // Monaco
  '520',  // Nauru
  '798',  // Tuvalu
  '674',  // San Marino
  '438',  // Liechtenstein
  '584',  // Marshall Islands
  '659',  // Saint Kitts and Nevis
  '462',  // Maldives
  '470',  // Malta
  '308',  // Grenada
  '670',  // Saint Vincent and the Grenadines
  '052',  // Barbados
  '028',  // Antigua and Barbuda
  '585',  // Palau
  '690',  // Seychelles
  '662',  // Saint Lucia
  '583',  // Micronesia
  '702',  // Singapore
  '776',  // Tonga
  '212',  // Dominica
  '048',  // Bahrain
  '296',  // Kiribati
  '678',  // São Tomé and Príncipe
]);

export const MARKER_IDS_MOBILE = new Set([
  ...MARKER_IDS_DESKTOP,
  '020',  // Andorra
  '174',  // Comoros
  '882',  // Samoa
  '132',  // Cabo Verde
  '480',  // Mauritius
  '096',  // Brunei
  '780',  // Trinidad and Tobago
  '270',  // Gambia
  '442',  // Luxembourg
  '626',  // Timor-Leste
  '090',  // Solomon Islands
  '548',  // Vanuatu
]);

export const MARKER_IDS = IS_MOBILE ? MARKER_IDS_MOBILE : MARKER_IDS_DESKTOP;

/** Tiny countries that get the TINY zoom tier. */
const TINY_IDS = new Set([
  ...MARKER_IDS_DESKTOP,
  '020', '174', '882', '132', '480', '096', '780', '270', '442', '626',
]);

/** Get the flyTo zoom tier for a country ID. */
export function getZoomTier(id: string): number {
  if (COUNTRY_ZOOM_TIER[id] !== undefined) return COUNTRY_ZOOM_TIER[id];
  if (TINY_IDS.has(id)) return ZOOM_TIERS.TINY;
  return ZOOM_TIERS.STANDARD;
}
