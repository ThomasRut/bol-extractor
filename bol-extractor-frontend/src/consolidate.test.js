import {
  consolidateMultiPageBOLs,
  normalizeAddress,
  stripProSuffix,
} from './consolidate';

// Representative extracted page, matching the backend's response shape.
// PRO fixtures are synthetic but format-faithful to real-world shapes:
// "WEBATL900001" / "WEBPHL900002" mimic WEB+branch+6-digit web PROs,
// "53880900LN" mimics numeric PROs with a printed (non-suffix) letter tail.
const page = (overrides) => ({
  pageNumber: 1,
  filename: 'batch1.pdf',
  pro: 'WEBATL900001',
  pickupState: 'GA',
  deliveryState: 'GA',
  zone: 'C',
  zoneSource: 'BOL',
  deliveryZip: '30303',
  deliveryAddress: '123 Main St NE, Atlanta, GA 30303',
  weight: 500,
  volumeFt3: 40,
  liftgate: '',
  inside: '',
  residential: '',
  overLength: '',
  palletCount: 2,
  hasDebrisSection: false,
  clientName: 'Acme Freight',
  timeSpecific: '',
  detention: 0,
  isFixedLane: false,
  isLakeshore: false,
  success: true,
  ...overrides,
});

describe('stripProSuffix', () => {
  test('strips page-marker suffixes in common formats', () => {
    expect(stripProSuffix('WEBATL900001 1A')).toBe('WEBATL900001');
    expect(stripProSuffix('WEBATL900001-1B')).toBe('WEBATL900001');
    expect(stripProSuffix('WEBATL9000011A')).toBe('WEBATL900001');
    expect(stripProSuffix('webatl900001 2b')).toBe('WEBATL900001');
    expect(stripProSuffix('WEBATL900001 A')).toBe('WEBATL900001');
  });

  test('leaves suffix-free PROs untouched', () => {
    expect(stripProSuffix('WEBATL900001')).toBe('WEBATL900001');
    expect(stripProSuffix('WEBPHL900002')).toBe('WEBPHL900002');
    // printed letter tails are part of the PRO, not a page marker
    expect(stripProSuffix('53880900LN')).toBe('53880900LN');
  });

  test('never strips down to an implausibly short identifier', () => {
    expect(stripProSuffix('12A')).toBe('12A');
    expect(stripProSuffix('')).toBe('');
    expect(stripProSuffix(null)).toBe('');
  });
});

describe('normalizeAddress', () => {
  test('matches abbreviation and directional variants', () => {
    expect(normalizeAddress('123 Main St NE, Atlanta, GA 30303')).toBe(
      normalizeAddress('123 Main Street, Atlanta GA 30303')
    );
  });

  test('distinct streets stay distinct', () => {
    expect(normalizeAddress('123 Main St')).not.toBe(normalizeAddress('124 Main St'));
  });

  test('empty input yields empty key', () => {
    expect(normalizeAddress('')).toBe('');
    expect(normalizeAddress(null)).toBe('');
  });
});

describe('consolidateMultiPageBOLs', () => {
  test('single-page BOL passes through unchanged', () => {
    const input = page({ weight: 750, liftgate: 'Yes' });
    const out = consolidateMultiPageBOLs([input]);

    expect(out).toHaveLength(1);
    expect(out[0].isMultiPage).toBe(false);
    expect(out[0].pro).toBe('WEBATL900001');
    expect(out[0].weight).toBe(750);
    expect(out[0].liftgate).toBe('Yes');
    expect(out[0].zone).toBe('C');
  });

  test('same PRO with different suffixes merges into one shipment', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'WEBATL900001 1A', weight: 500, volumeFt3: 40, palletCount: 2 }),
      page({ pageNumber: 2, pro: 'WEBATL900001 1B', weight: 300, volumeFt3: 25, palletCount: 1 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].isMultiPage).toBe(true);
    expect(out[0].pro).toBe('WEBATL900001');
    expect(out[0].originalPros).toEqual(['WEBATL900001 1A', 'WEBATL900001 1B']);
    expect(out[0].weight).toBe(800);
    expect(out[0].volumeFt3).toBe(65);
    expect(out[0].palletCount).toBe(3);
    expect(out[0].pageNumbers).toEqual([1, 2]);
  });

  test('same address but different PROs stay separate shipments', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'WEBATL900001' }),
      page({ pageNumber: 2, pro: 'WEBPHL900002' }),
    ]);

    expect(out).toHaveLength(2);
  });

  test('page with unreadable PRO joins its sibling by address', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'WEBATL900001 1A', weight: 500 }),
      page({
        pageNumber: 2,
        pro: '',
        deliveryAddress: '123 Main Street, Atlanta GA 30303',
        weight: 200,
      }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(700);
    expect(out[0].pro).toBe('WEBATL900001');
  });

  test('address-matched page seen first adopts the PRO from a later page', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: '', weight: 200 }),
      page({ pageNumber: 2, pro: 'WEBATL900001 1B', weight: 500 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].pro).toBe('WEBATL900001');
    expect(out[0].weight).toBe(700);
  });

  test('page with no PRO and no address joins the previous consecutive page', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'WEBATL900001 1A', weight: 500 }),
      page({ pageNumber: 2, pro: '', deliveryAddress: '', weight: 300 }),
    ]);

    expect(out).toHaveLength(1);
    expect(out[0].weight).toBe(800);
  });

  test('unidentifiable page does NOT join across files or page gaps', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'WEBATL900001', filename: 'a.pdf' }),
      page({ pageNumber: 2, pro: '', deliveryAddress: '', filename: 'b.pdf' }),
    ]);

    expect(out).toHaveLength(2);
  });

  test('conflicting field values resolve per the aggregation rules', () => {
    const out = consolidateMultiPageBOLs([
      page({
        pro: 'WEBATL900001 1A',
        liftgate: 'Yes',
        inside: '',
        residential: '',
        overLength: '97-144',
        detention: 20,
        zone: '',
        zoneSource: 'UNKNOWN',
        timeSpecific: '',
        hasDebrisSection: false,
      }),
      page({
        pageNumber: 2,
        pro: 'WEBATL900001 1B',
        liftgate: '',
        inside: 'Yes',
        residential: 'Yes',
        overLength: '145-192',
        detention: 45,
        zone: 'D',
        zoneSource: 'ZIP',
        timeSpecific: '2 Hours',
        hasDebrisSection: true,
      }),
    ]);

    expect(out).toHaveLength(1);
    const merged = out[0];
    expect(merged.liftgate).toBe('Yes');
    expect(merged.inside).toBe('Yes');
    expect(merged.residential).toBe('Yes');
    expect(merged.overLength).toBe('145-192');
    expect(merged.detention).toBe(45); // max, not sum — summing invents detention charges
    expect(merged.zone).toBe('D'); // first VALID zone wins over empty/QUOTE
    expect(merged.zoneSource).toBe('ZIP');
    expect(merged.timeSpecific).toBe('2 Hours');
    expect(merged.hasDebrisSection).toBe(true);
  });

  test('a QUOTE zone on page 1 is replaced by a real zone from page 2', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'X1234 1A', zone: 'QUOTE', zoneSource: 'UNKNOWN' }),
      page({ pageNumber: 2, pro: 'X1234 1B', zone: 'F', zoneSource: 'BOL' }),
    ]);

    expect(out[0].zone).toBe('F');
    expect(out[0].zoneSource).toBe('BOL');
  });

  test('fixed-lane detection on any page marks the whole shipment', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'X1234 1A', isFixedLane: false }),
      page({
        pageNumber: 2,
        pro: 'X1234 1B',
        isFixedLane: true,
        laneKey: 'GA-NJ',
        fixedPrice: 2000,
      }),
    ]);

    expect(out[0].isFixedLane).toBe(true);
    expect(out[0].laneKey).toBe('GA-NJ');
    expect(out[0].fixedPrice).toBe(2000);
  });

  test('malformed numerics (strings, negatives) are coerced safely', () => {
    const out = consolidateMultiPageBOLs([
      page({ pro: 'X1234 1A', weight: '1,200', volumeFt3: '40.5', detention: -10 }),
      page({ pageNumber: 2, pro: 'X1234 1B', weight: -50, volumeFt3: 'n/a', detention: '15' }),
    ]);

    expect(out[0].weight).toBe(1200);
    expect(out[0].volumeFt3).toBe(40.5);
    expect(out[0].detention).toBe(15);
  });

  test('empty input returns empty output', () => {
    expect(consolidateMultiPageBOLs([])).toEqual([]);
  });
});
