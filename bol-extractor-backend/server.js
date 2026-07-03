const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { splitPdfPages, processPage } = require('./extraction');


const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const DELAY_BETWEEN_PAGES_MS = 2000;


app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
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