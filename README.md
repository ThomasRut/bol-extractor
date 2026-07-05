# BOL Extractor

Turns scanned freight paperwork (Bills of Lading / delivery receipts) into a
settlement-ready spreadsheet. Claude vision extracts ~19 fields per page —
including handwritten annotations like circled "LIFTGATE", time-window marks,
and driver stop numbers — then a config-driven pricing engine computes the
charges a biller would calculate by hand, ready to reconcile against the
carrier's settlement.

## How it works

```
PDF upload → split pages → Claude extraction (structured outputs, per-field
confidence) → multi-page/multi-BOL consolidation → pricing from the customer's
contract config → review UI (low-confidence highlighting, click-to-correct,
manual line-haul entry) → copy/CSV into the dispatch spreadsheet
```

- **`bol-extractor-backend/`** — Express server (port 3001). Splits PDFs,
  calls Claude (warm-then-fan-out concurrency, SDK retries), applies zone /
  business rules from config, logs review corrections to `data/corrections.jsonl`.
- **`bol-extractor-frontend/`** — React app (port 3000). Upload, review table
  with confidence highlighting and inline correction, fixed-lane manual entry,
  Excel-ready export.
- **`config/`** — per-customer business rules (rates, zones, accessorials,
  lanes). Onboarding a customer is a config file, not a code change — see
  `config/README.md`. Real customer configs are **gitignored**; only the
  fabricated `_example.json` is committed.

## Setup

Prerequisites: Node.js 18+, an Anthropic API key.

```bash
# Backend
cd bol-extractor-backend
npm install
echo ANTHROPIC_API_KEY=sk-ant-... > .env
# create config/customers/<id>.json from _example.json, then:
# (optional) set CUSTOMER_ID=<id> — defaults to the first customer
node server.js          # http://localhost:3001

# Frontend
cd bol-extractor-frontend
npm install
npm start               # http://localhost:3000
```

## Testing

Two regression layers keep prompt/model/rate changes honest:

| Command | What it does | API cost |
|---|---|---|
| `cd bol-extractor-frontend && npm test` | Full suite: consolidation, pricing engine, and a settlement regression that replays real reconciled invoice rows (fixture gitignored; suite skips without it) | none |
| `cd bol-extractor-backend && npm test` | Diffs cached extractions against hand-verified per-page expected fixtures (gitignored) | none |
| `cd bol-extractor-backend && npm run test:live` | Re-extracts the sample document via the API, refreshes the cache, then diffs — run after any prompt/model/schema change | ~$0.20 |

Historical settlement fixtures embed a **contract snapshot** of the rates in
force when their rows settled, so legitimate rate changes never break history.

## Key design decisions

- **Config-driven rules**: every rate, cap, bracket, zone map, and
  consolidation behavior lives in the customer config. No hardcoded business
  logic.
- **Structured outputs**: extraction responses are schema-guaranteed; enum
  fields can't drift from the strings pricing switches on.
- **Human-in-the-loop**: the model self-reports low-confidence fields
  (highlighted amber), ambiguous time windows surface as red "REVIEW" instead
  of a guessed charge, and every inline correction is logged for accuracy
  analysis (`GET /api/corrections/summary`).
- **Fixed-price line-haul runs are entered manually** — auto-detecting them
  from BOL state pairs false-positives on interstate LTL deliveries.
- **Customer data never enters git**: contract configs, extraction fixtures,
  settlement rows, correction logs, and `.env` are all gitignored.

## License

MIT
