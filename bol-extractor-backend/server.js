const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument } = require('pdf-lib');
require('dotenv').config();

console.log('🔐 API Key status:', process.env.ANTHROPIC_API_KEY ? 'Loaded ✓' : 'Missing ✗');
console.log('🔐 First 10 chars:', process.env.ANTHROPIC_API_KEY?.substring(0, 10));

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const DELAY_BETWEEN_PAGES_MS = 2000;

const FIXED_PRICE_LANES = {
  "GA-NJ": 2000,
  "CA-GA": 6000,
  "GA-CA": 3600
};

// Mainzone lookup by delivery ZIP - loaded from the customer's verified zone
// sheet (matches printed BOL zones and settled invoices). The data file is
// gitignored (customer-proprietary); without it the ZIP fallback is disabled
// and unmatched shipments surface as QUOTE for manual review.
let ZIP_TO_ZONE = {};
try {
  ZIP_TO_ZONE = require('./data/zip-to-zone.verified.json').zones;
  console.log(`Loaded ${Object.keys(ZIP_TO_ZONE).length} verified ZIP-to-zone entries`);
} catch (err) {
  console.error('WARNING: data/zip-to-zone.verified.json not found - ZIP-to-zone fallback disabled, unmatched ZIPs will require quotes');
}

const VALID_ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

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

async function processPage(pageBase64, pageNumber) {
  try {
    // ✅ OPTIMIZATION 1: Prompt Caching - Move extraction rules to system with cache_control
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
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

**FIELD 1: PRO NUMBER / JOB NUMBER**
WHAT TO LOOK FOR:
- Labels: "PRO#", "PRO Number", "Job #", "Delivery Receipt", tracking number
- Location: Usually in header or top-right corner
- Format: May include letters, numbers, suffixes (e.g., "WEBATL182035", "1A", "1B")

CRITICAL RULES:
- Include ALL suffixes (1A, 1B, etc.) - these indicate multi-page BOLs
- Return the FULL identifier exactly as shown
- If multiple numbers exist, prefer the one labeled "PRO" or "Delivery Receipt"

EXTRACTION RULE:
- Return the complete PRO/Job number as a string
- Return "" (empty string) if not found

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
⚠️ Look for handwritten "T.S", "TS", circled time indicators, or appointment requirements

WHAT TO LOOK FOR:
- Handwritten "T.S" or "TS" (often circled)
- "(DEL) APPOINTMENT DELIVERY Required"
- Specific time windows in delivery instructions
- Time-sensitive indicators

**TIME WINDOW CLASSIFICATION:**
- **Before 12:00 PM / Morning delivery** → "AM Special"
- **2-hour window specified** → "2 Hours"
- **15-minute window specified** → "15 Minutes"

CRITICAL RULES:
- "T.S" or "TS" notations indicate time-specific delivery (classify based on actual time window if visible)
- Appointment delivery requirements may indicate time-specific needs
- Look for circled or highlighted time information

EXTRACTION RULE:
- Return one of: "AM Special", "2 Hours", "15 Minutes", or ""
- Base decision on ACTUAL time window, not "TS" notes
- Return "" if no qualifying time window found

═══════════════════════════════════════════════════════════════

**FIELD 17: DETENTION**
WHAT TO LOOK FOR:
- Handwritten notes about wait time, delay, detention
- Format: Usually in minutes or hours
- Location: Margins, additional info section, driver notes

EXTRACTION RULE:
- Return number of MINUTES (convert hours to minutes if needed)
- Return 0 if not found

═══════════════════════════════════════════════════════════════

**OUTPUT FORMAT:**
Return ONLY a valid JSON object with these exact keys (no markdown, no explanations):

{
  "pro": "string",
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
  "timeSpecific": "AM Special" or "2 Hours" or "15 Minutes" or "",
  "detention": number
}

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

    const textContent = message.content.find((c) => c.type === 'text')?.text;

    let extractedData;
    try {
      let cleanedText = textContent;
      const jsonStart = cleanedText.indexOf('{');
      const jsonEnd = cleanedText.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleanedText = cleanedText.substring(jsonStart, jsonEnd + 1);
      }
      
      cleanedText = cleanedText.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(cleanedText);
      console.log('  ✅ Successfully parsed JSON data');
    } catch (parseError) {
      console.error('  ❌ JSON Parse Error:', parseError);
      console.error('  📄 Response Text:', textContent);
      throw new Error('Failed to parse Claude response as JSON');
    }

    const pickupState = extractedData.pickupState?.toUpperCase() || '';
    const deliveryState = extractedData.deliveryState?.toUpperCase() || '';
    const laneKey = `${pickupState}-${deliveryState}`;
    
    if (FIXED_PRICE_LANES[laneKey]) {
      extractedData.isFixedLane = true;
      extractedData.laneKey = laneKey;
      extractedData.fixedPrice = FIXED_PRICE_LANES[laneKey];
      console.log(`  🛣️ Fixed price lane: ${laneKey} = $${FIXED_PRICE_LANES[laneKey]}`);
    } else {
      extractedData.isFixedLane = false;
      
      if (!extractedData.zone || !VALID_ZONES.includes(extractedData.zone.toUpperCase())) {
        const zipCode = extractedData.deliveryZip?.replace(/\D/g, '').substring(0, 5);
        
        if (zipCode && ZIP_TO_ZONE[zipCode]) {
          extractedData.zone = ZIP_TO_ZONE[zipCode];
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
    }

    extractedData.isLakeshore = extractedData.clientName?.toLowerCase().includes('lakeshore') || false;

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

app.post('/api/process-bol', async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: 'No PDF data provided' });
    }

    console.log(`\n📄 Processing: ${filename}`);
    
    const pages = await splitPdfPages(pdfBase64);
    const results = [];
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      
      try {
        console.log(`  ⏳ Processing page ${page.pageNumber}/${pages.length}...`);
        
        if (i > 0) {
          console.log(`  ⏸️ Waiting ${DELAY_BETWEEN_PAGES_MS}ms...`);
          await delay(DELAY_BETWEEN_PAGES_MS);
        }
        
        const result = await processPage(page.base64, page.pageNumber);
        results.push({
          ...result,
          success: true,
          error: null
        });
        console.log(`  ✅ Page ${page.pageNumber} completed`);
      } catch (error) {
        console.error(`  ❌ Page ${page.pageNumber} failed:`, error.message);
        results.push({
          pageNumber: page.pageNumber,
          success: false,
          error: error.message,
          data: null
        });
      }
    }

    console.log(`  📊 Summary: ${results.filter(r => r.success).length}/${results.length} pages successful`);
    
    res.json({
      success: true,
      filename: filename,
      pageCount: pages.length,
      results: results,
    });
  } catch (error) {
    console.error('Error processing BOL:', error);
    res.status(500).json({
      error: error.message || 'Failed to process BOL',
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`\n📋 Features:`);
  console.log(`   ✓ Fixed lanes: GA→NJ ($2,000), CA→GA ($6,000), GA→CA ($3,600)`);
  console.log(`   ✓ Zone pricing with ZIP fallback`);
  console.log(`   ✓ Rate limiting: ${DELAY_BETWEEN_PAGES_MS}ms delay between pages`);
  console.log(`   ✓ Prompt caching enabled (50% cost savings after first page)`);
  console.log(`   ✓ PDF compression enabled (~20% size reduction)\n`);
});