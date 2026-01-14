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

// ============== ZIP CODE TO ZONE LOOKUP TABLE ==============
const ZIP_TO_ZONE = {
  "30002": "C", "30003": "E", "30004": "F", "30005": "F", "30006": "D", "30007": "D", "30008": "C",
  "30009": "E", "30010": "E", "30011": "H", "30012": "E", "30013": "E", "30014": "G", "30015": "F",
  "30016": "F", "30017": "F", "30018": "G", "30019": "G", "30021": "C", "30022": "E", "30023": "E",
  "30024": "F", "30025": "H", "30026": "E", "30028": "H", "30029": "E", "30030": "C", "30031": "C",
  "30032": "C", "30033": "C", "30034": "C", "30035": "C", "30036": "C", "30037": "C", "30038": "D",
  "30039": "E", "30040": "G", "30041": "H", "30042": "F", "30043": "F", "30044": "E", "30045": "F",
  "30046": "F", "30047": "E", "30048": "E", "30049": "F", "30052": "F", "30054": "F", "30055": "H",
  "30056": "I", "30058": "D", "30060": "D", "30061": "D", "30062": "D", "30063": "D", "30064": "D",
  "30065": "D", "30066": "E", "30067": "D", "30068": "D", "30069": "C", "30070": "F", "30071": "E",
  "30072": "C", "30074": "D", "30075": "E", "30076": "E", "30077": "E", "30078": "E", "30079": "C",
  "30080": "C", "30081": "C", "30082": "C", "30083": "C", "30084": "D", "30085": "D", "30086": "D",
  "30087": "D", "30088": "C", "30090": "D", "30091": "D", "30092": "E", "30093": "D", "30094": "D",
  "30095": "E", "30096": "E", "30097": "F", "30098": "E", "30099": "E", "30101": "E", "30102": "F",
  "30103": "J", "30104": "H", "30105": "L", "30106": "C", "30107": "H", "30108": "H", "30109": "G",
  "30110": "G", "30111": "C", "30112": "F", "30113": "H", "30114": "G", "30115": "G", "30116": "F",
  "30117": "G", "30118": "G", "30119": "F", "30120": "H", "30121": "G", "30122": "B", "30123": "H",
  "30124": "J", "30125": "I", "30126": "B", "30127": "D", "30129": "K", "30132": "F", "30133": "C",
  "30134": "D", "30135": "C", "30137": "G", "30138": "J", "30139": "J", "30140": "H", "30141": "D",
  "30142": "F", "30143": "J", "30144": "E", "30145": "I", "30146": "F", "30147": "J", "30148": "J",
  "30149": "J", "30150": "G", "30151": "I", "30152": "E", "30153": "G", "30154": "C", "30156": "E",
  "30157": "E", "30160": "E", "30161": "J", "30162": "J", "30163": "G", "30164": "J", "30165": "K",
  "30168": "B", "30169": "F", "30170": "H", "30171": "I", "30172": "J", "30173": "I", "30175": "K",
  "30176": "H", "30177": "I", "30178": "G", "30179": "F", "30180": "E", "30182": "H", "30183": "H",
  "30184": "H", "30185": "E", "30187": "D", "30188": "F", "30189": "F", "30204": "H", "30205": "E",
  "30206": "G", "30212": "E", "30213": "B", "30214": "C", "30215": "D", "30216": "H", "30217": "H",
  "30218": "G", "30219": "F", "30220": "G", "30222": "H", "30223": "E", "30224": "F", "30228": "D",
  "30229": "F", "30230": "H", "30233": "G", "30234": "F", "30236": "C", "30237": "C", "30238": "C",
  "30240": "J", "30241": "I", "30248": "F", "30250": "D", "30251": "G", "30252": "E", "30253": "D",
  "30256": "H", "30257": "G", "30258": "H", "30259": "F", "30260": "B", "30261": "I", "30263": "F",
  "30264": "E", "30265": "D", "30266": "G", "30268": "C", "30269": "D", "30270": "D", "30271": "E",
  "30272": "A", "30273": "C", "30274": "B", "30275": "E", "30276": "E", "30277": "D", "30281": "C",
  "30284": "E", "30285": "I", "30286": "J", "30287": "B", "30288": "B", "30289": "E", "30290": "C",
  "30291": "B", "30292": "F", "30293": "H", "30294": "C", "30295": "G", "30296": "B", "30297": "B",
  "30298": "B", "30301": "B", "30302": "B", "30303": "B", "30304": "B", "30305": "C", "30306": "B",
  "30307": "B", "30308": "B", "30309": "B", "30310": "A", "30311": "A", "30312": "B", "30313": "B",
  "30314": "B", "30315": "A", "30316": "B", "30317": "B", "30318": "B", "30319": "C", "30320": "A",
  "30321": "A", "30322": "B", "30324": "C", "30325": "B", "30326": "C", "30327": "C", "30328": "D",
  "30329": "C", "30331": "B", "30332": "B", "30333": "B", "30334": "B", "30336": "B", "30337": "A",
  "30338": "D", "30339": "C", "30340": "D", "30341": "D", "30342": "C", "30343": "B", "30344": "A",
  "30345": "C", "30346": "D", "30348": "B", "30349": "A", "30350": "D", "30353": "B", "30354": "A",
  "30355": "B", "30356": "D", "30357": "B", "30358": "B", "30359": "C", "30360": "D", "30361": "B",
  "30362": "D", "30363": "B", "30364": "B", "30366": "C", "30368": "B", "30369": "B", "30370": "B",
  "30371": "B", "30374": "B", "30375": "B", "30377": "B", "30378": "B", "30380": "B", "30384": "B",
  "30385": "B", "30388": "B", "30392": "B", "30394": "B", "30396": "B", "30398": "B", "30501": "J",
  "30502": "I", "30503": "J", "30504": "I", "30506": "J", "30507": "J", "30515": "G", "30517": "I",
  "30518": "G", "30519": "H", "30527": "L", "30529": "L", "30533": "L", "30534": "J", "30536": "L",
  "30539": "L", "30540": "L", "30542": "H", "30543": "K", "30548": "I", "30549": "J", "30554": "L",
  "30558": "L", "30564": "K", "30565": "L", "30566": "I", "30567": "J", "30575": "J", "30597": "K",
  "30599": "L", "30601": "L", "30602": "K", "30603": "K", "30604": "K", "30605": "L", "30606": "K",
  "30607": "K", "30608": "K", "30609": "K", "30612": "K", "30620": "H", "30621": "J", "30622": "J",
  "30623": "J", "30625": "K", "30638": "K", "30641": "I", "30645": "J", "30650": "J", "30655": "H",
  "30656": "H", "30663": "I", "30666": "J", "30677": "K", "30680": "I", "30701": "K", "30703": "K",
  "30732": "K", "30733": "K", "30734": "K", "30735": "L", "30746": "L", "31004": "K", "31016": "K",
  "31024": "L", "31026": "L", "31029": "J", "31032": "L", "31038": "K", "31046": "J", "31052": "L",
  "31064": "I", "31066": "L", "31078": "L", "31085": "I", "31086": "J", "31097": "J", "31106": "B",
  "31107": "B", "31119": "B", "31126": "B", "31131": "B", "31136": "B", "31139": "B", "31141": "B",
  "31145": "B", "31146": "B", "31150": "B", "31156": "B", "31169": "D", "31192": "B", "31193": "B",
  "31195": "B", "31196": "B", "31210": "L", "31220": "L", "31816": "J", "31822": "K", "31823": "K",
  "31826": "K", "31827": "L", "31830": "J", "31831": "L", "31833": "L", "31836": "K", "36261": "J",
  "36262": "J", "36263": "I", "36264": "K", "36269": "I", "36273": "I", "36274": "K", "36275": "K",
  "36278": "K", "36280": "J", "36855": "L", "36863": "L", "39901": "B"
};

const VALID_ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
// ============================================================

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

**YOUR TASK:** Extract 13 specific data points from any BOL format.

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

**FIELD 2: ZONE (DELIVERY ZONE)**
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

**FIELD 2B: DELIVERY ZIP CODE** 
⚠️ NEW FIELD - Used as fallback when zone is not explicitly shown

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

**FIELD 3: DELIVERY ADDRESS (FULL)**
WHAT TO LOOK FOR:
- The complete delivery/consignee address including street, city, state, ZIP
- Location: "Deliver To:", "Consignee:", delivery section
- Used for multi-page BOL consolidation

EXTRACTION RULE:
- Return full address as single string
- Return "" if not found

═══════════════════════════════════════════════════════════════

**FIELD 4: WEIGHT**
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

**FIELD 5: VOLUME**
WHAT TO LOOK FOR:
- Labels: "Volume-ft3", "Volume", "Cu Ft", "CF"
- Location: Item details table or totals section
- Format: Cubic feet (ft³)

EXTRACTION RULE:
- Return numeric value only (no units)
- Return 0 if not found

═══════════════════════════════════════════════════════════════

**FIELD 6: LIFTGATE**
WHAT TO LOOK FOR:
- Explicit indicators: "Liftgate", "Lift Gate", "LIFTGATE" (checkbox or text)
- Location: Services section, special services, or handwritten notes
- May be circled or written in margins

⚠️ IMPORTANT: Even handwritten "LIFTGATE" counts

EXTRACTION RULE:
- Return "Yes" if liftgate service is indicated anywhere
- Return "" (empty string) if not present

═══════════════════════════════════════════════════════════════

**FIELD 7: INSIDE DELIVERY**
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

**FIELD 8: RESIDENTIAL DELIVERY**
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

**FIELD 9: OVER LENGTH (dimensional charges)**
⚠️ MUST BE IN INCHES, NOT FEET

WHAT TO LOOK FOR:
- Labels: "Length", "L", "Length-in", "Width-in", "Height-in", dimensions
- Location: Item description tables, measurements section
- Format: May be in inches OR feet - you must identify the LONGEST dimension

CALCULATION STEPS:
1. Find all dimensions (length, width, height)
2. Convert feet to inches if needed (1 foot = 12 inches)
3. Identify the LONGEST dimension
4. Classify based on the ranges below

CLASSIFICATION (based on longest dimension in inches):
- 97-144 inches → "97-144"
- 145-192 inches → "193-240"
- 193-240 inches → "193-240"
- 241+ inches → "241 or more"
- Under 97 inches → "" (empty string, no charge)

EXTRACTION RULE:
- Return one of: "97-144", "145-192", "193-240", "241 or more", or ""
- Return "" if under 97 inches OR dimensions not found

═══════════════════════════════════════════════════════════════

**FIELD 10: PALLET COUNT**
WHAT TO LOOK FOR:
- Labels: "Pieces", "Pallets", "Pallet", "Skid", item count
- Location: Item details section
- May be in "Type" or "Description" column

EXTRACTION RULE:
- Return numeric count
- Return 0 if not found

═══════════════════════════════════════════════════════════════

**FIELD 11: DEBRIS REMOVAL SECTION**
WHAT TO LOOK FOR:
- Checkbox or section labeled "Debris Removal"
- Any indication that debris removal service is available/requested
- This is different from Lakeshore client check

EXTRACTION RULE:
- Return true if debris section/checkbox exists
- Return false if not present

═══════════════════════════════════════════════════════════════

**FIELD 12: LAKESHORE CLIENT**
WHAT TO LOOK FOR:
- Client name, shipper name, or customer name
- Check if name contains "Lakeshore" anywhere

EXTRACTION RULE:
- Return true if "Lakeshore" appears in client/shipper name
- Return false otherwise

═══════════════════════════════════════════════════════════════

**FIELD 13: TIME-SPECIFIC DELIVERY**
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

5. Document shows "Req Del From: 7:00 AM To: 11:00 AM"
   → Check times: 4 hours AND ends before noon → Return "AM Special" ✓

EXTRACTION RULE:
- Return one of: "AM Special", "2 Hours", "15 Minutes", or ""
- Base decision on ACTUAL time window, not "TS" notes
- Return "" if no qualifying time window found

═══════════════════════════════════════════════════════════════

**FIELD 14: DETENTION**
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
  "isLakeshore": boolean,
  "timeSpecific": "AM Special" or "2 Hours" or "15 Minutes" or "",
  "detention": number
}

**EXTRACTION PROCESS:**
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
- Delivery ZIP is ALWAYS from delivery address (fallback for zone determination)
- Over length must be ≥97 inches to count
- Time-specific is determined by ACTUAL time windows, not "TS" notes
- Check both printed and handwritten areas for services`
            },
          ],
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === 'text')?.text;

    // Parse the JSON response
let extractedData;
try {
  let cleanedText = textContent;
  
  // Remove any text before the JSON (like "Looking at this document...")
  const jsonStart = cleanedText.indexOf('{');
  const jsonEnd = cleanedText.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd !== -1) {
    cleanedText = cleanedText.substring(jsonStart, jsonEnd + 1);
  }
  
  // Remove markdown code blocks if present
  cleanedText = cleanedText.replace(/```json\n?|\n?```/g, '').trim();
  
  extractedData = JSON.parse(cleanedText);
  console.log('  ✅ Successfully parsed JSON data');
} catch (parseError) {
  console.error('  ❌ JSON Parse Error:', parseError);
  console.error('  📄 Response Text:', textContent);
  throw new Error('Failed to parse Claude response as JSON');
}

    // ========== ZIP-TO-ZONE FALLBACK LOGIC ==========
    // If zone is missing or invalid, try to determine from delivery ZIP
    if (!extractedData.zone || !VALID_ZONES.includes(extractedData.zone.toUpperCase())) {
      // Clean the ZIP code (remove any non-numeric characters and take first 5 digits)
      const zipCode = extractedData.deliveryZip?.replace(/\D/g, '').substring(0, 5);
      
      if (zipCode && ZIP_TO_ZONE[zipCode]) {
        extractedData.zone = ZIP_TO_ZONE[zipCode];
        extractedData.zoneSource = 'ZIP';
        console.log(`  🗺️  Zone determined from ZIP ${zipCode}: ${extractedData.zone}`);
      } else {
        extractedData.zoneSource = 'BOL';
        if (!extractedData.zone) {
          console.warn(`  ⚠️  No zone found on BOL and ZIP code ${zipCode || 'N/A'} not in lookup table`);
        }
      }
    } else {
      extractedData.zoneSource = 'BOL';
      console.log(`  ✓ Zone found on BOL: ${extractedData.zone}`);
    }
    // ================================================

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
  console.log(`   ✓ Zone with ZIP code fallback`);
  console.log(`   ✓ Delivery address for consolidation`);
  console.log(`   ✓ Over length (97+ inches only)`);
  console.log(`   ✓ Time-specific from "Req Del From:" field`);
  console.log(`   ✓ Debris removal (Lakeshore special rule)`);
  console.log(`   ✓ Inside delivery (handwriting + additional info)`);
  console.log(`   ✓ Detention tracking\n`);
});