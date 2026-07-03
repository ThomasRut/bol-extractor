// Loads the active customer's business-rule config (see config/README.md).
// Every pricing/zone/lane constant the app uses comes from this file —
// onboarding a new customer must never require a code change.
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config', 'customers');

function loadCustomerConfig(customerId) {
  const id = customerId || process.env.CUSTOMER_ID || 'just-great-enterprises';
  const file = path.join(CONFIG_DIR, `${id}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Customer config not found: ${file}\n` +
      `Customer configs are gitignored (proprietary contract data) — copy ` +
      `config/customers/_example.json and fill in the customer's contract values.`
    );
  }
  const config = JSON.parse(fs.readFileSync(file, 'utf-8'));

  for (const key of ['priceTable', 'accessorials', 'zipToZone', 'fixedLanes']) {
    if (!config.contract || typeof config.contract[key] !== 'object') {
      throw new Error(`Customer config ${id} is missing contract.${key}`);
    }
  }
  return config;
}

module.exports = { loadCustomerConfig };
