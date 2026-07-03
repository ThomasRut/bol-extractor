const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { splitPdfPages, processPage } = require('./extraction');
const { loadCustomerConfig } = require('./config-loader');

// All business rules (rates, zones, lanes) come from the active customer's
// config — selected by CUSTOMER_ID env var. Fails fast if missing.
const customerConfig = loadCustomerConfig();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const DELAY_BETWEEN_PAGES_MS = 2000;


app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// The frontend prices with the same config the backend extracts with.
// zipToZone is stripped — it's large and only the backend needs it.
app.get('/api/customer-config', (req, res) => {
  const { zipToZone, ...contract } = customerConfig.contract;
  res.json({ ...customerConfig, contract });
});

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
        
        const result = await processPage(page.base64, page.pageNumber, customerConfig);
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
  const c = customerConfig.contract;
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`\n📋 Active customer: ${customerConfig.customerName} (${customerConfig.customerId})`);
  console.log(`   ✓ Contract: ${c.carrier}`);
  console.log(`   ✓ Zones: ${Object.keys(c.priceTable).join('')} | ZIP map: ${Object.keys(c.zipToZone).length} entries`);
  console.log(`   ✓ Fixed lanes: ${Object.keys(c.fixedLanes).join(', ') || 'none'}`);
  console.log(`   ✓ Rate limiting: ${DELAY_BETWEEN_PAGES_MS}ms delay between pages\n`);
});