const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument } = require('pdf-lib');
require('dotenv').config();

// Debug logging - REMOVE AFTER TESTING
console.log('🔑 API Key status:', process.env.ANTHROPIC_API_KEY ? 'Loaded ✓' : 'Missing ✗');
console.log('🔑 First 10 chars:', process.env.ANTHROPIC_API_KEY?.substring(0, 10));

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

console.log('🔑 API Key status:', process.env.ANTHROPIC_API_KEY ? 'Loaded ✓' : 'Missing ✗');

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Split PDF into individual pages
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
      
      const pdfBytes = await singlePagePdf.save();
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

// Process single page with Claude
async function processPage(pageBase64, pageNumber) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pageBase64,
              },
            },
            {
              type: 'text',
              text: `You are analyzing a Bill of Lading (BOL) document. BOLs come in many different formats and layouts, but you need to extract the same core information regardless of format.

**DOCUMENT TYPES YOU MAY ENCOUNTER:**
- Traditional freight BOLs (multi-column layout with shipper/consignee sections)
- Delivery Receipt format (simpler layout with pickup/deliver sections)
- Single-page or multi-page BOLs (may have suffixes like 1A, 1B)
- Various carrier formats (different field names and locations)

**YOUR TASK:** Extract 12 specific data points from any BOL format.

═══════════════════════════════════════════════════════════════

**FIELD 1: PRO NUMBER (Job/Tracking Number)**
WHAT TO LOOK FOR:
- Labels: "PRO#", "PRO NUMBER", "Bill of Lading Number", "Delivery Receipt", "Job#", tracking number
- Location: Usually in header or top-right corner
- Format: May include suffixes (12345-1A, 12345-1B) for multi-page BOLs
- Variations: Sometimes just numbers, sometimes alphanumeric

EXTRACTION RULE:
- Extract the COMPLETE number including any suffix
- If you see "1A", "1B", "1C" etc., include it
- Examples: "1003211675", "53880973LN", "WEBATL180948"

═══════════════════════════════════════════════════════════════

**FIELD 2: DELIVERY ZONE (Single Letter A-L)**
⚠️ CRITICAL: This is the DELIVERY/CONSIGNEE zone, NOT pickup/shipper zone

WHAT TO LOOK FOR:
- In "Deliver To:", "Consignee:", "Ship To:" section (usually RIGHT side or bottom)
- Labels: "Zone:", "APC:", "Delivery Zone"
- Format: Single uppercase letter A through L
- Common locations: Next to delivery city/state, in delivery address block

DO NOT USE:
- Pickup zone, shipper zone, origin zone (wrong zone!)
- If you see two zones, use the DELIVERY zone

EXTRACTION RULE:
- Return single uppercase letter: "A", "B", "C"... through "L"
- If zone field is blank but you see delivery address, leave zone empty
- Never guess - only return zone if explicitly stated

═══════════════════════════════════════════════════════════════

**FIELD 3: ACTUAL WEIGHT (pounds)**
WHAT TO LOOK FOR:
- Labels: "Weight", "Wt", "LBS", "Pounds", "Weight-lbs", "GRAND TOTAL"
- Locations: 
  - Commodity description section (per line item)
  - Grand total row at bottom
  - Totals section
- May be split across multiple line items

EXTRACTION RULE:
- If multiple line items, SUM all weights
- Return total weight as number (no units)
- If weight is "3687.93", return 3687.93
- If no weight found, return 0

═══════════════════════════════════════════════════════════════

**FIELD 4: VOLUME (cubic feet)**
WHAT TO LOOK FOR:
- Labels: "Volume", "ft3", "ft³", "cu ft", "cubic feet", "Volume-ft3"
- Location: Usually in measurements section with dimensions
- Format: Decimal number

EXTRACTION RULE:
- Return volume in cubic feet as number
- If "25.56 ft3", return 25.56
- If no volume found, return 0

═══════════════════════════════════════════════════════════════

**FIELD 5: LIFTGATE SERVICE**
⚠️ CHECK EVERYWHERE - this can be printed OR handwritten

WHAT TO LOOK FOR:
- Printed text: "Liftgate", "Lift Gate", "Tailgate", checkboxes
- Handwritten: Circled text, written notes saying "LIFTGATE", "LG"
- Location: Anywhere on document - service sections, additional info, margins, bottom

COMMON INDICATORS:
- Checkbox marked for liftgate
- Handwritten "LIFTGATE" (even if circled or emphasized)
- Service codes or abbreviations

EXTRACTION RULE:
- Return "Yes" if you see ANY indication of liftgate
- Return "" (empty string) if no indication
- When in doubt (text is circled or emphasized), return "Yes"

═══════════════════════════════════════════════════════════════

**FIELD 6: INSIDE DELIVERY**
⚠️ CRITICAL: Check BOTH printed AND handwritten areas

WHAT TO LOOK FOR:
- Printed: "Inside Delivery", "Inside", "Threshold", "Room of Choice"
- Handwritten: Look in "Additional Information", margins, bottom notes
- Common phrases: "inside", "I care", "inside delivery required"
- Location: Service sections, special instructions, delivery notes

WHERE TO CHECK:
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

**FIELD 7: RESIDENTIAL DELIVERY**
WHAT TO LOOK FOR:
- Explicit indicators: "Residential", "Res", "RSDL", residential checkbox
- Location: Service sections, delivery type fields

DO NOT ASSUME:
- Don't guess based on address format alone
- Only mark if explicitly stated

EXTRACTION RULE:
- Return "Yes" only if explicitly marked as residential
- Return "" (empty string) if not marked or unclear

═══════════════════════════════════════════════════════════════

**FIELD 8: OVER LENGTH (dimensional charges)**
⚠️ MUST BE IN INCHES, NOT FEET

WHAT TO LOOK FOR:
- Labels: "Length", "L", "Length-in", "Width-in", "Height-in", dimensions
- Location: Item description tables, measurements section
- Format: May be in inches OR feet - you must identify the LONGEST dimension

CALCULATION STEPS:
1. Find all dimensions (length, width, height)
2. Convert feet to inches if needed (1 foot = 12 inches)
3. Identify the LONGEST dimension
4. Return range ONLY if longest ≥ 97 inches

RETURN VALUES:
- Longest dimension 97-144 inches → "97-144"
- Longest dimension 145-192 inches → "145-192"  
- Longest dimension 193-240 inches → "193-240"
- Longest dimension 241+ inches → "241 or more"
- Longest dimension under 97 inches → "" (empty string)
- No dimensions found → "" (empty string)

EXAMPLES:
- Dimensions: 48" × 40" × 23" → Longest is 48" → Return ""
- Dimensions: 72" × 40" × 14" → Longest is 72" → Return ""
- Dimensions: 120" × 48" × 60" → Longest is 120" → Return "97-144"

═══════════════════════════════════════════════════════════════

**FIELD 9: PALLET COUNT**
WHAT TO LOOK FOR:
- Labels: "Pieces", "# PKGS", "Pallet", "Skids", "QTY", quantity
- Location: Item description section, pieces column
- Format: Whole number

EXTRACTION RULE:
- Count total number of pallets/skids/pieces
- If multiple line items, sum them
- Return as number
- If none found, return 0

═══════════════════════════════════════════════════════════════

**FIELD 10: DEBRIS REMOVAL SECTION**
WHAT TO LOOK FOR:
- Explicit "Debris Removal" checkbox or field on the BOL form itself
- This is about the BOL having a debris section, not handwritten notes

EXTRACTION RULE:
- Return true if BOL form has a "Debris Removal" field/checkbox
- Return false if no such section exists on the form
- This is about form structure, not service requests

═══════════════════════════════════════════════════════════════

**FIELD 11: LAKESHORE CLIENT**
WHAT TO LOOK FOR:
- Customer name, shipper name, consignee name
- Location: "Customer:", "Shipper:", "Consignee:", company fields

EXTRACTION RULE:
- Return true if company name contains "Lakeshore" (any case)
- Return false otherwise
- Check all company name fields

═══════════════════════════════════════════════════════════════

**FIELD 12: TIME-SPECIFIC DELIVERY**
⚠️ ALWAYS BASE DECISION ON ACTUAL TIME WINDOW, NOT JUST "TS" NOTES

WHAT TO LOOK FOR:
- Printed time fields: "Req Del From:", "Delivery Window:", "Appointment Delivery", "PU Ready From:", "To:"
- Time ranges showing specific delivery windows
- Handwritten "T.S" or "TS" notes (but verify against actual times!)

⚠️ CRITICAL RULE: The TIME WINDOW determines the charge, NOT handwritten notes
- Even if someone wrote "TS" or "TIME SPECIFIC", you must check the actual times
- If times don't match any category below, return "" even if "TS" is written

CALCULATION RULES (based on ACTUAL time window shown):

**"AM Special"** - Window ≤ 4 hours AND ends by 12:00 PM (noon)
  Examples that qualify:
  - "8:00 AM - 10:00 AM" (2 hours, ends before noon) ✓
  - "8:00 AM - 11:59 AM" (3h 59m, ends before noon) ✓
  - "7:00 AM - 11:00 AM" (4 hours, ends before noon) ✓
  
  Examples that DO NOT qualify:
  - "8:00 AM - 2:00 PM" (6 hours, too long) ✗
  - "10:00 AM - 12:30 PM" (ends after noon) ✗

**"2 Hours"** - Window is EXACTLY 2 hours (can be any time of day)
  Examples that qualify:
  - "10:00 AM - 12:00 PM" (exactly 2 hours) ✓
  - "1:00 PM - 3:00 PM" (exactly 2 hours) ✓
  - "8:00 AM - 10:00 AM" (exactly 2 hours) ✓
  
  Examples that DO NOT qualify:
  - "8:00 AM - 11:00 AM" (3 hours) ✗
  - "1:00 PM - 2:00 PM" (1 hour) ✗

**"15 Minutes"** - Window is 15 minutes or less
  Examples that qualify:
  - "2:00 PM - 2:15 PM" (exactly 15 minutes) ✓
  - "10:30 AM - 10:45 AM" (exactly 15 minutes) ✓
  - "9:00 AM - 9:10 AM" (10 minutes) ✓
  
**EDGE CASES:**
- If handwritten "TS" exists but NO time window shown → "" (can't verify)
- If time window is 3 hours, 4 hours, 5 hours (but not AM Special criteria) → "" (doesn't match any category)
- If "Appointment Delivery Required" but no specific window → "" (no time constraint)
- All-day windows like "8:00 AM - 5:00 PM" → "" (too broad)
- Date ranges like "Jan 07 26 14:00 To: Jan 07 28 17:00" → "" (multi-day range, not time window)

**EXAMPLE SCENARIOS:**
1. Document shows "TS" written AND "Req Del From: 8:00 AM To: 10:00 AM"
   → Check times: 2-hour window → Return "2 Hours" ✓
   
2. Document shows "TS" written AND "Req Del From: 8:00 AM To: 5:00 PM"
   → Check times: 9-hour window → Return "" (doesn't match categories) ✗
   
3. Document shows "Req Del From: 10:00 AM To: 12:00 PM" (no TS note)
   → Check times: 2-hour window → Return "2 Hours" ✓
   
4. Document shows "TS" written but no time window visible
   → Can't verify → Return "" ✗

5. Document shows "Req Del From: Jan 07 26 14:00 To: Jan 07 28 17:00"
   → This is a DATE range (2 days), not a time window → Return "" ✗

EXTRACTION RULE:
- ALWAYS calculate from actual time window first
- Ignore "TS" notes if times don't match the three categories
- Return "" (empty string) if no qualifying time window exists
- Be precise: "AM Special" has TWO requirements (≤4 hours AND ends by noon)

═══════════════════════════════════════════════════════════════

**FIELD 13: DETENTION TIME**
WHAT TO LOOK FOR:
- Notes about driver waiting, delays, detention
- Location: Handwritten notes, additional info, bottom of document
- Format: Time duration (minutes or hours)

EXTRACTION RULE:
- Convert to total minutes
- "1 hour" → 60
- "30 minutes" → 30
- No detention → 0

═══════════════════════════════════════════════════════════════

**FIELD 14: DELIVERY ADDRESS**
⚠️ USED FOR GROUPING MULTI-PAGE BOLs

WHAT TO LOOK FOR:
- Full delivery address from "Deliver To:" or "Consignee:" section
- Include: street, city, state, ZIP

EXTRACTION RULE:
- Return complete formatted address
- Format: "Street, City, State ZIP"
- Example: "4383 ROSWELL ROAD, ATLANTA, GA 30342"
- This helps group pages 1A, 1B, 1C together

═══════════════════════════════════════════════════════════════

**OUTPUT FORMAT:**
Return ONLY valid JSON (no markdown, no backticks, no explanation):

{
  "pro": "string",
  "zone": "string (A-L)",
  "weight": number,
  "volume": number,
  "liftgate": "Yes" or "",
  "inside": "Yes" or "",
  "residential": "Yes" or "",
  "overLength": "97-144" or "145-192" or "193-240" or "241 or more" or "",
  "palletCount": number,
  "hasDebrisSection": boolean,
  "isLakeshore": boolean,
  "timeSpecific": "AM Special" or "2 Hours" or "15 Minutes" or "",
  "detention": number,
  "deliveryAddress": "string"
}

**EXTRACTION STRATEGY:**
1. Scan the ENTIRE document first
2. Identify the format (traditional BOL vs delivery receipt vs other)
3. Locate each field using the labels and locations described above
4. For handwritten elements, look EVERYWHERE (margins, bottom, circled text)
5. When in doubt between similar fields, prefer delivery/consignee over pickup/shipper
6. Return empty string "" for missing text fields, 0 for missing numbers, false for missing booleans

**REMEMBER:**
- Different BOL formats use different field names for the same data
- Handwritten annotations can appear anywhere
- Zone is ALWAYS the delivery zone
- Over length must be ≥97 inches to count
- Time-specific is determined by ACTUAL time windows, not "TS" notes
- Check both printed and handwritten areas for services`
            },
          ],
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text')?.text;

    // Add logging to see what Claude returns
    console.log('  🔍 Claude response:', textContent);

    return {
      pageNumber,
      data: textContent,
    };
  } catch (error) {
    console.error(`Error processing page ${pageNumber}:`, error);
    throw error;
  }
}  // ← THIS WAS MISSING!

// Process BOL endpoint
app.post('/api/process-bol', async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: 'No PDF data provided' });
    }

    console.log(`\n📄 Processing: ${filename}`);
    
    const pages = await splitPdfPages(pdfBase64);
    
    const results = [];
    for (const page of pages) {
      try {
        console.log(`  ⏳ Processing page ${page.pageNumber}/${pages.length}...`);
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
  console.log(`\n📋 Extraction includes:`);
  console.log(`   ✓ PRO# with suffix detection (1A, 1B, etc.)`);
  console.log(`   ✓ Delivery address for consolidation`);
  console.log(`   ✓ Over length (97+ inches only)`);
  console.log(`   ✓ Time-specific from "Req Del From:" field`);
  console.log(`   ✓ Debris removal (Lakeshore special rule)`);
  console.log(`   ✓ Inside delivery (handwriting + additional info)`);
  console.log(`   ✓ Detention tracking\n`);
});