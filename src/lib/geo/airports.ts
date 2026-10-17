/**
 * Worldwide commercial airport database and fast search index.
 *
 * Data licences:
 * - OurAirports (https://ourairports.com/data/): Public Domain (CC0).
 * - OpenFlights (https://openflights.org/data.html): Open Database License (ODbL 1.0) —
 *   used for IANA timezone mappings.
 */

import rawAirports from "./airports.json" with { type: "json" };

export const AIRPORT_DATA_ATTRIBUTION =
  "Airport data from OurAirports (Public Domain) and OpenFlights (ODbL).";

export interface Airport {
  iata: string;
  icao: string | null;
  name: string;
  city: string;
  country: string; /* ISO-3166 alpha-2 */
  countryName: string;
  lat: number;
  lon: number;
  tz: string | null; /* IANA */
  size: "large" | "medium" | "small";
}

/** Normalizes text for diacritics-insensitive, case-insensitive, punctuation-insensitive matching. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[łŁ]/g, "l")
    .replace(/[đĐðÐ]/g, "d")
    .replace(/[þÞ]/g, "th")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Bidirectional and directional city / exonym alias groups (all normalized).
 * If an airport's normalized city matches any entry in a group, all other entries in that group
 * are added to its search aliases.
 */
const CITY_ALIAS_GROUPS: readonly (readonly string[])[] = [
  // India historic / renamed / regional names
  ["bengaluru", "bangalore"],
  ["kolkata", "calcutta"],
  ["mumbai", "bombay", "navi mumbai"],
  ["chennai", "madras"],
  ["port blair", "sri vijaya puram", "andaman"],
  ["new delhi", "delhi", "gurgaon", "gurugram", "noida", "faridabad", "ghaziabad", "ncr"],
  ["kochi", "cochin", "ernakulam"],
  ["thiruvananthapuram", "trivandrum"],
  ["kozhikode", "calicut"],
  ["mangaluru", "mangalore"],
  ["mysuru", "mysore"],
  ["puducherry", "pondicherry"],
  ["varanasi", "benares", "banaras", "kashi"],
  ["prayagraj", "allahabad"],
  ["vadodara", "baroda"],
  ["visakhapatnam", "vizag", "waltair"],
  ["vijayawada", "bezawada"],
  ["tiruchirappalli", "trichy"],
  ["pune", "poona"],
  ["shimla", "simla"],
  ["guwahati", "gauhati"],
  ["bhubaneswar", "bhubaneshwar"],
  ["kanpur", "cawnpore"],
  ["jabalpur", "jubbulpore"],
  ["belagavi", "belgaum"],
  ["hubballi", "hubli"],
  ["kalaburagi", "gulbarga"],
  ["shivamogga", "shimoga"],
  ["chhatrapati sambhajinagar", "aurangabad"],
  ["ayodhya", "faizabad"],

  // Common English exonyms & endonyms worldwide
  ["wien", "vienna"],
  ["munchen", "muenchen", "munich"],
  ["koln", "koeln", "cologne"],
  ["frankfurt am main", "frankfurt"],
  ["nurnberg", "nuernberg", "nuremberg"],
  ["hannover", "hanover"],
  ["zurich", "zuerich"],
  ["geneve", "geneva"],
  ["basel", "basle", "mulhouse"],
  ["roma", "rome"],
  ["milano", "milan"],
  ["venezia", "venice"],
  ["firenze", "florence"],
  ["napoli", "naples"],
  ["torino", "turin"],
  ["genova", "genoa"],
  ["athina", "athens"],
  ["thessaloniki", "salonica"],
  ["praha", "prague"],
  ["warszawa", "warsaw"],
  ["krakow", "cracow"],
  ["bucuresti", "bucharest"],
  ["beograd", "belgrade"],
  ["kyiv", "kiev"],
  ["moskva", "moscow"],
  ["sankt peterburg", "saint petersburg", "st petersburg"],
  ["kobenhavn", "copenhagen"],
  ["goteborg", "gothenburg"],
  ["helsinki", "helsingfors"],
  ["bruxelles", "brussel", "brussels"],
  ["antwerpen", "antwerp"],
  ["den haag", "the hague"],
  ["lisboa", "lisbon"],
  ["porto", "oporto"],
  ["sevilla", "seville"],
  ["palma de mallorca", "mallorca", "majorca"],
  ["peking", "beijing"],
  ["canton", "guangzhou"],
  ["hong kong", "hongkong"],
  ["macau", "macao"],
  ["taipei", "taibei"],
  ["busan", "pusan"],
  ["ho chi minh city", "ho chi minh", "saigon"],
  ["ha noi", "hanoi"],
  ["da nang", "danang"],
  ["yangon", "rangoon"],
  ["krung thep", "bangkok"],
  ["kathmandu", "katmandu"],
  ["dhaka", "dacca"],
  ["al qahirah", "cairo"],
  ["al iskandariyah", "alexandria"],
  ["marrakech", "marrakesh"],
  ["ciudad de mexico", "mexico city"],
  ["la habana", "habana", "havana"],
  ["sao paulo", "sampa"],
  ["rio de janeiro", "rio"],
  ["makkah", "mecca"],
  ["madinah", "medina"],
  ["jeddah", "jiddah"],
  ["abu dhabi", "abudhabi"],
  ["tel aviv", "tel aviv yafo"],
];

/** Additional IATA-specific city/metro aliases for airports located in suburbs or multi-airport metros. */
const IATA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  // India
  BLR: ["bengaluru", "bangalore"],
  CCU: ["kolkata", "calcutta"],
  BOM: ["mumbai", "bombay", "navi mumbai"],
  DEL: ["delhi", "new delhi", "gurgaon", "gurugram", "noida", "ncr"],
  DXN: ["delhi", "new delhi", "noida", "jewar", "ncr"],
  HDO: ["delhi", "new delhi", "ghaziabad", "hindon", "ncr"],
  MAA: ["chennai", "madras"],
  IXZ: ["port blair", "sri vijaya puram", "andaman"],
  GOI: ["goa", "dabolim", "panaji", "panjim", "vasco da gama"],
  GOX: ["goa", "mopa", "north goa", "panaji"],
  COK: ["kochi", "cochin", "ernakulam"],
  TRV: ["thiruvananthapuram", "trivandrum"],
  CCJ: ["kozhikode", "calicut"],
  CNN: ["kannur", "cannanore"],
  IXE: ["mangaluru", "mangalore"],
  MYQ: ["mysuru", "mysore"],
  HYD: ["hyderabad", "secunderabad"],
  VTZ: ["visakhapatnam", "vizag"],
  VGA: ["vijayawada"],
  TIR: ["tirupati"],
  TRZ: ["tiruchirappalli", "trichy"],
  IXM: ["madurai"],
  CJB: ["coimbatore"],
  PNQ: ["pune", "poona"],
  NAG: ["nagpur"],
  AMD: ["ahmedabad", "gandhinagar"],
  BDQ: ["vadodara", "baroda"],
  STV: ["surat"],
  JAI: ["jaipur"],
  UDR: ["udaipur"],
  JDH: ["jodhpur"],
  IXC: ["chandigarh", "mohali", "panchkula"],
  ATQ: ["amritsar"],
  SXR: ["srinagar", "kashmir"],
  IXJ: ["jammu"],
  IXL: ["leh", "ladakh"],
  DED: ["dehradun", "rishikesh", "haridwar"],
  LKO: ["lucknow"],
  VNS: ["varanasi", "benares", "banaras"],
  AYJ: ["ayodhya", "faizabad"],
  IXD: ["prayagraj", "allahabad"],
  PAT: ["patna"],
  GAY: ["gaya", "bodh gaya"],
  IXR: ["ranchi"],
  BBI: ["bhubaneswar", "bhubaneshwar", "puri"],
  IXB: ["bagdogra", "siliguri", "darjeeling", "gangtok", "sikkim"],
  GAU: ["guwahati", "gauhati"],
  SHL: ["shillong", "meghalaya"],
  IMF: ["imphal"],
  IXA: ["agartala"],
  DIB: ["dibrugarh"],
  IDR: ["indore"],
  BHO: ["bhopal"],
  RPR: ["raipur"],
  AGX: ["agatti", "lakshadweep"],

  // Worldwide multi-airport cities & suburb municipalities
  LHR: ["london", "lon", "heathrow"],
  LGW: ["london", "lon", "gatwick"],
  STN: ["london", "lon", "stansted"],
  LTN: ["london", "lon", "luton"],
  LCY: ["london", "lon", "london city"],
  SEN: ["london", "lon", "southend"],
  JFK: ["new york", "new york city", "nyc", "queens"],
  EWR: ["new york", "new york city", "nyc", "newark"],
  LGA: ["new york", "new york city", "nyc", "laguardia"],
  CDG: ["paris", "par", "roissy"],
  ORY: ["paris", "par", "orly"],
  BVA: ["paris", "par", "beauvais"],
  NRT: ["tokyo", "tyo", "narita"],
  HND: ["tokyo", "tyo", "haneda"],
  KIX: ["osaka", "osa", "kyoto", "kobe", "kansai"],
  ITM: ["osaka", "osa", "itami"],
  CTS: ["sapporo", "spk", "chitose", "hokkaido"],
  ICN: ["seoul", "sel", "incheon"],
  GMP: ["seoul", "sel", "gimpo"],
  PEK: ["beijing", "peking", "bjs"],
  PKX: ["beijing", "peking", "bjs", "daxing"],
  PVG: ["shanghai", "sha", "pudong"],
  SHA: ["shanghai", "hongqiao"],
  TPE: ["taipei", "taoyuan"],
  TSA: ["taipei", "songshan"],
  BKK: ["bangkok", "suvarnabhumi"],
  DMK: ["bangkok", "don mueang"],
  KUL: ["kuala lumpur", "kl", "sepang"],
  SZB: ["kuala lumpur", "kl", "subang"],
  CGK: ["jakarta", "tangerang"],
  DPS: ["bali", "denpasar"],
  CMB: ["colombo", "katunayake"],
  MLE: ["male", "maldives"],
  DXB: ["dubai"],
  DWC: ["dubai", "al maktoum"],
  SHJ: ["sharjah", "dubai"],
  AUH: ["abu dhabi"],
  DOH: ["doha"],
  MCT: ["muscat"],
  KWI: ["kuwait", "kuwait city"],
  BAH: ["bahrain", "manama", "muharraq"],
  RUH: ["riyadh"],
  JED: ["jeddah", "mecca", "makkah"],
  MED: ["medina", "madinah"],
  DMM: ["dammam", "dhahran", "khobar"],
  IST: ["istanbul"],
  SAW: ["istanbul", "sabiha gokcen"],
  FCO: ["rome", "roma", "fiumicino"],
  CIA: ["rome", "roma", "ciampino"],
  MXP: ["milan", "milano", "malpensa"],
  LIN: ["milan", "milano", "linate"],
  BGY: ["milan", "milano", "bergamo"],
  VCE: ["venice", "venezia"],
  NAP: ["naples", "napoli"],
  FLR: ["florence", "firenze"],
  FRA: ["frankfurt"],
  MUC: ["munich", "munchen", "muenchen"],
  BER: ["berlin"],
  ZRH: ["zurich", "zuerich"],
  GVA: ["geneva", "geneve"],
  BSL: ["basel", "mulhouse", "freiburg"],
  VIE: ["vienna", "wien"],
  PRG: ["prague", "praha"],
  WAW: ["warsaw", "warszawa"],
  BRU: ["brussels", "bruxelles", "brussel"],
  CRL: ["brussels", "charleroi"],
  AMS: ["amsterdam", "schiphol"],
  LIS: ["lisbon", "lisboa"],
  MAD: ["madrid"],
  BCN: ["barcelona"],
  ATH: ["athens", "athina"],
  CPH: ["copenhagen", "kobenhavn"],
  ARN: ["stockholm", "sto"],
  OSL: ["oslo"],
  HEL: ["helsinki"],
  KEF: ["reykjavik", "keflavik"],
  YYZ: ["toronto", "yto"],
  YTZ: ["toronto", "yto"],
  YVR: ["vancouver"],
  YUL: ["montreal", "ymq"],
  ORD: ["chicago", "chi", "ohare"],
  MDW: ["chicago", "chi", "midway"],
  IAD: ["washington", "washington dc", "was", "dulles"],
  DCA: ["washington", "washington dc", "was", "reagan"],
  BWI: ["washington", "baltimore", "was"],
  SFO: ["san francisco", "bay area"],
  OAK: ["san francisco", "oakland", "bay area"],
  SJC: ["san jose", "silicon valley", "bay area"],
  LAX: ["los angeles", "la"],
  DFW: ["dallas", "fort worth"],
  IAH: ["houston"],
  MIA: ["miami"],
  FLL: ["miami", "fort lauderdale"],
  GRU: ["sao paulo", "sao", "guarulhos"],
  CGH: ["sao paulo", "sao", "congonhas"],
  VCP: ["sao paulo", "sao", "campinas", "viracopos"],
  GIG: ["rio de janeiro", "rio", "galeao"],
  SDU: ["rio de janeiro", "rio", "santos dumont"],
  EZE: ["buenos aires", "bue", "ezeiza"],
  AEP: ["buenos aires", "bue", "aeroparque"],
};

/** Flagship primary hubs that should rank first when multiple large airports share a city. */
const MEGA_HUBS = new Set([
  "DEL",
  "BOM",
  "BLR",
  "MAA",
  "CCU",
  "HYD",
  "COK",
  "GOI",
  "AMD",
  "PNQ",
  "IXZ",
  "LHR",
  "DXB",
  "SIN",
  "HND",
  "NRT",
  "CDG",
  "AMS",
  "FRA",
  "MUC",
  "IST",
  "DOH",
  "AUH",
  "HKG",
  "ICN",
  "BKK",
  "KUL",
  "JFK",
  "LAX",
  "SFO",
  "ORD",
  "ATL",
  "DFW",
  "MIA",
  "YYZ",
  "YVR",
  "SYD",
  "MEL",
  "GRU",
  "EZE",
  "MEX",
  "JNB",
  "CAI",
  "ZRH",
  "MAD",
  "BCN",
  "FCO",
  "MXP",
]);

interface IndexedAirport {
  airport: Airport;
  iataLower: string;
  icaoLower: string;
  normCity: string;
  cityWords: string[];
  normName: string;
  nameWords: string[];
  normCountryName: string;
  countryLower: string;
  aliases: string[];
  aliasWords: string[];
  allText: string;
  sizeBonus: number;
  hubBonus: number;
}

const cityAliasMap = new Map<string, Set<string>>();
for (const group of CITY_ALIAS_GROUPS) {
  for (const term of group) {
    let set = cityAliasMap.get(term);
    if (!set) {
      set = new Set<string>();
      cityAliasMap.set(term, set);
    }
    for (const other of group) {
      if (other !== term) set.add(other);
    }
  }
}

const AIRPORTS_LIST: readonly Airport[] = rawAirports as Airport[];
const BY_IATA = new Map<string, Airport>();
const INDEX: IndexedAirport[] = [];

for (const airport of AIRPORTS_LIST) {
  BY_IATA.set(airport.iata, airport);

  const iataLower = airport.iata.toLowerCase();
  const icaoLower = airport.icao ? airport.icao.toLowerCase() : "";
  const normCity = normalizeSearchText(airport.city);
  const cityWords = normCity ? normCity.split(" ") : [];
  const normName = normalizeSearchText(airport.name);
  const nameWords = normName ? normName.split(" ") : [];
  const normCountryName = normalizeSearchText(airport.countryName);
  const countryLower = airport.country.toLowerCase();

  const aliasSet = new Set<string>();

  // Add IATA-specific aliases
  const byCode = IATA_ALIASES[airport.iata];
  if (byCode) {
    for (const a of byCode) {
      aliasSet.add(normalizeSearchText(a));
    }
  }

  // Add city-level aliases if city matches any alias group entry
  const directGroup = cityAliasMap.get(normCity);
  if (directGroup) {
    for (const a of directGroup) aliasSet.add(a);
  }
  for (const w of cityWords) {
    const wordGroup = cityAliasMap.get(w);
    if (wordGroup) {
      for (const a of wordGroup) aliasSet.add(a);
    }
  }

  aliasSet.delete("");
  aliasSet.delete(normCity);

  const aliases = [...aliasSet];
  const aliasWordsSet = new Set<string>();
  for (const a of aliases) {
    for (const w of a.split(" ")) {
      if (w) aliasWordsSet.add(w);
    }
  }
  const aliasWords = [...aliasWordsSet];

  const allText = `${iataLower} ${icaoLower} ${normCity} ${normName} ${normCountryName} ${countryLower} ${aliases.join(" ")}`;

  const sizeBonus = airport.size === "large" ? 3000 : airport.size === "medium" ? 1500 : 0;
  const hubBonus = MEGA_HUBS.has(airport.iata) ? 800 : 0;

  INDEX.push({
    airport,
    iataLower,
    icaoLower,
    normCity,
    cityWords,
    normName,
    nameWords,
    normCountryName,
    countryLower,
    aliases,
    aliasWords,
    allText,
    sizeBonus,
    hubBonus,
  });
}

/** Looks up an airport by its 3-letter IATA code (case-insensitive). Returns `null` if unknown. */
export function getAirport(code: string): Airport | null {
  if (typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return null;
  return BY_IATA.get(normalized) ?? null;
}

/** Returns `true` if `code` is a known 3-letter commercial airport IATA code in our database. */
export function isKnownAirport(code: string): boolean {
  return getAirport(code) !== null;
}

function scoreAirport(entry: IndexedAirport, nq: string, tokens: string[]): number {
  // Every query token must appear somewhere in the airport's searchable text
  for (let i = 0; i < tokens.length; i++) {
    if (!entry.allText.includes(tokens[i]!)) {
      return 0;
    }
  }

  let matchScore = 0;

  if (entry.iataLower === nq) {
    matchScore = 100_000;
  } else if (entry.icaoLower !== "" && entry.icaoLower === nq) {
    matchScore = 90_000;
  } else if (entry.normCity === nq) {
    matchScore = 80_000;
  } else if (entry.aliases.includes(nq)) {
    matchScore = 78_000;
  } else if (entry.normCity.startsWith(nq)) {
    matchScore = 60_000;
  } else if (entry.aliases.some((a) => a.startsWith(nq))) {
    matchScore = 58_000;
  } else if (entry.normName === nq) {
    matchScore = 55_000;
  } else if (nq.length <= 3 && entry.iataLower.startsWith(nq)) {
    matchScore = 50_000;
  } else if (entry.normName.startsWith(nq)) {
    matchScore = 48_000;
  } else if (entry.cityWords.some((w) => w.startsWith(nq))) {
    matchScore = 45_000;
  } else if (entry.aliasWords.some((w) => w.startsWith(nq))) {
    matchScore = 43_000;
  } else if (entry.nameWords.some((w) => w.startsWith(nq))) {
    matchScore = 40_000;
  } else if (entry.normCountryName === nq) {
    matchScore = 30_000;
  } else if (entry.normCountryName.startsWith(nq)) {
    matchScore = 25_000;
  } else if (entry.normCity.includes(nq)) {
    matchScore = 20_000;
  } else if (entry.aliases.some((a) => a.includes(nq))) {
    matchScore = 18_000;
  } else if (entry.normName.includes(nq)) {
    matchScore = 15_000;
  } else {
    // Multi-token match across fields
    const allWordPrefix = tokens.every(
      (t) =>
        entry.iataLower.startsWith(t) ||
        entry.cityWords.some((w) => w.startsWith(t)) ||
        entry.aliasWords.some((w) => w.startsWith(t)) ||
        entry.nameWords.some((w) => w.startsWith(t)),
    );
    matchScore = allWordPrefix ? 12_000 : 8_000;
  }

  const lengthPenalty = Math.min(entry.normCity.length, 50);
  return matchScore + entry.sizeBonus + entry.hubBonus - lengthPenalty;
}

/**
 * Searches airports by IATA, ICAO, city, aliases/exonyms, airport name, or country.
 * Pre-normalized index is built once at module load.
 */
export function searchAirports(q: string, limit = 8): Airport[] {
  if (typeof q !== "string") return [];
  const trimmed = q.trim();
  if (trimmed.length < 1 || trimmed.length > 64) return [];

  const nq = normalizeSearchText(trimmed);
  if (!nq) return [];

  const clampedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(20, Math.floor(limit)))
    : 8;

  const tokens = nq.split(" ");
  const matches: Array<{ airport: Airport; score: number }> = [];

  for (let i = 0; i < INDEX.length; i++) {
    const entry = INDEX[i]!;
    const score = scoreAirport(entry, nq, tokens);
    if (score > 0) {
      matches.push({ airport: entry.airport, score });
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.airport.iata < b.airport.iata ? -1 : a.airport.iata > b.airport.iata ? 1 : 0;
  });

  return matches.slice(0, clampedLimit).map((m) => m.airport);
}
