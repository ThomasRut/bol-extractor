#!/usr/bin/env node
// BOL extraction regression harness (blueprint Prompt D).
//
// Modes:
//   node test/run-regression.js          diff cached extractions vs expected (no API calls)
//   node test/run-regression.js --live   re-extract every page via the API, refresh the
//                                        cache, then diff (run after prompt/model changes)
//
// Fixtures live in test/fixtures/ (GITIGNORED — real customer documents):
//   config.json           { "samplePdf": "<absolute path to sample scan>" }
//   expected/page-N.json  hand-verified ground truth. Only the fields present are
//                         compared. Matchers: exact value, {"contains": s},
//                         {"containsAny": [s,...]}, numbers compared with 0.011 tolerance.
//                         "__skipFields": [...] skips fields whose truth is pending
//                         (see "_notes" in each file).
//   cached/page-N.json    the last live extraction results.
//
// Exit code 0 = all comparisons pass (or fixtures absent — skipped with a warning).

const fs = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, 'fixtures');
const EXPECTED_DIR = path.join(FIXTURES, 'expected');
const CACHED_DIR = path.join(FIXTURES, 'cached');
const LIVE = process.argv.includes('--live');
const DELAY_MS = 1200;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function matches(expected, actual) {
  if (expected !== null && typeof expected === 'object') {
    if ('contains' in expected) {
      return String(actual ?? '').toLowerCase().includes(String(expected.contains).toLowerCase());
    }
    if ('containsAny' in expected) {
      const hay = String(actual ?? '').toLowerCase();
      return expected.containsAny.some((s) => hay.includes(String(s).toLowerCase()));
    }
    return false;
  }
  if (typeof expected === 'number') {
    return Math.abs(Number(actual) - expected) < 0.011;
  }
  if (typeof expected === 'string') {
    return String(actual ?? '') === expected;
  }
  return actual === expected; // booleans, null
}

async function extractLive() {
  const configPath = path.join(FIXTURES, 'config.json');
  const { samplePdf } = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const { splitPdfPages, processPage } = require('../extraction');
  const { loadCustomerConfig } = require('../config-loader');
  const customerConfig = loadCustomerConfig();

  console.log(`Extracting: ${samplePdf}`);
  const pdfBase64 = fs.readFileSync(samplePdf).toString('base64');
  const pages = await splitPdfPages(pdfBase64);
  fs.mkdirSync(CACHED_DIR, { recursive: true });

  for (const page of pages) {
    process.stdout.write(`  page ${page.pageNumber}/${pages.length}... `);
    try {
      const result = await processPage(page.base64, page.pageNumber, customerConfig);
      delete result.data; // raw model text — noisy, not needed for diffing
      fs.writeFileSync(
        path.join(CACHED_DIR, `page-${page.pageNumber}.json`),
        JSON.stringify(result, null, 2)
      );
      console.log('ok');
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      fs.writeFileSync(
        path.join(CACHED_DIR, `page-${page.pageNumber}.json`),
        JSON.stringify({ pageNumber: page.pageNumber, __error: err.message }, null, 2)
      );
    }
    if (page.pageNumber < pages.length) await delay(DELAY_MS);
  }
}

function diff() {
  const expectedFiles = fs
    .readdirSync(EXPECTED_DIR)
    .filter((f) => /^page-\d+\.json$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10));

  let failures = 0;
  let comparisons = 0;
  let skips = 0;

  for (const file of expectedFiles) {
    const expected = JSON.parse(fs.readFileSync(path.join(EXPECTED_DIR, file), 'utf-8'));
    const cachedPath = path.join(CACHED_DIR, file);
    console.log(`\n=== ${file} ===`);

    if (!fs.existsSync(cachedPath)) {
      console.log('  ✗ no cached extraction — run with --live first');
      failures++;
      continue;
    }
    const actual = JSON.parse(fs.readFileSync(cachedPath, 'utf-8'));
    if (actual.__error) {
      console.log(`  ✗ extraction errored: ${actual.__error}`);
      failures++;
      continue;
    }

    const skipFields = new Set(expected.__skipFields || []);
    for (const [field, want] of Object.entries(expected)) {
      if (field.startsWith('_')) continue;
      if (skipFields.has(field)) {
        console.log(`  ~ ${field}: skipped (${expected._notes?.[field] || 'ground truth pending'})`);
        skips++;
        continue;
      }
      comparisons++;
      const got = actual[field];
      if (matches(want, got)) {
        console.log(`  ✓ ${field}`);
      } else {
        console.log(`  ✗ ${field}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
        failures++;
      }
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`${comparisons} comparisons | ${failures} failures | ${skips} fields skipped`);
  return failures;
}

(async () => {
  if (!fs.existsSync(EXPECTED_DIR)) {
    console.warn('⚠️ test/fixtures/expected/ not found — extraction regression skipped');
    console.warn('   (fixtures contain real customer data and only exist on the dev machine)');
    process.exit(0);
  }
  if (LIVE) await extractLive();
  const failures = diff();
  process.exit(failures > 0 ? 1 : 0);
})();
