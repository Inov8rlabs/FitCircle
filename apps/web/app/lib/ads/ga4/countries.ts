/**
 * Country helpers for the GA4 fallback matcher (docs/ADS_ATTRIBUTION_GA4.md §8).
 *
 * The GA4 BigQuery export carries `geo.country` as an English display name
 * ("United States", "U.S. Virgin Islands", "Türkiye"). Our side stores ISO
 * 3166-1 alpha-2 codes. Names are mapped with the runtime's CLDR region names
 * (Intl.DisplayNames, full ICU on Node / Vercel) plus the aliases GA4 uses
 * that differ from CLDR. Pure.
 */

const ISO2_RE = /^[A-Z]{2}$/;

/** Normalised name key: lower-case, no diacritics, "&" = "and", letters/digits only. */
export function countryKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bsaint\b/g, 'st')
    .replace(/[^a-z0-9]/g, '');
}

/** GA4 / common spellings that differ from CLDR English (keys are countryKey()). */
const ALIASES: Record<string, string> = {
  usa: 'US',
  unitedstatesofamerica: 'US',
  usvirginislands: 'VI',
  virginislandsus: 'VI',
  britishvirginislands: 'VG',
  uk: 'GB',
  greatbritain: 'GB',
  turkey: 'TR',
  turkiye: 'TR',
  czechrepublic: 'CZ',
  myanmar: 'MM',
  burma: 'MM',
  ivorycoast: 'CI',
  cotedivoire: 'CI',
  hongkong: 'HK',
  macau: 'MO',
  macao: 'MO',
  macedonia: 'MK',
  fyrom: 'MK',
  swaziland: 'SZ',
  capeverde: 'CV',
  caboverde: 'CV',
  palestine: 'PS',
  democraticrepublicofthecongo: 'CD',
  drcongo: 'CD',
  congokinshasa: 'CD',
  republicofthecongo: 'CG',
  congo: 'CG',
  congobrazzaville: 'CG',
  southkorea: 'KR',
  korearepublicof: 'KR',
  northkorea: 'KP',
  russia: 'RU',
  russianfederation: 'RU',
  vietnam: 'VN',
  laos: 'LA',
  syria: 'SY',
  iran: 'IR',
  moldova: 'MD',
  bolivia: 'BO',
  venezuela: 'VE',
  tanzania: 'TZ',
  brunei: 'BN',
  taiwan: 'TW',
  timorleste: 'TL',
  easttimor: 'TL',
  bosniaandherzegovina: 'BA',
  trinidadandtobago: 'TT',
  antiguaandbarbuda: 'AG',
  stkittsandnevis: 'KN',
  stlucia: 'LC',
  stvincentandgrenadines: 'VC',
  stvincentandthegrenadines: 'VC',
  saotomeandprincipe: 'ST',
  caribbeannetherlands: 'BQ',
  curacao: 'CW',
  sintmaarten: 'SX',
  kosovo: 'XK',
  vaticancity: 'VA',
  holysee: 'VA',
  falklandislands: 'FK',
  falklandislandsislasmalvinas: 'FK',
  micronesia: 'FM',
  reunion: 'RE',
};

/** Withdrawn / pseudo codes Intl still names ("BU" = Myanmar (Burma), "TP", "ZR", …). */
const NOT_COUNTRIES = new Set(['AN', 'BU', 'CS', 'DD', 'DY', 'EU', 'EZ', 'FX', 'HV', 'NH', 'QO', 'RH', 'TP', 'UN', 'VD', 'XA', 'XB', 'YD', 'YU', 'ZR', 'ZZ']);

let byName: Map<string, string> | null = null;

function nameTable(): Map<string, string> {
  if (byName) return byName;
  const m = new Map<string, string>();
  try {
    const names = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let a = 65; a <= 90; a++) {
      for (let b = 65; b <= 90; b++) {
        const code = String.fromCharCode(a, b);
        if (NOT_COUNTRIES.has(code)) continue;
        const name = names.of(code);
        // DisplayNames echoes unknown codes back unchanged.
        if (name && name !== code) {
          const key = countryKey(name);
          if (!m.has(key)) m.set(key, code);
          // "Hong Kong SAR China" → "Hong Kong"; "Congo - Kinshasa" stays via alias.
          const short = countryKey(name.replace(/\s+SAR China$/i, ''));
          if (!m.has(short)) m.set(short, code);
        }
      }
    }
  } catch {
    /* no ICU: aliases only */
  }
  for (const [k, v] of Object.entries(ALIASES)) m.set(k, v);
  byName = m;
  return m;
}

/** GA4 geo.country (display name, or already ISO2) → ISO2; null for "(not set)" / unknown. */
export function ga4CountryToIso2(name: string | null | undefined): string | null {
  const s = String(name ?? '').trim();
  if (!s || s === '(not set)') return null;
  if (ISO2_RE.test(s)) return s;
  return nameTable().get(countryKey(s)) ?? null;
}

/** ISO2 from one of our stored country values (attribution, assignment, profile, RevenueCat). */
export function normIso2(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toUpperCase();
  return ISO2_RE.test(t) ? t : null;
}

/**
 * IANA time zone → country, for zones that name exactly one country. Weak
 * signal (a phone's zone follows its settings, not its location) and only for
 * the zones our users actually report; "UTC" and unlisted zones → null.
 */
const ZONE_COUNTRY: Record<string, string> = {
  'America/New_York': 'US',
  'America/Detroit': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Boise': 'US',
  'America/Phoenix': 'US',
  'America/Los_Angeles': 'US',
  'America/Anchorage': 'US',
  'America/Juneau': 'US',
  'America/Adak': 'US',
  'America/Indiana/Indianapolis': 'US',
  'America/Kentucky/Louisville': 'US',
  'America/Menominee': 'US',
  'America/North_Dakota/Center': 'US',
  'Pacific/Honolulu': 'US',
  'America/Puerto_Rico': 'PR',
  'America/St_Thomas': 'VI',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Edmonton': 'CA',
  'America/Winnipeg': 'CA',
  'America/Halifax': 'CA',
  'America/Regina': 'CA',
  'America/St_Johns': 'CA',
  'America/Mexico_City': 'MX',
  'America/Sao_Paulo': 'BR',
  'America/Bogota': 'CO',
  'America/Lima': 'PE',
  'America/Argentina/Buenos_Aires': 'AR',
  'America/Santiago': 'CL',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Lisbon': 'PT',
  'Europe/Warsaw': 'PL',
  'Europe/Istanbul': 'TR',
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Dubai': 'AE',
  'Asia/Riyadh': 'SA',
  'Asia/Singapore': 'SG',
  'Asia/Manila': 'PH',
  'Asia/Jakarta': 'ID',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Shanghai': 'CN',
  'Asia/Hong_Kong': 'HK',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Pacific/Auckland': 'NZ',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA',
  'Africa/Cairo': 'EG',
};

export function timezoneCountry(tz: string | null | undefined): string | null {
  return tz ? (ZONE_COUNTRY[tz.trim()] ?? null) : null;
}
