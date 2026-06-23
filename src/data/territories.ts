import type { Country } from './countries';

/**
 * Territories: regions that have their own TopoJSON feature but belong
 * to a parent country.  When enabled they appear as separate "countries"
 * in the game pool; when disabled, clicking on them maps to the parent.
 */
export type TerritoryCategory =
  | 'Disputed States'
  | 'US Territories'
  | 'British Territories'
  | 'French Territories'
  | 'Dutch Territories'
  | 'Other Dependencies';

export interface Territory extends Country {
  parentId: string;          // parent country's numeric ID
  enabledByDefault: boolean; // shipped-default toggle state
  category: TerritoryCategory;
}

export const territories: Territory[] = [
  // ── Disputed States ───────────────────────────────────
  {
    id: '_Kosovo', alpha2: 'xk', name: 'Kosovo',
    acceptedNames: ['kosovo'],
    capital: 'Pristina', acceptedCapitals: ['pristina', 'prishtina', 'prishtine'],
    continent: 'Europe', parentId: '688', enabledByDefault: false, category: 'Disputed States',
  },
  {
    id: '_NCyprus', alpha2: 'cy', name: 'Northern Cyprus',
    acceptedNames: ['northern cyprus', 'north cyprus', 'trnc'],
    capital: 'North Nicosia', acceptedCapitals: ['north nicosia', 'lefkosa', 'lefkoşa'],
    continent: 'Asia', parentId: '196', enabledByDefault: false, category: 'Disputed States',
  },
  {
    id: '_Somaliland', alpha2: 'so', name: 'Somaliland',
    acceptedNames: ['somaliland'],
    capital: 'Hargeisa', acceptedCapitals: ['hargeisa', 'hargeysa'],
    continent: 'Africa', parentId: '706', enabledByDefault: false, category: 'Disputed States',
  },
  {
    id: '732', alpha2: 'eh', name: 'Western Sahara',
    acceptedNames: ['western sahara'],
    capital: 'Laayoune', acceptedCapitals: ['laayoune', 'el aaiun'],
    continent: 'Africa', parentId: '504', enabledByDefault: false, category: 'Disputed States',
  },

  // ── US Territories ────────────────────────────────────
  {
    id: '630', alpha2: 'pr', name: 'Puerto Rico',
    acceptedNames: ['puerto rico'],
    capital: 'San Juan', acceptedCapitals: ['san juan'],
    continent: 'North America', parentId: '840', enabledByDefault: true, category: 'US Territories',
  },
  {
    id: '850', alpha2: 'vi', name: 'US Virgin Islands',
    acceptedNames: ['us virgin islands', 'usvi', 'united states virgin islands'],
    capital: 'Charlotte Amalie', acceptedCapitals: ['charlotte amalie'],
    continent: 'North America', parentId: '840', enabledByDefault: false, category: 'US Territories',
  },
  {
    id: '316', alpha2: 'gu', name: 'Guam',
    acceptedNames: ['guam'],
    capital: 'Hagåtña', acceptedCapitals: ['hagatna', 'hagåtña', 'hagatña'],
    continent: 'Oceania', parentId: '840', enabledByDefault: false, category: 'US Territories',
  },
  {
    id: '016', alpha2: 'as', name: 'American Samoa',
    acceptedNames: ['american samoa'],
    capital: 'Pago Pago', acceptedCapitals: ['pago pago'],
    continent: 'Oceania', parentId: '840', enabledByDefault: false, category: 'US Territories',
  },
  {
    id: '580', alpha2: 'mp', name: 'Northern Mariana Islands',
    acceptedNames: ['northern mariana islands', 'northern marianas', 'cnmi'],
    capital: 'Saipan', acceptedCapitals: ['saipan'],
    continent: 'Oceania', parentId: '840', enabledByDefault: false, category: 'US Territories',
  },

  // ── British Territories ───────────────────────────────
  {
    id: '238', alpha2: 'fk', name: 'Falkland Islands',
    acceptedNames: ['falkland islands', 'falklands', 'malvinas'],
    capital: 'Stanley', acceptedCapitals: ['stanley'],
    continent: 'South America', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '833', alpha2: 'im', name: 'Isle of Man',
    acceptedNames: ['isle of man', 'mann'],
    capital: 'Douglas', acceptedCapitals: ['douglas'],
    continent: 'Europe', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '060', alpha2: 'bm', name: 'Bermuda',
    acceptedNames: ['bermuda'],
    capital: 'Hamilton', acceptedCapitals: ['hamilton'],
    continent: 'North America', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '136', alpha2: 'ky', name: 'Cayman Islands',
    acceptedNames: ['cayman islands', 'caymans'],
    capital: 'George Town', acceptedCapitals: ['george town'],
    continent: 'North America', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '092', alpha2: 'vg', name: 'British Virgin Islands',
    acceptedNames: ['british virgin islands', 'bvi'],
    capital: 'Road Town', acceptedCapitals: ['road town'],
    continent: 'North America', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '796', alpha2: 'tc', name: 'Turks and Caicos Islands',
    acceptedNames: ['turks and caicos', 'turks and caicos islands', 'tci'],
    capital: 'Cockburn Town', acceptedCapitals: ['cockburn town'],
    continent: 'North America', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '660', alpha2: 'ai', name: 'Anguilla',
    acceptedNames: ['anguilla'],
    capital: 'The Valley', acceptedCapitals: ['the valley'],
    continent: 'North America', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '500', alpha2: 'ms', name: 'Montserrat',
    acceptedNames: ['montserrat'],
    capital: 'Brades', acceptedCapitals: ['brades', 'plymouth'],
    continent: 'North America', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '654', alpha2: 'sh', name: 'Saint Helena',
    acceptedNames: ['saint helena', 'st helena'],
    capital: 'Jamestown', acceptedCapitals: ['jamestown'],
    continent: 'Africa', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '832', alpha2: 'je', name: 'Jersey',
    acceptedNames: ['jersey'],
    capital: 'Saint Helier', acceptedCapitals: ['saint helier', 'st helier'],
    continent: 'Europe', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },
  {
    id: '831', alpha2: 'gg', name: 'Guernsey',
    acceptedNames: ['guernsey'],
    capital: 'Saint Peter Port', acceptedCapitals: ['saint peter port', 'st peter port'],
    continent: 'Europe', parentId: '826', enabledByDefault: false, category: 'British Territories',
  },

  // ── French Territories ────────────────────────────────
  {
    id: '540', alpha2: 'nc', name: 'New Caledonia',
    acceptedNames: ['new caledonia'],
    capital: 'Nouméa', acceptedCapitals: ['noumea', 'nouméa'],
    continent: 'Oceania', parentId: '250', enabledByDefault: false, category: 'French Territories',
  },
  {
    id: '258', alpha2: 'pf', name: 'French Polynesia',
    acceptedNames: ['french polynesia'],
    capital: 'Papeete', acceptedCapitals: ['papeete'],
    continent: 'Oceania', parentId: '250', enabledByDefault: false, category: 'French Territories',
  },

  // ── Dutch Territories ─────────────────────────────────
  {
    id: '533', alpha2: 'aw', name: 'Aruba',
    acceptedNames: ['aruba'],
    capital: 'Oranjestad', acceptedCapitals: ['oranjestad'],
    continent: 'North America', parentId: '528', enabledByDefault: false, category: 'Dutch Territories',
  },
  {
    id: '531', alpha2: 'cw', name: 'Curaçao',
    acceptedNames: ['curacao', 'curaçao'],
    capital: 'Willemstad', acceptedCapitals: ['willemstad'],
    continent: 'North America', parentId: '528', enabledByDefault: false, category: 'Dutch Territories',
  },
  {
    id: '534', alpha2: 'sx', name: 'Sint Maarten',
    acceptedNames: ['sint maarten', 'saint martin'],
    capital: 'Philipsburg', acceptedCapitals: ['philipsburg'],
    continent: 'North America', parentId: '528', enabledByDefault: false, category: 'Dutch Territories',
  },

  // ── Other Dependencies ────────────────────────────────
  {
    id: '304', alpha2: 'gl', name: 'Greenland',
    acceptedNames: ['greenland'],
    capital: 'Nuuk', acceptedCapitals: ['nuuk', 'godthab'],
    continent: 'North America', parentId: '208', enabledByDefault: true, category: 'Other Dependencies',
  },
  {
    id: '234', alpha2: 'fo', name: 'Faroe Islands',
    acceptedNames: ['faroe islands', 'faeroe islands', 'faroes'],
    capital: 'Tórshavn', acceptedCapitals: ['torshavn', 'tórshavn'],
    continent: 'Europe', parentId: '208', enabledByDefault: false, category: 'Other Dependencies',
  },
  {
    id: '344', alpha2: 'hk', name: 'Hong Kong',
    acceptedNames: ['hong kong'],
    capital: 'Hong Kong', acceptedCapitals: ['hong kong'],
    continent: 'Asia', parentId: '156', enabledByDefault: false, category: 'Other Dependencies',
  },
  {
    id: '446', alpha2: 'mo', name: 'Macao',
    acceptedNames: ['macao', 'macau'],
    capital: 'Macao', acceptedCapitals: ['macao', 'macau'],
    continent: 'Asia', parentId: '156', enabledByDefault: false, category: 'Other Dependencies',
  },
  {
    id: '570', alpha2: 'nu', name: 'Niue',
    acceptedNames: ['niue'],
    capital: 'Alofi', acceptedCapitals: ['alofi'],
    continent: 'Oceania', parentId: '554', enabledByDefault: false, category: 'Other Dependencies',
  },
  {
    id: '184', alpha2: 'ck', name: 'Cook Islands',
    acceptedNames: ['cook islands'],
    capital: 'Avarua', acceptedCapitals: ['avarua'],
    continent: 'Oceania', parentId: '554', enabledByDefault: false, category: 'Other Dependencies',
  },
];

/**
 * TopoJSON features that don't appear in our countries/territories lists
 * but exist as clickable polygons. Map them to their sovereign parent.
 * These ALWAYS resolve to the parent regardless of settings.
 */
const UNLISTED_FEATURE_PARENTS: Record<string, string> = {
  // UK territories (too small/remote to be separate quiz items)
  '239': '826',  // South Georgia
  '086': '826',  // British Indian Ocean Territory
  '612': '826',  // Pitcairn Islands
  // French territories
  '666': '250',  // Saint Pierre and Miquelon
  '876': '250',  // Wallis and Futuna
  '663': '250',  // Saint Martin
  '652': '250',  // Saint Barthélemy
  '260': '250',  // French Southern Territories
  // Finland
  '248': '246',  // Åland Islands
  // Australia
  '334': '036',  // Heard Island
  '574': '036',  // Norfolk Island
  // Unnamed features (no ISO code — ID assigned at load as _Name)
  '_IndianOceanTer': '036',    // → Australia (Cocos/Christmas)
  '_SiachenGlacier': '356',    // → India
};

/**
 * Build the complete featureId → parentId map for globe interactions.
 * Combines: (1) disabled listed territories, (2) unlisted TopoJSON features.
 * Used for click resolution AND for propagating highlight states.
 */
export function buildFullFeatureParentMap(enabledIds: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  // Disabled listed territories
  for (const t of territories) {
    if (!enabledIds.has(t.id)) {
      map.set(t.id, t.parentId);
    }
  }
  // Unlisted features (always resolve to parent)
  for (const [fid, pid] of Object.entries(UNLISTED_FEATURE_PARENTS)) {
    map.set(fid, pid);
  }
  return map;
}

/**
 * Build a parentId → Set<childFeatureId> reverse map.
 * Used to propagate highlight states from parent to territory polygons.
 */
export function buildParentToChildrenMap(featureParentMap: Map<string, string>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [child, parent] of featureParentMap) {
    if (!map.has(parent)) map.set(parent, new Set());
    map.get(parent)!.add(child);
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
