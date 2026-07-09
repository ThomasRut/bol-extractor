import { calculateCharges } from './pricing';

// The pricing engine is config-driven — tests run against the REAL customer
// config (gitignored, lives at repo root config/customers/). On a machine
// without it, suites skip with a warning instead of failing.
let config = null;
try {
  config = require('../../config/customers/just-great-enterprises.json');
} catch (e) {
  console.warn('⚠️ customer config not found — pricing suites skipped');
}

// Settlement regression: real invoice rows where the biller's computed total
// matched Mainfreight's actual payment to <$0.02. If calculateCharges stops
// reproducing these, a rate or formula regressed. Fixture is gitignored.
let fixture = null;
try {
  fixture = require('./__fixtures__/settled-invoices.json');
} catch (e) {
  console.warn('⚠️ settled-invoices fixture not found — settlement regression skipped');
}

const describeSettled = fixture?.contractSnapshot ? describe : describe.skip;
const describeUnit = config ? describe : describe.skip;

describeSettled('calculateCharges reproduces settled Mainfreight invoices', () => {
  // Historical rows must be priced with the contract AS OF settlement time
  // (the fixture's snapshot), not the live config — rates legitimately change
  // (residential went $15 -> $20 in Jul 2026) without invalidating history.
  const settledConfig = { contract: fixture?.contractSnapshot };
  const opts = { fuelSurchargePercent: fixture?.fuelSurchargePercent ?? 0.24 };

  test('fixture is non-trivial', () => {
    expect(fixture.rows.length).toBeGreaterThan(50);
  });

  (fixture?.rows ?? []).forEach((row) => {
    test(`${row.job} (${row.sheet}) settles at $${row.paid}`, () => {
      const result = calculateCharges(row.input, settledConfig, opts);
      expect(result.total).not.toBe('Quote Required');
      // extrasAdjustment is the sheet's manual Extras column (fees our engine
      // doesn't model, e.g. one-off adjustments) — add it before comparing.
      const computed = parseFloat(result.total) + row.extrasAdjustment;
      expect(computed).toBeCloseTo(row.paid, 1); // within $0.05
    });
  });
});

describeUnit('calculateCharges unit behavior', () => {
  const base = {
    pro: 'TEST1', zone: 'C', weight: 100, volumeFt3: 10,
    liftgate: '', inside: '', overLength: '', residential: '',
    timeSpecific: '', detention: 0, palletCount: 0,
    hasDebrisSection: false, isLakeshore: false,
  };
  const noFuel = { fuelSurchargePercent: 0 };

  test('unknown zone returns Quote Required instead of a number', () => {
    const r = calculateCharges({ ...base, zone: 'QUOTE' }, config);
    expect(r.total).toBe('Quote Required');
  });

  test('zone minimum applies to small shipments', () => {
    // 100 lbs / 10 ft³ → chargeable ~150 lbs → freight clamps to the zone min
    const r = calculateCharges(base, config, noFuel);
    expect(parseFloat(r.freight)).toBeCloseTo(config.contract.priceTable.C.min, 2);
  });

  test('detention bills per minute after the free window', () => {
    const det = config.contract.accessorials.detention;
    const r = calculateCharges({ ...base, detention: 122 }, config, noFuel);
    // e.g. (122−30) chargeable minutes × $0.60 = $55.20 (settled row WEBATL179292)
    expect(parseFloat(r.extras)).toBeCloseTo((122 - det.freeMinutes) * det.perMinute, 2);
  });

  test('time-specific uses the early bracket in early zones and late elsewhere', () => {
    const ts = config.contract.accessorials.timeSpecific;
    const earlyZone = ts.earlyZones[0];
    const lateZone = Object.keys(config.contract.priceTable).find((z) => !ts.earlyZones.includes(z));
    const early = calculateCharges({ ...base, zone: earlyZone, timeSpecific: 'AM Special' }, config, noFuel);
    const late = calculateCharges({ ...base, zone: lateZone, timeSpecific: 'AM Special' }, config, noFuel);
    expect(parseFloat(early.extras)).toBeCloseTo(ts.rates['AM Special'].early, 2);
    expect(parseFloat(late.extras)).toBeCloseTo(ts.rates['AM Special'].late, 2);
  });

  test('liftgate below the weight floor is neither billed nor shown', () => {
    // Customer rule (Robson, 2026-07-08): under 100 lbs the driver hand-carries,
    // so a liftgate marked on the BOL doesn't count. Verified against POD
    // 06-24-26 rows 16554103/16558179 (83 lbs, liftgate printed, not settled).
    const floor = config.contract.accessorials.liftgate.minWeightLbs;
    const light = calculateCharges({ ...base, weight: floor - 1, liftgate: 'Yes' }, config, noFuel);
    const heavy = calculateCharges({ ...base, weight: floor, liftgate: 'Yes' }, config, noFuel);
    expect(light.liftgate).toBe('');
    expect(parseFloat(heavy.extras) - parseFloat(light.extras))
      .toBeCloseTo(config.contract.accessorials.liftgate.flat, 2);
    expect(heavy.liftgate).toBe('Yes');
  });

  test('configs without minWeightLbs bill marked liftgates at any weight', () => {
    // Historical contractSnapshots predate the rule — they must keep billing.
    const legacy = JSON.parse(JSON.stringify(config));
    delete legacy.contract.accessorials.liftgate.minWeightLbs;
    const r = calculateCharges({ ...base, weight: 1, liftgate: 'Yes' }, legacy, noFuel);
    expect(r.liftgate).toBe('Yes');
    expect(parseFloat(r.extras)).toBeCloseTo(legacy.contract.accessorials.liftgate.flat, 2);
  });

  test('missing config throws instead of silently pricing wrong', () => {
    expect(() => calculateCharges(base, null)).toThrow(/customer config/);
  });

  test('manual fixed-lane run prices all-in with no fuel or accessorials', () => {
    const lanes = Object.entries(config.contract.fixedLanes);
    if (lanes.length === 0) return; // customer without fixed lanes
    const [laneKey, price] = lanes[0];
    const r = calculateCharges(
      { pro: laneKey, laneKey, fixedPrice: price, isFixedLane: true, manualEntry: true },
      config,
      { fuelSurchargePercent: 0.24 } // must be ignored — lane price is all-in
    );
    expect(r.total).toBe(price.toFixed(2));
    expect(r.fuelSurcharge).toBe('0.00');
    expect(r.extras).toBe('0.00');
    expect(r.zone).toBe(laneKey);
  });
});
