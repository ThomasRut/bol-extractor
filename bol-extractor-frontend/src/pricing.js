// Pricing engine — pure functions, no React state.
// Rates verified 2026-07-03 against the Mainfreight ICA compensation schedule,
// the customer's rate sheet, and 107 settled invoice rows (see AUDIT.md §2.0).
// NOTE: these constants move to per-customer config in the C.5 refactor —
// do not add new hardcoded rates here.

export const PRICE_TABLE = {
  'A': { '10000+': 0.0121, '5000+': 0.0129, '2000+': 0.0137, '1000+': 0.0144, min: 18.00, max: 160.00 },
  'B': { '10000+': 0.0132, '5000+': 0.0140, '2000+': 0.0147, '1000+': 0.0157, min: 20.00, max: 180.00 },
  'C': { '10000+': 0.0143, '5000+': 0.0150, '2000+': 0.0160, '1000+': 0.0169, min: 22.00, max: 200.00 },
  'D': { '10000+': 0.0154, '5000+': 0.0163, '2000+': 0.0173, '1000+': 0.0183, min: 24.00, max: 220.00 },
  'E': { '10000+': 0.0183, '5000+': 0.0195, '2000+': 0.0204, '1000+': 0.0218, min: 26.00, max: 240.00 },
  'F': { '10000+': 0.0198, '5000+': 0.0209, '2000+': 0.0221, '1000+': 0.0235, min: 28.00, max: 260.00 },
  'G': { '10000+': 0.0213, '5000+': 0.0226, '2000+': 0.0239, '1000+': 0.0253, min: 31.00, max: 290.00 },
  'H': { '10000+': 0.0230, '5000+': 0.0243, '2000+': 0.0258, '1000+': 0.0273, min: 34.00, max: 320.00 },
  'I': { '10000+': 0.0249, '5000+': 0.0262, '2000+': 0.0279, '1000+': 0.0295, min: 37.00, max: 350.00 },
  'J': { '10000+': 0.0267, '5000+': 0.0284, '2000+': 0.0301, '1000+': 0.0319, min: 40.00, max: 380.00 },
  'K': { '10000+': 0.0289, '5000+': 0.0307, '2000+': 0.0325, '1000+': 0.0344, min: 43.00, max: 400.00 },
  'L': { '10000+': 0.0313, '5000+': 0.0332, '2000+': 0.0352, '1000+': 0.0371, min: 46.00, max: 420.00 },
};

export function calculateCharges(data, { fuelSurchargePercent = 0.24, driverName = '' } = {}) {
  const volume = data.volumeFt3 || data.volume || 0;
  const weight = data.weight || 0;

  const zone = data.zone?.toUpperCase();
  const zoneRates = PRICE_TABLE[zone];

  if (!zoneRates) {
    console.warn(`⚠️ Zone "${zone}" not found in price table. Freight requires manual quote.`);
    return {
      pro: data.pro,
      driver: driverName,
      zone: zone || '?',
      zoneSource: data.zoneSource,
      deliveryZip: data.deliveryZip,
      weight: weight.toFixed(0),
      volumeFt3: volume.toFixed(2),
      chargeable: '0',
      freight: 'Quote Required',
      fuelSurcharge: 'Quote Required',
      debrisRemoval: '0.00',
      liftgate: data.liftgate === 'Yes' ? 'Yes' : '',
      inside: data.inside === 'Yes' ? 'Yes' : '',
      overLength: data.overLength || '',
      residential: data.residential === 'Yes' ? 'Yes' : '',
      timeSpecific: data.timeSpecific || '',
      detention: data.detention || 0,
      extras: '0.00',
      total: 'Quote Required'
    };
  }

  // Calculate chargeable weight
  const chargeableWeight = (volume * 1728) / 115;
  const applicableWeight = Math.max(weight, chargeableWeight);

  // Calculate freight
  let rate;
  if (applicableWeight >= 10000) rate = zoneRates['10000+'];
  else if (applicableWeight >= 5000) rate = zoneRates['5000+'];
  else if (applicableWeight >= 2000) rate = zoneRates['2000+'];
  else rate = zoneRates['1000+'];

  let freight = applicableWeight * rate;
  freight = Math.max(zoneRates.min, Math.min(freight, zoneRates.max));

  // Calculate fuel surcharge
  const fuelSurcharge = freight * fuelSurchargePercent;

  // Calculate debris removal
  const debrisRemoval = (data.hasDebrisSection || data.isLakeshore)
    ? (data.palletCount || 0) * 3
    : 0;

  // Calculate liftgate
  const liftgateCharge = data.liftgate === 'Yes' ? 20 : 0;

  // Calculate inside delivery
  const insideCharge = data.inside === 'Yes'
    ? Math.max(10, Math.min(applicableWeight * 0.004, 80))
    : 0;

  // Calculate over length
  let overLengthCharge = 0;
  if (data.overLength === '97-144') overLengthCharge = 12;
  else if (data.overLength === '145-192') overLengthCharge = 18;
  else if (data.overLength === '193-240') overLengthCharge = 24;
  else if (data.overLength === '241 or more') overLengthCharge = 30;

  // Calculate residential
  const residentialCharge = data.residential === 'Yes' ? 15 : 0;

  // Calculate time specific
  const earlyZones = ['A', 'B', 'C', 'D'];
  const isEarlyZone = earlyZones.includes(zone);
  let timeSpecificCharge = 0;

  if (data.timeSpecific) {
    if (data.timeSpecific === 'AM Special') timeSpecificCharge = isEarlyZone ? 28 : 38;
    else if (data.timeSpecific === '2 Hours') timeSpecificCharge = isEarlyZone ? 38 : 48;
    else if (data.timeSpecific === '15 Minutes') timeSpecificCharge = isEarlyZone ? 53 : 63;
  }

  // Calculate detention: $0.60/min after the first free 30 minutes
  // (verified against settled invoices — Mainfreight pays per minute, not per hour)
  const detentionCharge = data.detention > 30
    ? (data.detention - 30) * 0.60
    : 0;

  // Calculate extras
  const extras = debrisRemoval + liftgateCharge + insideCharge + overLengthCharge +
                residentialCharge + timeSpecificCharge + detentionCharge;

  // Calculate total
  const total = freight + fuelSurcharge + extras;

  return {
    pro: data.pro || 'N/A',
    driver: driverName,
    zone: zone || '?',
    zoneSource: data.zoneSource,
    deliveryZip: data.deliveryZip,
    weight: weight.toFixed(0),
    volumeFt3: volume.toFixed(2),
    chargeable: chargeableWeight.toFixed(0),
    freight: freight.toFixed(2),
    fuelSurcharge: fuelSurcharge.toFixed(2),
    debrisRemoval: debrisRemoval.toFixed(2),
    liftgate: data.liftgate === 'Yes' ? 'Yes' : '',
    inside: data.inside === 'Yes' ? 'Yes' : '',
    overLength: data.overLength || '',
    residential: data.residential === 'Yes' ? 'Yes' : '',
    timeSpecific: data.timeSpecific || '',
    detention: data.detention || 0,
    extras: extras.toFixed(2),
    total: total.toFixed(2)
  };
}
