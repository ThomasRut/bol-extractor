import { calculateCharges } from './pricing';

// Settlement regression: 94 real invoice rows where the biller's computed total
// matched Mainfreight's actual payment to <$0.02. If calculateCharges stops
// reproducing these, a rate or formula regressed.
//
// The fixture holds real customer data and is gitignored — on a machine without
// it (fresh clone), this suite skips with a warning instead of failing.
let fixture = null;
try {
  fixture = require('./__fixtures__/settled-invoices.json');
} catch (e) {
  console.warn('⚠️ settled-invoices fixture not found — settlement regression suite skipped');
}

const describeIf = fixture ? describe : describe.skip;

describeIf('calculateCharges reproduces settled Mainfreight invoices', () => {
  const opts = { fuelSurchargePercent: fixture?.fuelSurchargePercent ?? 0.24 };

  test('fixture is non-trivial', () => {
    expect(fixture.rows.length).toBeGreaterThan(50);
  });

  (fixture?.rows ?? []).forEach((row) => {
    test(`${row.job} (${row.sheet}) settles at $${row.paid}`, () => {
      const result = calculateCharges(row.input, opts);
      expect(result.total).not.toBe('Quote Required');
      // extrasAdjustment is the sheet's manual Extras column (fees our engine
      // doesn't model, e.g. one-off adjustments) — add it before comparing.
      const computed = parseFloat(result.total) + row.extrasAdjustment;
      expect(computed).toBeCloseTo(row.paid, 1); // within $0.05
    });
  });
});

describe('calculateCharges unit behavior', () => {
  const base = {
    pro: 'TEST1', zone: 'C', weight: 100, volumeFt3: 10,
    liftgate: '', inside: '', overLength: '', residential: '',
    timeSpecific: '', detention: 0, palletCount: 0,
    hasDebrisSection: false, isLakeshore: false,
  };

  test('unknown zone returns Quote Required instead of a number', () => {
    const r = calculateCharges({ ...base, zone: 'QUOTE' });
    expect(r.total).toBe('Quote Required');
  });

  test('zone minimum applies to small shipments', () => {
    // 100 lbs / 10 ft³ → chargeable 150 lbs → freight below zone C $22 min
    const r = calculateCharges(base, { fuelSurchargePercent: 0 });
    expect(r.freight).toBe('22.00');
  });

  test('detention bills per minute after the free 30', () => {
    const r = calculateCharges({ ...base, detention: 122 }, { fuelSurchargePercent: 0 });
    // 92 chargeable minutes × $0.60 = $55.20 (matches settled row WEBATL179292)
    expect(parseFloat(r.extras)).toBeCloseTo(55.2, 2);
  });

  test('AM Special charges $28 in zones A–D and $38 in E–L', () => {
    const early = calculateCharges({ ...base, timeSpecific: 'AM Special' }, { fuelSurchargePercent: 0 });
    const late = calculateCharges({ ...base, zone: 'H', timeSpecific: 'AM Special' }, { fuelSurchargePercent: 0 });
    expect(parseFloat(early.extras)).toBeCloseTo(28, 2);
    expect(parseFloat(late.extras)).toBeCloseTo(38, 2);
  });
});
