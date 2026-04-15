import type { Country } from './countries';

/**
 * Territories: regions that have their own TopoJSON feature but belong
 * to a parent country.  When enabled they appear as separate "countries"
 * in the game pool; when disabled, clicking on them maps to the parent.
 */
export interface Territory extends Country {
  parentId: string;          // parent country's numeric ID
  enabledByDefault: boolean; // shipped-default toggle state
}

export const territories: Territory[] = [
  // ── Enabled by default ────────────────────────────────
  {
    id: '304', alpha2: 'gl', name: 'Greenland',
    acceptedNames: ['greenland'],
    capital: 'Nuuk', acceptedCapitals: ['nuuk', 'godthab'],
    continent: 'North America', parentId: '208', enabledByDefault: true,
  },
  {
    id: '630', alpha2: 'pr', name: 'Puerto Rico',
    acceptedNames: ['puerto rico'],
    capital: 'San Juan', acceptedCapitals: ['san juan'],
    continent: 'North America', parentId: '840', enabledByDefault: true,
  },

  // ── Disabled by default ───────────────────────────────
  {
    id: '344', alpha2: 'hk', name: 'Hong Kong',
    acceptedNames: ['hong kong'],
    capital: 'Hong Kong', acceptedCapitals: ['hong kong'],
    continent: 'Asia', parentId: '156', enabledByDefault: false,
  },
  {
    id: '446', alpha2: 'mo', name: 'Macao',
    acceptedNames: ['macao', 'macau'],
    capital: 'Macao', acceptedCapitals: ['macao', 'macau'],
    continent: 'Asia', parentId: '156', enabledByDefault: false,
  },
  {
    id: '540', alpha2: 'nc', name: 'New Caledonia',
    acceptedNames: ['new caledonia'],
    capital: 'Nouméa', acceptedCapitals: ['noumea', 'nouméa'],
    continent: 'Oceania', parentId: '250', enabledByDefault: false,
  },
  {
    id: '258', alpha2: 'pf', name: 'French Polynesia',
    acceptedNames: ['french polynesia'],
    capital: 'Papeete', acceptedCapitals: ['papeete'],
    continent: 'Oceania', parentId: '250', enabledByDefault: false,
  },
  {
    id: '234', alpha2: 'fo', name: 'Faroe Islands',
    acceptedNames: ['faroe islands', 'faeroe islands', 'faroes'],
    capital: 'Tórshavn', acceptedCapitals: ['torshavn', 'tórshavn'],
    continent: 'Europe', parentId: '208', enabledByDefault: false,
  },
  {
    id: '238', alpha2: 'fk', name: 'Falkland Islands',
    acceptedNames: ['falkland islands', 'falklands', 'malvinas'],
    capital: 'Stanley', acceptedCapitals: ['stanley'],
    continent: 'South America', parentId: '826', enabledByDefault: false,
  },
  {
    id: '732', alpha2: 'eh', name: 'Western Sahara',
    acceptedNames: ['western sahara'],
    capital: 'Laayoune', acceptedCapitals: ['laayoune', 'el aaiun'],
    continent: 'Africa', parentId: '504', enabledByDefault: false,
  },
  {
    id: '533', alpha2: 'aw', name: 'Aruba',
    acceptedNames: ['aruba'],
    capital: 'Oranjestad', acceptedCapitals: ['oranjestad'],
    continent: 'North America', parentId: '528', enabledByDefault: false,
  },
  {
    id: '531', alpha2: 'cw', name: 'Curaçao',
    acceptedNames: ['curacao', 'curaçao'],
    capital: 'Willemstad', acceptedCapitals: ['willemstad'],
    continent: 'North America', parentId: '528', enabledByDefault: false,
  },
  {
    id: '833', alpha2: 'im', name: 'Isle of Man',
    acceptedNames: ['isle of man', 'mann'],
    capital: 'Douglas', acceptedCapitals: ['douglas'],
    continent: 'Europe', parentId: '826', enabledByDefault: false,
  },
];

/** Build a territoryId → parentId map (only for DISABLED territories). */
export function buildTerritoryParentMap(enabledIds: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of territories) {
    if (!enabledIds.has(t.id)) {
      map.set(t.id, t.parentId);
    }
  }
  return map;
}

/** Return territories that are currently enabled. */
export function getEnabledTerritories(enabledIds: Set<string>): Territory[] {
  return territories.filter((t) => enabledIds.has(t.id));
}

/** Default set of enabled territory IDs. */
export function getDefaultEnabledIds(): Set<string> {
  return new Set(territories.filter((t) => t.enabledByDefault).map((t) => t.id));
}

/** Build parentId → territoryId[] map for DISABLED territories. */
export function buildParentToTerritoryMap(enabledIds: Set<string>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of territories) {
    if (!enabledIds.has(t.id)) {
      const arr = map.get(t.parentId) || [];
      arr.push(t.id);
      map.set(t.parentId, arr);
    }
  }
  return map;
}
