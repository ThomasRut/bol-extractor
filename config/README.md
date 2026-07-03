# Customer Configuration

Every business rule the app uses to price a shipment lives in a per-customer JSON
file in `customers/`. Onboarding a new trucking company is a config file, not a
code change. **Real customer files are gitignored** (they contain contract
rates and carrier zone data); only the fabricated `_example.json` is committed.

The backend selects the active customer via the `CUSTOMER_ID` env var
(default: `just-great-enterprises`) and serves the config to the frontend at
`GET /api/customer-config` (with `zipToZone` stripped — the frontend doesn't
need it).

## Schema

| Path | Meaning |
|---|---|
| `customerId` | File name and `CUSTOMER_ID` value |
| `customerName` | Display name |
| `contract.carrier` / `contract.reference` | Which signed agreement these rates come from — every rate in the file should be traceable to it |
| `contract.fuelSurchargePercent` | Default fuel surcharge (UI can override per batch). Mainfreight-style contracts index this to the DOE weekly diesel price — update when the band changes |
| `contract.chargeableWeight.cubicInchDivisor` | Chargeable lbs = (volume ft³ × 1728) / divisor; billed weight = max(actual, chargeable) |
| `contract.priceTable` | Per-zone freight rates. Keys are zone letters; each zone has weight-tier rates (`"10000+"`, `"5000+"`, `"2000+"`, `"1000+"` — tier thresholds are parsed from the key names) plus `min`/`max` caps. The set of keys defines the valid zones |
| `contract.accessorials.liftgate.flat` | Flat charge when liftgate service applies |
| `contract.accessorials.inside` | `perPound` rate on billed weight, clamped to `min`/`max` |
| `contract.accessorials.residential.flat` | Flat charge per residential delivery |
| `contract.accessorials.overLength` | Charge per length bracket (bracket strings must match the extraction schema exactly) |
| `contract.accessorials.timeSpecific` | `earlyZones` lists the cheap bracket; `rates.<window>.early/late` are the two prices per window type |
| `contract.accessorials.detention` | First `freeMinutes` free, then `perMinute` |
| `contract.accessorials.debrisRemoval` | `perPallet` charge; applies when the BOL has a debris section OR the client name contains any `clientNameTriggers` entry (case-insensitive) |
| `contract.fixedLanes` | All-in prices for line-haul runs keyed `"PICKUPSTATE-DELIVERYSTATE"`. **Detection is not wired into billing** (state pairs false-positive on interstate LTL — AUDIT.md §2.2); these are reference values until run identification is settled |
| `contract.zipToZone` | Carrier zone ("Mainzone") per 5-digit delivery ZIP — the fallback when no zone is printed on the BOL. Get this list from the carrier; wrong zones mean wrong rates |
| `consolidation.mergeSameStopMultiBol` | `true` = several BOLs delivered to one address in one driver-day bill as ONE job (combined weight/volume, one liftgate — Mainfreight behavior). Set `false` for carriers that settle each BOL separately |

## Onboarding a new customer

1. Copy `customers/_example.json` → `customers/<customerId>.json`
2. Replace every value from the customer's signed contract + carrier zone list
3. Verify against real settled invoices before trusting the output (see
   `bol-extractor-frontend/src/pricing.test.js` for the settlement-regression
   pattern — build the same fixture for the new customer)
4. Run the backend with `CUSTOMER_ID=<customerId>`
