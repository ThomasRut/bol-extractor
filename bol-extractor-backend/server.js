const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { splitPdfPages, extractAllPages } = require('./extraction');
const { loadCustomerConfig } = require('./config-loader');

// All business rules (rates, zones, lanes) come from the active customer's
// config — selected by CUSTOMER_ID env var. Fails fast if missing.
const customerConfig = loadCustomerConfig();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PAGE_CONCURRENCY = 3;

// Correction log (blueprint Phase 1): every inline fix the biller makes is
// appended here — over time this shows which fields the model actually gets
// wrong, which drives the next prompt iteration. Lives in data/ (gitignored).
const CORRECTIONS_FILE = path.join(__dirname, 'data', 'corrections.jsonl');


app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// The frontend prices with the same config the backend extracts with.
// zipToZone is stripped — it's large and only the backend needs it.
app.get('/api/customer-config', (req, res) => {
  const { zipToZone, ...contract } = customerConfig.contract;
  res.json({ ...customerConfig, contract });
});

// Append one inline correction from the review UI. JSONL, one entry per fix.
app.post('/api/corrections', (req, res) => {
  try {
    const { pro, field, oldValue, newValue, wasFlagged, zoneSource, filename } = req.body || {};
    if (!field) {
      return res.status(400).json({ error: 'field is required' });
    }
    const entry = {
      at: new Date().toISOString(),
      customerId: customerConfig.customerId,
      pro, field, oldValue, newValue,
      wasFlagged: !!wasFlagged,
      zoneSource, filename,
    };
    fs.mkdirSync(path.dirname(CORRECTIONS_FILE), { recursive: true });
    fs.appendFileSync(CORRECTIONS_FILE, JSON.stringify(entry) + '\n');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Which fields get corrected most — the accuracy dashboard in embryo.
app.get('/api/corrections/summary', (req, res) => {
  try {
    if (!fs.existsSync(CORRECTIONS_FILE)) {
      return res.json({ total: 0, flagged: 0, unflagged: 0, byField: {} });
    }
    const lines = fs.readFileSync(CORRECTIONS_FILE, 'utf-8').split('\n').filter(Boolean);
    const byField = {};
    let flagged = 0;
    for (const line of lines) {
      const e = JSON.parse(line);
      byField[e.field] = (byField[e.field] || 0) + 1;
      if (e.wasFlagged) flagged++;
    }
    // unflagged corrections are the dangerous ones — errors the model was
    // confident about
    res.json({ total: lines.length, flagged, unflagged: lines.length - flagged, byField });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/process-bol', async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: 'No PDF data provided' });
    }

    console.log(`\n📄 Processing: ${filename}`);

    const pages = await splitPdfPages(pdfBase64);
    const results = await extractAllPages(pages, customerConfig, { concurrency: PAGE_CONCURRENCY });

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
  console.log(`   ✓ Fixed lanes: ${Object.keys(c.fixedLanes).join(', ') || 'none'} (manual entry)`);
  console.log(`   ✓ Pages: warm-then-fan-out, ${PAGE_CONCURRENCY} in flight, SDK retries on 429/5xx\n`);
});