// Pricing engine — pure functions, no React state, NO hardcoded rates.
// Every rate, cap, bracket, and formula constant comes from the per-customer
// config (config/README.md). The frontend receives the active customer's
// config from the backend at GET /api/customer-config.

// Weight-tier thresholds are encoded in the priceTable key names ("10000+",
// "2000+", ...). Returns tiers sorted highest-first, e.g. [[10000, rate], ...].
function weightTiers(zoneRates) {
  return Object.keys(zoneRates)
    .filter((k) => /^\d+\+$/.test(k))
    .map((k) => [parseInt(k, 10), zoneRates[k]])
    .sort((a, b) => b[0] - a[0]);
}

export function calculateCharges(data, config, { fuelSurchargePercent, driverName = '' } = {}) {
  if (!config?.contract) {
    throw new Error('calculateCharges requires a customer config');
  }
  const { priceTable, accessorials, chargeableWeight } = config.contract;
  const fuelPct = fuelSurchargePercent ?? config.contract.fuelSurchargePercent;

  // Manually entered fixed-price line-haul run: the lane price is ALL-IN
  // (settled invoices show fuel baked in — e.g. $2,000 = $1,612.90 linehaul
  // + $387.10 fuel), so no surcharge or accessorials apply on top.
  if (data.isFixedLane && data.fixedPrice) {
    const price = Number(data.fixedPrice) || 0;
    return {
      pro: data.pro || data.laneKey,
      driver: driverName,
      zone: data.laneKey || 'LANE',
      zoneSource: 'MANUAL',
      lowConfidenceFields: [],
      stopMarker: '',
      detentionNote: '',
      deliveryZip: '',
      weight: '',
      volumeFt3: '',
      chargeable: '',
      freight: price.toFixed(2),
      fuelSurcharge: '0.00',
      debrisRemoval: '0.00',
      liftgate: '',
      inside: '',
      overLength: '',
      residential: '',
      timeSpecific: '',
      detention: 0,
      extras: '0.00',
      total: price.toFixed(2)
    };
  }

  const volume = data.volumeFt3 || data.volume || 0;
  const weight = data.weight || 0;

  const zone = data.zone?.toUpperCase();
  const zoneRates = priceTable[zone];

  if (!zoneRates) {
    console.warn(`⚠️ Zone "${zone}" not found in price table. Freight requires manual quote.`);
    return {
      pro: data.pro,
      driver: driverName,
      zone: zone || '?',
      zoneSource: data.zoneSource,
      lowConfidenceFields: data.lowConfidenceFields || [],
      stopMarker: data.stopMarker || '',
      detentionNote: data.detentionNote || '',
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

  // Chargeable weight: cubic inches / configured divisor, billed at the
  // greater of actual vs chargeable
  const chargeable = (volume * 1728) / chargeableWeight.cubicInchDivisor;
  const applicableWeight = Math.max(weight, chargeable);

  // Freight: tiered per-lb rate, clamped to the zone's min/max caps
  const tiers = weightTiers(zoneRates);
  let rate = tiers[tiers.length - 1][1]; // lowest tier is the default
  for (const [threshold, tierRate] of tiers) {
    if (applicableWeight >= threshold) { rate = tierRate; break; }
  }
  let freight = applicableWeight * rate;
  freight = Math.max(zoneRates.min, Math.min(freight, zoneRates.max));

  const fuelSurcharge = freight * fuelPct;

  const debrisRemoval = (data.hasDebrisSection || data.isLakeshore)
    ? (data.palletCount || 0) * accessorials.debrisRemoval.perPallet
    : 0;

  const liftgateCharge = data.liftgate === 'Yes' ? accessorials.liftgate.flat : 0;

  const insideCharge = data.inside === 'Yes'
    ? Math.max(
        accessorials.inside.min,
        Math.min(applicableWeight * accessorials.inside.perPound, accessorials.inside.max)
      )
    : 0;

  const overLengthCharge = accessorials.overLength[data.overLength] || 0;

  const residentialCharge = data.residential === 'Yes' ? accessorials.residential.flat : 0;

  const tsConfig = accessorials.timeSpecific;
  const bracket = tsConfig.earlyZones.includes(zone) ? 'early' : 'late';
  const timeSpecificCharge = tsConfig.rates[data.timeSpecific]?.[bracket] || 0;

  const det = accessorials.detention;
  const detentionCharge = data.detention > det.freeMinutes
    ? (data.detention - det.freeMinutes) * det.perMinute
    : 0;

  const extras = debrisRemoval + liftgateCharge + insideCharge + overLengthCharge +
                residentialCharge + timeSpecificCharge + detentionCharge;

  const total = freight + fuelSurcharge + extras;

  return {
    pro: data.pro || 'N/A',
    driver: driverName,
    zone: zone || '?',
    zoneSource: data.zoneSource,
    lowConfidenceFields: data.lowConfidenceFields || [],
    stopMarker: data.stopMarker || '',
    detentionNote: data.detentionNote || '',
    deliveryZip: data.deliveryZip,
    weight: weight.toFixed(0),
    volumeFt3: volume.toFixed(2),
    chargeable: chargeable.toFixed(0),
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
