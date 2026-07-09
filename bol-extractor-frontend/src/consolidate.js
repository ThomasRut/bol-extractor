// Multi-page BOL consolidation.
//
// Pages that describe ONE billable job must merge into one row. Two real-world
// cases (customer-confirmed against Mainfreight settlements):
//   - one shipment split across pages (same PRO, page suffixes like 1A/1B)
//   - one STOP receiving several BOLs with different PROs (driver marks like
//     "4-A"/"4-B") — settles as ONE job: combined weight/volume, one liftgate
//
// Pages are matched with three signals, in order of trust:
//
//   1. PRO number with the page suffix stripped ("WEBATL900001 1A" and
//      "WEBATL900001 1B" are the same shipment).
//   2. Same normalized delivery address within the SAME uploaded file (a file
//      is typically one driver-day, so same file + same address = same stop).
//      The same address in different files stays separate — different days
//      are different stops.
//   3. Consecutive page in the same uploaded file — only for pages with
//      neither a PRO nor an address.
//
// Aggregation rules (per product blueprint):
//   sum   → weight, volumeFt3, palletCount
//   max   → overLength (higher range wins), detention
//   OR    → liftgate, inside, residential, hasDebrisSection, isLakeshore,
//           isFixedLane (lane details adopted from the page that detected it)
//   first non-empty → zone (a real zone beats "QUOTE"), zoneSource,
//           deliveryZip, deliveryAddress, pickupState, deliveryState,
//           clientName, timeSpecific
//
// Single-page shipments pass through unchanged (plus metadata fields).

const OVER_LENGTH_RANGES = ['97-144', '145-192', '193-240', '241 or more'];

// Trailing page markers look like "1A"/"12B" after a separator, a lone
// separated letter ("- A"), or a single digit+letter glued on with no
// separator ("...2641A" → page "1A"). Without a separator anything longer
// than digit+letter is ambiguous with the PRO itself, so it is left alone.
// Only strip when a plausible identifier remains.
export function stripProSuffix(pro) {
  if (!pro) return '';
  const cleaned = String(pro).toUpperCase().trim();
  const stripped = cleaned.replace(/(?:[\s\-_]+\d{0,2}[A-Z]|\d[A-Z])$/, '');
  return stripped.length >= 4 ? stripped : cleaned;
}

// Recovered from commit 1fedfcf: lowercase, strip punctuation, expand street
// abbreviations, then drop directionals so "123 Main St NE" == "123 Main Street".
export function normalizeAddress(addr) {
  if (!addr) return '';

  let normalized = String(addr)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\./g, '')
    .replace(/,/g, '')
    .replace(/\brd\b/g, 'road')
    .replace(/\bst\b/g, 'street')
    .replace(/\bave\b/g, 'avenue')
    .replace(/\bdr\b/g, 'drive')
    .replace(/\bln\b/g, 'lane')
    .replace(/\bblvd\b/g, 'boulevard')
    .replace(/\bct\b/g, 'court')
    .replace(/\bpkwy\b/g, 'parkway')
    .replace(/\bpl\b/g, 'place')
    .replace(/\bcir\b/g, 'circle')
    .replace(/\bste\b/g, 'suite')
    .replace(/\bapt\b/g, 'apartment')
    .replace(/\s+/g, ' ')
    .trim();

  normalized = normalized
    .replace(/\bnortheast\b/g, '')
    .replace(/\bnorthwest\b/g, '')
    .replace(/\bsoutheast\b/g, '')
    .replace(/\bsouthwest\b/g, '')
    .replace(/\bnorth\b/g, '')
    .replace(/\bsouth\b/g, '')
    .replace(/\beast\b/g, '')
    .replace(/\bwest\b/g, '')
    .replace(/\bne\b/g, '')
    .replace(/\bnw\b/g, '')
    .replace(/\bse\b/g, '')
    .replace(/\bsw\b/g, '')
    .replace(/\bn\b/g, '')
    .replace(/\bs\b/g, '')
    .replace(/\be\b/g, '')
    .replace(/\bw\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

// Extracted numerics can come back as strings or negatives; math downstream
// (freight, debris, detention) must never see NaN or negative values.
function toNumber(value) {
  const n = typeof value === 'string' ? parseFloat(value.replace(/,/g, '')) : Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function isEmptyZone(zone) {
  return !zone || zone === 'QUOTE';
}

function firstNonEmpty(pages, field) {
  for (const page of pages) {
    if (page[field] !== undefined && page[field] !== null && page[field] !== '') {
      return page[field];
    }
  }
  return '';
}

function anyYes(pages, field) {
  return pages.some((p) => p[field] === 'Yes') ? 'Yes' : '';
}

function maxOverLength(pages) {
  let best = -1;
  for (const page of pages) {
    const idx = OVER_LENGTH_RANGES.indexOf(page.overLength);
    if (idx > best) best = idx;
  }
  return best === -1 ? '' : OVER_LENGTH_RANGES[best];
}

// A rescanned page — same raw PRO with identical totals and address — must
// count ONCE: summing a rescan double-bills the shipment. Real continuation
// pages differ (suffixed PRO or partial weights), so they still sum. Pages
// without a PRO are never treated as rescans.
function dropRescans(pages) {
  const seen = new Set();
  const kept = [];
  const duplicatePageNumbers = [];
  for (const p of pages) {
    const rawPro = String(p.pro || '').toUpperCase().trim();
    const key = rawPro && [
      rawPro, toNumber(p.weight), toNumber(p.volumeFt3),
      toNumber(p.palletCount), normalizeAddress(p.deliveryAddress),
    ].join('|');
    if (key && seen.has(key)) {
      duplicatePageNumbers.push(p.pageNumber);
      continue;
    }
    if (key) seen.add(key);
    kept.push(p);
  }
  return { kept, duplicatePageNumbers };
}

function mergePages(group) {
  const { kept: pages, duplicatePageNumbers } = dropRescans(group.pages);
  const first = pages[0];
  const proBases = [...group.proBases];

  const zonePage = pages.find((p) => !isEmptyZone(p.zone));
  const fixedLanePage = pages.find((p) => p.isFixedLane);

  return {
    ...first,
    // A multi-BOL stop shows every PRO it settles ("PROA + PROB")
    pro: proBases.length ? proBases.join(' + ') : firstNonEmpty(pages, 'pro'),
    originalPros: pages.map((p) => p.pro || ''),
    pageNumbers: group.pages.map((p) => p.pageNumber),
    duplicatePageNumbers,
    isMultiPage: true,
    isMultiDocStop: proBases.length > 1,
    pages,

    weight: pages.reduce((sum, p) => sum + toNumber(p.weight), 0),
    volumeFt3: pages.reduce((sum, p) => sum + toNumber(p.volumeFt3), 0),
    palletCount: pages.reduce((sum, p) => sum + toNumber(p.palletCount), 0),

    overLength: maxOverLength(pages),
    detention: Math.max(0, ...pages.map((p) => toNumber(p.detention))),

    liftgate: anyYes(pages, 'liftgate'),
    inside: anyYes(pages, 'inside'),
    residential: anyYes(pages, 'residential'),
    hasDebrisSection: pages.some((p) => !!p.hasDebrisSection),
    isLakeshore: pages.some((p) => !!p.isLakeshore),

    isFixedLane: !!fixedLanePage,
    laneKey: fixedLanePage ? fixedLanePage.laneKey : first.laneKey,
    fixedPrice: fixedLanePage ? fixedLanePage.fixedPrice : first.fixedPrice,

    zone: zonePage ? zonePage.zone : first.zone,
    zoneSource: zonePage ? zonePage.zoneSource : first.zoneSource,
    deliveryZip: firstNonEmpty(pages, 'deliveryZip'),
    deliveryAddress: firstNonEmpty(pages, 'deliveryAddress'),
    pickupState: firstNonEmpty(pages, 'pickupState'),
    deliveryState: firstNonEmpty(pages, 'deliveryState'),
    clientName: firstNonEmpty(pages, 'clientName'),
    timeSpecific: firstNonEmpty(pages, 'timeSpecific'),
    stopMarker: firstNonEmpty(pages, 'stopMarker'),
    detentionNote: firstNonEmpty(pages, 'detentionNote'),
    // A field doubted on ANY page stays doubted for the merged shipment
    lowConfidenceFields: [...new Set(pages.flatMap((p) => p.lowConfidenceFields || []))],
  };
}

// options.mergeSameStopMultiBol (per-customer config): when true, several BOLs
// delivered to one address in one file settle as ONE job (Mainfreight
// behavior). When false, different PROs never merge — only continuation pages
// with unreadable PROs join by address.
export function consolidateMultiPageBOLs(pageResults, { mergeSameStopMultiBol = true } = {}) {
  const groups = [];
  let previousGroup = null;

  for (const page of pageResults) {
    const proBase = stripProSuffix(page.pro);
    const normAddr = normalizeAddress(page.deliveryAddress);

    let group = null;

    if (proBase) {
      group = groups.find((g) => g.proBases.has(proBase));
    }
    if (!group && normAddr) {
      // Same stop: same delivery address within the same uploaded file.
      group = groups.find(
        (g) =>
          g.addresses.has(normAddr) &&
          g.filenames.has(page.filename) &&
          (mergeSameStopMultiBol || !proBase || g.proBases.size === 0 || g.proBases.has(proBase))
      );
      if (group && proBase) group.proBases.add(proBase);
    }
    if (
      !group &&
      !proBase &&
      !normAddr &&
      previousGroup &&
      previousGroup.filenames.has(page.filename) &&
      page.pageNumber === previousGroup.lastPageNumber + 1
    ) {
      group = previousGroup;
    }

    if (!group) {
      group = {
        proBases: new Set(proBase ? [proBase] : []),
        addresses: new Set(),
        filenames: new Set(),
        pages: [],
      };
      groups.push(group);
    }

    if (normAddr) group.addresses.add(normAddr);
    group.filenames.add(page.filename);
    group.pages.push(page);
    group.lastPageNumber = page.pageNumber;
    previousGroup = group;
  }

  return groups.map((group) =>
    group.pages.length === 1
      ? {
          ...group.pages[0],
          isMultiPage: false,
          isMultiDocStop: false,
          pageNumbers: [group.pages[0].pageNumber],
          duplicatePageNumbers: [],
          pages: group.pages,
        }
      : mergePages(group)
  );
}
