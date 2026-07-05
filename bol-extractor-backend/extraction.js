// BOL extraction - Claude vision call plus zone/fixed-lane post-processing.
// Kept free of Express so the regression harness (test/run-regression.js)
// can drive extraction without starting the server.
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument } = require('pdf-lib');
require('dotenv').config({ path: path.join(__dirname, '.env') });

console.log('API key:', process.env.ANTHROPIC_API_KEY ? 'loaded' : 'MISSING');

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // 429/529/5xx are retried with backoff (honors retry-after) instead of
  // permanently failing the page
  maxRetries: 4,
});

// Business rules (fixed lanes, ZIP->zone map, valid zones, debris-client
// triggers) come from the per-customer config — see config/README.md.
// processPage takes the config as a parameter; nothing is hardcoded here.

// Structured-output schema: the API guarantees the response validates against
// this, so there is no JSON-scraping/parse-failure path, and the enum fields
// can never drift from the exact strings pricing switches on.
const EXTRACTABLE_FIELDS = [
  'pro', 'stopMarker', 'pickupState', 'deliveryState', 'zone', 'deliveryZip',
  'deliveryAddress', 'weight', 'volumeFt3', 'liftgate', 'inside',
  'residential', 'overLength', 'palletCount', 'hasDebrisSection',
  'clientName', 'timeSpecific', 'detention', 'detentionNote'
];

const EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...EXTRACTABLE_FIELDS, 'lowConfidenceFields'],
  properties: {
    pro: { type: 'string' },
    stopMarker: { type: 'string' },
    pickupState: { type: 'string' },
    deliveryState: { type: 'string' },
    zone: { type: 'string' },
    deliveryZip: { type: 'string' },
    deliveryAddress: { type: 'string' },
    weight: { type: 'number' },
    volumeFt3: { type: 'number' },
    liftgate: { enum: ['Yes', ''] },
    inside: { enum: ['Yes', ''] },
    residential: { enum: ['Yes', ''] },
    overLength: { enum: ['97-144', '145-192', '193-240', '241 or more', ''] },
    palletCount: { type: 'number' },
    hasDebrisSection: { type: 'boolean' },
    clientName: { type: 'string' },
    // "REVIEW": a time-specific indicator exists but the window fits no
    // category — surfaced to the human instead of coin-flipping a bracket
    timeSpecific: { enum: ['AM Special', '2 Hours', '15 Minutes', 'REVIEW', ''] },
    detention: { type: 'number' },
    detentionNote: { type: 'string' },
    // Per-field self-reported confidence — drives the review UI highlighting
    lowConfidenceFields: { type: 'array', items: { enum: EXTRACTABLE_FIELDS } }
  }
};

async function splitPdfPages(pdfBase64) {
  try {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const pageCount = pdfDoc.getPageCount();
    
    console.log(`📄 PDF has ${pageCount} page(s)`);
    
    const pages = [];
    
    for (let i = 0; i < pageCount; i++) {
      const singlePagePdf = await PDFDocument.create();
      const [copiedPage] = await singlePagePdf.copyPages(pdfDoc, [i]);
      singlePagePdf.addPage(copiedPage);
      
      // ✅ OPTIMIZATION 2: Moderate compression for ~20% size reduction
      const pdfBytes = await singlePagePdf.save({
        useObjectStreams: false,
        addDefaultPage: false
      });
      const pageBase64 = Buffer.from(pdfBytes).toString('base64');
      
      pages.push({
        pageNumber: i + 1,
        base64: pageBase64
      });
    }
    
    return pages;
  } catch (error) {
    console.error('Error splitting PDF:', error);
    throw error;
  }
}

async function processPage(pageBase64, pageNumber, config) {
  try {
    if (!config?.contract) {
      throw new Error('processPage requires a customer config (see config/README.md)');
    }
    // ✅ OPTIMIZATION 1: Prompt Caching - Move extraction rules to system with cache_control
    const message = await anthropic.messages.create({
      // claude-sonnet-4-20250514 retired 2026-06-15 (started returning 404) —
      // migrated to its designated replacement. Adaptive thinking at LOW
      // effort: with thinking disabled the model could not reliably do the
      // time-window boundary arithmetic (page 3 of the regression scan
      // flip-flopped REVIEW/AM Special across runs); low-effort thinking
      // stabilized it for a few hundred tokens per page. max_tokens covers
      // thinking + output combined.
      model: 'claude-sonnet-5',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: { type: 'json_schema', schema: EXTRACTION_SCHEMA } },
      system: [
        {
          type: 'text',
          text: `You are analyzing a Bill of Lading (BOL) document. BOLs come in many different formats and layouts, but you need to extract the same core information regardless of format.

**DOCUMENT TYPES YOU MAY ENCOUNTER:**
- Traditional freight BOLs (multi-column layout with shipper/consignee sections)
- Delivery Receipt format (simpler layout with pickup/deliver sections)
- Single-page or multi-page BOLs (may have suffixes like 1A, 1B)
- Various carrier formats (different field names and locations)

**YOUR TASK:** Extract 15 specific data points from any BOL format.

═══════════════════════════════════════════════════════════════

**FIELD 1: PRO NUMBER / JOB NUMBER + FIELD 1b: STOP MARKER**
The PRO number is PRINTED in the document title line (e.g. "Delivery Receipt - WEBATL180948") or header/barcode area.

CRITICAL - PRINTED vs HANDWRITTEN:
- Return in "pro" ONLY the printed identifier, exactly as printed. Never append handwritten characters to it.
- Drivers often handwrite a stop/route marker NEXT TO the printed PRO (examples: "1", "3", "4-A", "4-B", sometimes with a checkmark). Return that marker separately in "stopMarker" ("" if none).
- A letter suffix that is PART OF THE PRINTED text (e.g. printed "53880973LN") belongs in "pro".

WHY THIS MATTERS: the printed PRO is the billing key; the handwritten marker tells us which stop of the route this page belongs to. Mixing them corrupts both.

EXTRACTION RULE:
- "pro": the printed identifier only, "" if not found
- "stopMarker": the handwritten marker near the PRO (without checkmarks), "" if none

═══════════════════════════════════════════════════════════════

**FIELD 2: PICKUP STATE**
⚠️ NEW FIELD - Used to identify fixed-price lanes

WHAT TO LOOK FOR:
- The state abbreviation from the PICKUP/SHIPPER address
- Location: "Ship From:", "Shipper:", pickup/origin section
- Format: 2-letter state code (e.g., "GA", "CA", "NJ")

CRITICAL RULES:
- MUST be from pickup/origin address, NOT delivery address
- Return uppercase 2-letter state code only
- This is used to identify special contract lanes (GA-NJ, CA-GA, GA-CA)

EXTRACTION RULE:
- Return 2-letter state code as string (e.g., "GA", "CA", "TX")
- Return "" if not found

═══════════════════════════════════════════════════════════════

**FIELD 3: DELIVERY STATE**
⚠️ NEW FIELD - Used to identify fixed-price lanes

WHAT TO LOOK FOR:
- The state abbreviation from the DELIVERY/CONSIGNEE address
- Location: "Ship To:", "Deliver To:", "Consignee:", delivery section
- Format: 2-letter state code (e.g., "GA", "NJ", "CA")

CRITICAL RULES:
- MUST be from delivery address, NOT pickup address
- Return uppercase 2-letter state code only
- This is used to identify special contract lanes

EXTRACTION RULE:
- Return 2-letter state code as string (e.g., "NJ", "CA", "FL")
- Return "" if not found

═══════════════════════════════════════════════════════════════

**FIELD 4: ZONE (DELIVERY ZONE)**
⚠️ CRITICAL: This must be the DELIVERY/CONSIGNEE zone, NOT pickup/shipper zone

WHAT TO LOOK FOR:
- Labels: "Zone:", "Zone", "APC:" (in delivery section)
- Location: Near delivery address, in consignee section, or in delivery APC field
- Format: Single letter A through L

COMMON MISTAKES TO AVOID:
- DO NOT use pickup/shipper zone
- DO NOT use origin APC zone
- ONLY use zone from "Deliver To:" or "Consignee" section

EXTRACTION RULE:
- Return single uppercase letter A-L
- Return "" (empty string) if zone not found (we will determine from ZIP code)

═══════════════════════════════════════════════════════════════

**FIELD 5: DELIVERY ZIP CODE**
⚠️ Used as fallback when zone is not explicitly shown

WHAT TO LOOK FOR:
- The ZIP code from the DELIVERY/CONSIGNEE address (NOT pickup/shipper)
- Location: In "Deliver To:", "Consignee:", or delivery address section
- Format: 5-digit ZIP code

CRITICAL RULES:
- MUST be from delivery address, NOT pickup address
- Extract only the 5-digit ZIP code
- This is crucial for zone determination when zone field is missing

EXTRACTION RULE:
- Return 5-digit ZIP code as string
- Return "" (empty string) if not found

═══════════════════════════════════════════════════════════════

**FIELD 6: DELIVERY ADDRESS (FULL)**
WHAT TO LOOK FOR:
- The complete delivery/consignee address including street, city, state, ZIP
- Location: "Deliver To:", "Consignee:", delivery section
- Used for multi-page BOL consolidation

EXTRACTION RULE:
- Return full address as single string
- Return "" if not found

═══════════════════════════════════════════════════════════════

**FIELD 7: WEIGHT**
WHAT TO LOOK FOR:
- Labels: "Weight-lbs", "Weight", "Total Weight", "TOTALS" row
- Location: Usually in item details table or totals section
- Format: Number in pounds (lbs)

CRITICAL RULES:
- Use ACTUAL weight (not dimensional/volumetric weight)
- If multiple pieces, use the TOTAL weight
- Look in both item rows AND totals row

EXTRACTION RULE:
- Return numeric value only (no units)
- Return 0 if not found

═══════════════════════════════════════════════════════════════

**FIELD 8: VOLUME**
WHAT TO LOOK FOR:
- Labels: "Volume-ft3", "Volume", "Cu Ft", "CF"
- Location: Item details table or totals section
- Format: Cubic feet (ft³)

EXTRACTION RULE:
- Return numeric value only (no units)
- Return 0 if not found

═══════════════════════════════════════════════════════════════

**FIELD 9: LIFTGATE**
⚠️ CRITICAL: LIFTGATE IS ALMOST ALWAYS HANDWRITTEN OR CIRCLED - YOU MUST FIND IT!

**⚠️⚠️⚠️ ULTRA-CRITICAL - READ THIS FIRST ⚠️⚠️⚠️**
LIFTGATE is ALMOST ALWAYS handwritten or circled!
Look for CIRCLES, OVALS, and BUBBLES with handwritten text - this is where 90% of liftgate appears!
If you see ANY handwritten text inside a circle → READ IT CAREFULLY → It's probably "LIFTGATE"

**STEP-BY-STEP SEARCH PROCESS:**
1. **First**, scan the "Additional Information" section - look for circled text containing "LIFTGATE DELIVERY" or "Liftgate"
2. **Second**, look in the item details table area for handwritten "LIFTGATE" or "liftgate"
3. **Third**, check margins, bottom, and sides of entire document
4. **Fourth**, look for circled or underlined text anywhere
5. **Fifth**, check special instructions and delivery notes

**COMMON PLACES WHERE LIFTGATE APPEARS:**
- Circled text in "Additional Information": "(DEL) APPOINTMENT NOTIFY REQUIRED FOR ALL DELIVERIES LIFTGATE DELIVERY Residential Delivery"
- Handwritten below the item table: "LIFTGATE" or "liftgate"
- Mixed with other delivery requirements
- Part of longer delivery instruction sentences

**COMMON VARIATIONS YOU MUST RECOGNIZE:**
- "LIFTGATE DELIVERY" (in circled text with other instructions)
- "LIFTGATE" (handwritten, all caps)
- "liftgate" (handwritten, lowercase)
- "Liftgate" (mixed case)
- "Lift Gate" (two words)
- "LG" (abbreviated)
- "Liftgate Required" (in sentences)
- "Required LIFTGATE" (in sentences)

**CRITICAL RULES:**
- If you see "LIFTGATE" ANYWHERE in ANY form → return "Yes"
- Circled text counts! If "LIFTGATE" is in a circled section → return "Yes"
- Handwritten counts! Even if messy → return "Yes"
- In a sentence counts! "LIFTGATE DELIVERY Required" → return "Yes"
- Multiple delivery services listed together? Check if liftgate is one of them → return "Yes"

**EXAMPLES THAT SHOULD RETURN "Yes":**
✓ "LIFTGATE DELIVERY" (even if circled with other text)
✓ "Liftgate Required RESIDENTIAL DELIVERY Required" (in a sentence)
✓ Handwritten "LIFTGATE" in table area
✓ "liftgate" (lowercase, handwritten)
✓ "(DEL) LIFTGATE DELIVERY FOR ALL DELIVERIES" (in instructions)

EXTRACTION RULE:
- Return "Yes" if you see the word "LIFTGATE" or "liftgate" in ANY location, ANY format
- Return "" ONLY if you have carefully checked the entire document and found NO mention of liftgate
- Default to "Yes" if uncertain and you see something that might be liftgate

═══════════════════════════════════════════════════════════════

**FIELD 10: INSIDE DELIVERY**
⚠️ CRITICAL: Check BOTH printed sections AND handwritten notes

WHAT TO LOOK FOR IN 5 LOCATIONS:
1. Printed service checkboxes
2. "Additional Information" section (often has handwritten notes)
3. "Special Instructions" field
4. Handwritten notes anywhere on document
5. Delivery instructions area

EXTRACTION RULE:
- Return "Yes" if you see ANY mention (printed OR handwritten)
- Even partial words like "inside" or "threshold" count
- Return "" (empty string) only if completely absent

═══════════════════════════════════════════════════════════════

**FIELD 11: RESIDENTIAL DELIVERY**
⚠️ CRITICAL: RESIDENTIAL IS ALMOST ALWAYS HANDWRITTEN OR CIRCLED - YOU MUST FIND IT!

**STEP-BY-STEP SEARCH PROCESS:**
1. **First**, scan the "Additional Information" section - look for circled text containing "Residential Delivery" or "RESIDENTIAL"
2. **Second**, look in the item details table area for handwritten "RESIDENTIAL" or "residential"
3. **Third**, check margins, bottom, and sides of entire document
4. **Fourth**, look for circled or underlined text anywhere
5. **Fifth**, check special instructions and delivery notes

**COMMON PLACES WHERE RESIDENTIAL APPEARS:**
- Circled text in "Additional Information": "Appointment Delivery LIFTGATE DELIVERY Residential Delivery"
- Handwritten below the item table: "RESIDENTIAL" or "residential"
- Mixed with other delivery requirements
- Part of longer delivery instruction sentences

**COMMON VARIATIONS YOU MUST RECOGNIZE:**
- "Residential Delivery" (in circled text with other instructions)
- "RESIDENTIAL" (handwritten, all caps, often underlined)
- "residential" (handwritten, lowercase)
- "Residential" (mixed case)
- "Res" (abbreviated)
- "RSDL" (abbreviated)
- "Res Del" (abbreviated)
- "RESIDENTIAL DELIVERY Required" (in sentences)
- "Required RESIDENTIAL" (in sentences)

**CRITICAL RULES:**
- If you see "RESIDENTIAL" or "RES" ANYWHERE in ANY form → return "Yes"
- Circled text counts! If "Residential" is in a circled section → return "Yes"
- Handwritten counts! Even if messy or underlined → return "Yes"
- In a sentence counts! "RESIDENTIAL DELIVERY Required" → return "Yes"
- Multiple delivery services listed together? Check if residential is one of them → return "Yes"
- DO NOT guess based on address - only mark if you see the word "residential" or "res"

**EXAMPLES THAT SHOULD RETURN "Yes":**
✓ "Residential Delivery" (even if circled with other text)
✓ "LIFTGATE Required RESIDENTIAL DELIVERY Required" (in a sentence)
✓ Handwritten "RESIDENTIAL" in table area (even if underlined)
✓ "residential" (lowercase, handwritten)
✓ "(DEL) Residential Delivery FOR ALL DELIVERIES" (in instructions)
✓ "Res" or "RSDL" (abbreviated forms)

EXTRACTION RULE:
- Return "Yes" if you see the word "RESIDENTIAL", "RESIDENCE", or "RES" in ANY location, ANY format
- Return "" ONLY if you have carefully checked the entire document and found NO mention of residential
- Default to "Yes" if uncertain and you see something that might be residential

═══════════════════════════════════════════════════════════════

**FIELD 12: OVER LENGTH (dimensional charges)**
⚠️ CRITICAL: MUST BE IN INCHES, NOT FEET

**⚠️⚠️⚠️ ABSOLUTE RULE - THE 97-INCH THRESHOLD ⚠️⚠️⚠️**
If ALL dimensions are LESS than 97 inches → return "" (empty string)
Only return a range if the LONGEST dimension is 97 inches or MORE.

WHAT TO LOOK FOR:
- Labels: "Length", "L", "Length-in", "Width-in", "Height-in", dimensions
- Location: Item description tables, measurements section
- Format: Numbers followed by units (may be in inches OR feet)

**STEP-BY-STEP CALCULATION (FOLLOW EXACTLY):**
1. **Find ALL three dimensions** (length, width, height) from the table
2. **Check the units** - are they in inches or feet?
3. **Convert to inches if needed:**
   - If units say "in" or no unit → already in inches
   - If units say "ft" or "'" → multiply by 12 to convert to inches
4. **Identify the LONGEST of the three dimensions** (after conversion)
5. **STOP AND CHECK: Is the longest dimension LESS than 97?**
   - If YES (< 97) → return "" immediately, DO NOT classify
   - If NO (≥ 97) → proceed to step 6
6. **Apply classification ONLY if longest dimension ≥ 97 inches:**

**CLASSIFICATION (based on longest dimension in inches):**
- **97-144 inches** → return "97-144"
- **145-192 inches** → return "145-192"
- **193-240 inches** → return "193-240"
- **241+ inches** → return "241 or more"
- **Under 97 inches** → return "" (EMPTY STRING - NO CHARGE)

**EXAMPLES - STUDY THESE CAREFULLY:**
✓ CORRECT: Length=48, Width=40, Height=23 → Longest=48 → 48 < 97 → Return ""
✓ CORRECT: Length=96, Width=50, Height=45 → Longest=96 → 96 < 97 → Return ""
✓ CORRECT: Length=96.9, Width=50, Height=45 → Longest=96.9 → 96.9 < 97 → Return ""
✓ CORRECT: Length=97, Width=50, Height=45 → Longest=97 → 97 ≥ 97 → Return "97-144"
✓ CORRECT: Length=100, Width=50, Height=45 → Longest=100 → 100 ≥ 97 → Return "97-144"
✓ CORRECT: Length=8 ft, Width=6 ft, Height=4 ft → Convert: 96in, 72in, 48in → Longest=96 → 96 < 97 → Return ""
✓ CORRECT: Length=10 ft, Width=5 ft, Height=4 ft → Convert: 120in, 60in, 48in → Longest=120 → 120 ≥ 97 → Return "97-144"
✗ WRONG: Length=96 → Return "97-144" (NO! 96 < 97, must return "")
✗ WRONG: Length=47.5 → Return "97-144" (NO! 47.5 < 97, must return "")

**DOUBLE-CHECK BEFORE RETURNING:**
Before you return ANY over length value, ask yourself:
"Is the longest dimension I found actually 97 inches or more?"
If the answer is NO → return ""
If the answer is YES → return the appropriate range

EXTRACTION RULE:
- Return one of: "97-144", "145-192", "193-240", "241 or more", or ""
- Return "" if longest dimension < 97 inches OR if dimensions not found
- ALWAYS verify: Is longest dimension ≥ 97? If NO → return ""

═══════════════════════════════════════════════════════════════

**FIELD 13: PALLET COUNT**
WHAT TO LOOK FOR:
- Labels: "Pieces", "Pallets", "Pallet", "Skid", item count
- Location: Item details section
- May be in "Type" or "Description" column

EXTRACTION RULE:
- Return numeric count
- Return 0 if not found

═══════════════════════════════════════════════════════════════

**FIELD 14: DEBRIS REMOVAL SECTION**
WHAT TO LOOK FOR:
- Checkbox or section labeled "Debris Removal"
- Any indication that debris removal service is available/requested
- This is different from Lakeshore client check

EXTRACTION RULE:
- Return true if debris section/checkbox exists
- Return false if not present

═══════════════════════════════════════════════════════════════

**FIELD 15: CLIENT NAME**
WHAT TO LOOK FOR:
- Client name, shipper name, or customer name
- Check if name contains "Lakeshore" anywhere

EXTRACTION RULE:
- Return the full client/shipper name as string
- Return "" if not found

═══════════════════════════════════════════════════════════════

**FIELD 16: TIME-SPECIFIC DELIVERY**

STEP 1 - Is this shipment time-specific at all? Time-specific is indicated ONLY by:
- Handwritten "TS" / "T.S." (usually circled), OR
- Circled/underlined/highlighted times in the "Req Del From/To" line, OR
- A delivery-instruction line that STATES a required window (e.g. "(DEL) 9AM-12NOON")

NOT time-specific (ignore these):
- The printed "Req Del From ... To ..." line ALONE - it appears on every receipt
- The printed "Call Req Before Del" line - that is a phone-call instruction, not a delivery window
- A full-day window (e.g. 08:00-17:00, 09:00-17:00), even if circled

If you are unsure whether a genuine indicator exists at all, return "" and add "timeSpecific" to lowConfidenceFields - do NOT return "REVIEW" for that.

STEP 2 - Read the start and end times, compute window length = end minus start, then apply the FIRST matching rule. Do the comparisons exactly - do not judge by feel:
1. Window length is 30 minutes or less -> "15 Minutes"
2. Window length is 2 hours 30 minutes or less -> "2 Hours"
3. Window END time is 12:00 PM or EARLIER (12:00 PM itself counts) -> "AM Special"
4. No rule matched -> "REVIEW" (an indicator exists but the window fits no category; do NOT guess - a human decides)

"REVIEW" is ONLY for a window you successfully read from a genuine indicator but could not classify with rules 1-3. Trust the rules over intuition: a long window that ends at 12:00 PM IS "AM Special" by rule 3 - do not return "REVIEW" just because the window feels unusual.

WORKED EXAMPLES:
- 08:00 to 12:00 -> length 4h (rules 1,2 fail), ends AT 12:00 PM -> rule 3 -> "AM Special"
- 09:00 to 12:30 -> length 3.5h (rules 1,2 fail), ends AFTER 12:00 PM -> rule 4 -> "REVIEW"
- 10:00 to 12:00 -> length exactly 2h -> rule 2 -> "2 Hours"
- 14:00 to 16:30 -> length 2.5h -> rule 2 -> "2 Hours"

STEP 3 - If no indicator from Step 1: return ""

═══════════════════════════════════════════════════════════════

**FIELD 17: DETENTION**
Detention is wait time at the stop, ALWAYS handwritten when present. It is rare - most BOLs have none. Absence of a note means 0.

WHAT COUNTS AS EVIDENCE:
- A handwritten duration with units: "45 min", "1.5 hr", "detention 40"
- A handwritten arrival/departure time pair (e.g. "in 9:15 out 10:30") - compute the minutes
- Words like "waited", "wait", "det", "detention" next to a number

WHAT DOES NOT COUNT: printed appointment windows, scheduled times, illegible scribbles, the received-by date/time fields.

UNITS RULE: a bare number of 8 or less next to a detention word is HOURS ("waited 2" -> 120); a bare number of 15 or more is MINUTES ("det 45" -> 45).

EXTRACTION RULE:
- "detention": number of MINUTES, 0 if no evidence
- "detentionNote": raw transcription of the handwriting you based it on, "" if none - a human audits the conversion

═══════════════════════════════════════════════════════════════

**OUTPUT FIELDS:**

{
  "pro": "printed identifier only",
  "stopMarker": "handwritten stop marker or empty",
  "pickupState": "2-letter state code",
  "deliveryState": "2-letter state code",
  "zone": "A-L or empty string",
  "deliveryZip": "5-digit ZIP code",
  "deliveryAddress": "full delivery address string",
  "weight": number,
  "volumeFt3": number,
  "liftgate": "Yes" or "",
  "inside": "Yes" or "",
  "residential": "Yes" or "",
  "overLength": "97-144" or "145-192" or "193-240" or "241 or more" or "",
  "palletCount": number,
  "hasDebrisSection": boolean,
  "clientName": "string",
  "timeSpecific": "AM Special" or "2 Hours" or "15 Minutes" or "REVIEW" or "",
  "detention": number,
  "detentionNote": "raw transcription or empty",
  "lowConfidenceFields": ["field names you are unsure about"]
}

**CONFIDENCE:**
List in "lowConfidenceFields" the name of every output field whose value you were not confident about - hard-to-read handwriting, ambiguous marks, conflicting information, or values you had to guess. An empty array means you are confident in every field. Be honest: flagged fields get human review; wrong-but-unflagged fields become billing errors.

**EXTRACTION PROCESS:**
1. Scan the ENTIRE document first
2. Identify the format (traditional BOL vs delivery receipt vs other)
3. Extract pickup state and delivery state FIRST (these determine if it's a fixed-price lane)
4. Locate each field using the labels and locations described above
5. For handwritten elements, look EVERYWHERE (margins, bottom, circled text)
6. When in doubt between similar fields, prefer delivery/consignee over pickup/shipper
7. Return empty string "" for missing text fields, 0 for missing numbers, false for missing booleans

**REMEMBER:**
- Pickup state and delivery state are critical for lane identification
- Zone is ALWAYS the delivery zone
- Delivery ZIP is ALWAYS from delivery address
- Check both printed and handwritten areas for services`,
          cache_control: { type: 'ephemeral' } // ✅ ENABLES PROMPT CACHING
        }
      ],
      messages: [{
        role: 'user',
        content: [{
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pageBase64 },
        }, {
          type: 'text',
          text: 'Please extract all the BOL data fields according to the system instructions provided.'
        }]
      }]
    });

    // Structured outputs guarantee schema-valid JSON — but only on a normal
    // stop. A refusal or token cutoff can leave the content unusable.
    if (message.stop_reason === 'refusal') {
      throw new Error('Model refused to process this page');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Extraction output was truncated (max_tokens) — raise the limit');
    }

    const textContent = message.content.find((c) => c.type === 'text')?.text;
    const extractedData = JSON.parse(textContent);
    if (!Array.isArray(extractedData.lowConfidenceFields)) {
      extractedData.lowConfidenceFields = [];
    }

    const { zipToZone, priceTable, accessorials } = config.contract;
    const validZones = Object.keys(priceTable);

    // Fixed-price line-haul runs are entered MANUALLY in the UI (customer-
    // confirmed workflow, 2026-07-03). Auto-detection by pickup/delivery
    // state pair was removed: any interstate LTL delivery (e.g. a CA-origin
    // package delivered in GA) matches a lane pair and would false-positive
    // a $6,000 run. config.contract.fixedLanes now only feeds the manual UI.
    extractedData.isFixedLane = false;

    if (!extractedData.zone || !validZones.includes(extractedData.zone.toUpperCase())) {
      const zipCode = extractedData.deliveryZip?.replace(/\D/g, '').substring(0, 5);

      if (zipCode && zipToZone[zipCode]) {
        extractedData.zone = zipToZone[zipCode];
        extractedData.zoneSource = 'ZIP';
        console.log(`  🗺️ Zone from ZIP ${zipCode}: ${extractedData.zone}`);
      } else {
        extractedData.zone = 'QUOTE';
        extractedData.zoneSource = 'UNKNOWN';
        console.warn(`  ⚠️ No zone/ZIP match - requires quote`);
      }
    } else {
      extractedData.zoneSource = 'BOL';
      console.log(`  ✓ Zone found on BOL: ${extractedData.zone}`);
    }

    // "Lakeshore" generalized: any configured client-name trigger marks the
    // shipment as always-debris (field name kept for compatibility).
    const triggers = accessorials.debrisRemoval?.clientNameTriggers || [];
    const clientLower = (extractedData.clientName || '').toLowerCase();
    extractedData.isLakeshore = triggers.some((t) => clientLower.includes(String(t).toLowerCase()));

    return {
      pageNumber,
      data: textContent,
      ...extractedData
    };
  } catch (error) {
    console.error(`Error processing page ${pageNumber}:`, error);
    throw error;
  }
}

// Extract every page of a document. Page 1 runs alone first: its response
// writes the prompt cache that the remaining pages read at ~10% of the input
// price (parallel-from-cold would make every page pay full prompt cost).
// The rest run with bounded concurrency; the SDK's maxRetries absorbs
// transient 429/5xx errors.
async function extractAllPages(pages, config, { concurrency = 3, onPage } = {}) {
  const results = new Array(pages.length);

  const run = async (page) => {
    try {
      console.log(`  ⏳ Processing page ${page.pageNumber}/${pages.length}...`);
      const result = await processPage(page.base64, page.pageNumber, config);
      results[page.pageNumber - 1] = { ...result, success: true, error: null };
      console.log(`  ✅ Page ${page.pageNumber} completed`);
    } catch (error) {
      console.error(`  ❌ Page ${page.pageNumber} failed:`, error.message);
      results[page.pageNumber - 1] = {
        pageNumber: page.pageNumber,
        success: false,
        error: error.message,
        data: null,
      };
    }
    if (onPage) onPage(results[page.pageNumber - 1]);
  };

  if (pages.length === 0) return results;
  await run(pages[0]); // cache warmer

  const queue = pages.slice(1);
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      await run(queue.shift());
    }
  });
  await Promise.all(workers);

  return results;
}

module.exports = { splitPdfPages, processPage, extractAllPages };
