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
              text: `You are analyzing a Bill of Lading (BOL). Extract the following information with extreme precision:

**CRITICAL INSTRUCTIONS:**

1. PRO# (job number) - Look for "PRO#", "PRO NUMBER", or similar tracking number
   - This is the unique job identifier
   - May have suffixes like "1A", "1B", "1C" for multi-page deliveries
   - Extract the FULL PRO including any suffix (e.g., "12345-1A", "12345-1B")

2. ZONE - Single letter (A-L) indicating delivery zone location
   - **CRITICAL**: Look in the "Deliver To" section on the RIGHT side
   - Look for "Zone:" field in the delivery/consignee area
   - DO NOT use the pickup/shipper zone
   - Must be uppercase single letter from A through L

3. ACTUAL WEIGHT - Total weight in pounds (sum all line items if multiple)
   - Look for "Weight", "Wt", "LBS", "Pounds"

4. VOLUME - Total volume in cubic feet (ft³)
   - Look in measurements section for ft³ or cubic feet

5. LIFTGATE - String: "Yes" or blank ""
   - Look for ANY indication: printed text, handwritten notes, circled text, checkmarks
   - Keywords: "liftgate", "lift gate", "tailgate"
   - When in doubt, mark as "Yes"
   - Return "Yes" or "" (empty string)

6. INSIDE DELIVERY - String: "Yes" or blank ""
   - **CRITICAL**: Check BOTH printed text AND handwritten notes
   - Look in "Additional Information" section for ANY handwritten text
   - Common phrases: "inside delivery", "inside", "threshold", "room of choice", "I care"
   - Check both printed and handwritten areas
   - Even if just says "inside" or similar notation, mark as "Yes"
   - Return "Yes" or "" (empty string)

7. RESIDENTIAL - String: "Yes" or blank ""
   - ONLY mark "Yes" if you see explicit residential indicators
   - Look for: "residential", "res", "rsdl", residential checkbox marked
   - Do NOT assume based on address format alone
   - Return "Yes" or "" (empty string)

8. OVER LENGTH - String with INCHES range or blank ""
   - **CRITICAL**: Look for dimension information in Length, Width, Height columns
   - **CRITICAL**: Return dimensions in INCHES, not feet
   - **CRITICAL**: Only return a range if the LONGEST dimension is 97 inches or more
   - Return format: "97-144", "145-192", "193-240", "241 or more", or "" (empty string)
   - If longest dimension is 97-144 inches → "97-144"
   - If longest dimension is 145-192 inches → "145-192"
   - If longest dimension is 193-240 inches → "193-240"
   - If longest dimension is 241+ inches → "241 or more"
   - **If longest dimension is UNDER 97 inches → "" (empty string)**
   - If no dimensions found → "" (empty string)

9. DEBRIS REMOVAL - Critical for Lakeshore clients
   - palletCount: Count of pallets/skids (pieces)
   - hasDebrisSection: Boolean - Is there a "debris removal" section/checkbox on the BOL?
   - isLakeshore: Boolean - Does the client/shipper/consignee name contain "Lakeshore"?
   - RULE: Every pallet costs $3 if EITHER debris section exists OR client is Lakeshore

10. TIME SPECIFIC - String or blank ""
    - **CRITICAL**: Look for "Req Del From:" and "To:" fields showing the delivery time window
    - **If NO time window is specified** → "" (empty string)
    
    - **BUSINESS RULES (MUST FOLLOW THIS EXACT PRIORITY):**
    
    **STEP 1 - Check for AM Special:**
    - **If the END time ("To:") is at or before 12:00 PM (noon)** → "AM Special"
    - 12:00 PM = AM Special ✓
    - 12:01 PM = NOT AM Special ✗
    - Examples:
      - "08:00 EST To: 11:00 EST" → "AM Special" (ends before noon)
      - "08:00 EST To: 12:00 EST" → "AM Special" (ends at noon) ✓
      - "Dec 19 25 - 08:00 EST To: Dec 19 25 - 12:00 EST" → "AM Special" (ends at noon) ✓
      - "10:00 EST To: 12:30 EST" → NOT AM Special (ends after noon)
    
    **STEP 2 - If NOT AM Special, check duration:**
    - Calculate: END time minus START time
    - **If duration is 15 minutes or less** → "15 Minutes"
    - **If duration is EXACTLY 2 hours (120 minutes)** → "2 Hours"
    - **If duration is ANYTHING ELSE (not 15 min, not 2 hours)** → "" (empty string)
    
    - **CRITICAL EXAMPLES:**
      - "Dec 19 25 - 08:00 EST To: Dec 19 25 - 12:00 EST" → "AM Special" (ends at noon)
      - "14:00 To: 14:15" → "15 Minutes" (15 min window)
      - "13:00 To: 15:00" → "2 Hours" (exactly 2 hour window)
      - "13:00 To: 16:00" → "" (3 hour window, not valid)
      - "14:00 To: 15:30" → "" (1.5 hour window, not valid)
      - "09:00 To: 12:00" → "AM Special" (ends at noon, ignore duration)
      - "11:45 To: 12:00" → "AM Special" (ends at noon, even though only 15 min)
    
    - **IGNORE:**
      - Handwritten "TS" or "T.S" markings
      - Any other annotations
      - Only use the "Req Del From:" and "To:" fields
    
    - **If "Req Del From:" fields are blank or don't exist** → "" (empty string)
    
    - **CRITICAL**: When checking if time is "at or before 12:00 PM", remember:
      - 12:00 PM (noon) = AM Special ✓
      - 12:00 (in 24-hour format) = AM Special ✓
      - Any time from 00:00 to 12:00 = AM Special ✓
      - 12:01 PM or later = NOT AM Special ✗
    
    - Return exactly one of: "AM Special", "2 Hours", "15 Minutes", or "" (empty string)

11. DETENTION - Number (minutes) or 0
    - Any detention/waiting time noted on BOL
    - Return total minutes waited as a number
    - If no detention, return 0 (not null)

12. DELIVERY ADDRESS - String
    - **NEW FIELD**: Extract the full delivery address (street, city, state, zip)
    - This is used to group multi-page BOLs to the same location
    - Return complete address from "Deliver To" or "Consignee" section
    - Format: "Street, City, State ZIP"

Return ONLY valid JSON in this exact format (no markdown, no backticks):
{
  "pro": "string",
  "zone": "string (single letter A-L)",
  "weight": number,
  "volume": number or 0,
  "liftgate": "Yes" or "",
  "inside": "Yes" or "",
  "residential": "Yes" or "",
  "overLength": "97-144" or "145-192" or "193-240" or "241 or more" or "",
  "palletCount": number,
  "hasDebrisSection": boolean,
  "isLakeshore": boolean,
  "timeSpecific": "AM Special" or "2 Hours" or "15 Minutes" or "",
  "detention": number (minutes, 0 if none),
  "deliveryAddress": "string (full delivery address)"
}

**EXAMPLES:**
- Longest dimension is 94 inches → "overLength": ""
- Longest dimension is 48 inches → "overLength": ""
- Longest dimension is 120 inches → "overLength": "97-144"
- Longest dimension is 180 inches → "overLength": "145-192"
- Req Del From: 8:00 AM - 10:00 AM → "timeSpecific": "AM Special"
- Req Del From: 8:00 AM - 11:59 AM → "timeSpecific": "AM Special"
- Req Del From: 10:00 AM - 12:00 PM → "timeSpecific": "2 Hours"
- Req Del From: 2:00 PM - 2:15 PM → "timeSpecific": "15 Minutes"
- Req Del From: 1:00 PM - 3:00 PM → "timeSpecific": "2 Hours"
- No time requirement → "timeSpecific": ""
- PRO# shows "12345-1A" → "pro": "12345-1A"
- PRO# shows "12345-1B" → "pro": "12345-1B"
- Delivery to "123 Main St, Dallas, TX 75001" → "deliveryAddress": "123 Main St, Dallas, TX 75001"`
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
  console.log(`   ✓ Delivery address for consolidation`);
  console.log(`   ✓ Over length (97+ inches only)`);
  console.log(`   ✓ Time-specific from "Req Del From:" field`);
  console.log(`   ✓ Debris removal (Lakeshore special rule)`);
  console.log(`   ✓ Inside delivery (handwriting + additional info)`);
  console.log(`   ✓ Detention tracking\n`);
});