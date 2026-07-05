import React, { useState, useEffect, useMemo } from 'react';
import { consolidateMultiPageBOLs } from './consolidate';
import { calculateCharges } from './pricing';

function App() {
  // Consolidated shipments (raw extraction data). Priced rows are DERIVED from
  // these, so an inline correction re-prices its row instantly.
  const [shipments, setShipments] = useState([]);
  const [editingCell, setEditingCell] = useState(null); // { row, field }
  const [selectedLane, setSelectedLane] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [fuelSurchargePercent, setFuelSurchargePercent] = useState(0.24);
  const [driverName, setDriverName] = useState('');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [customerConfig, setCustomerConfig] = useState(null);

  // All business rules come from the active customer's config, served by the
  // backend. Nothing can be priced until it loads.
  useEffect(() => {
    fetch('http://localhost:3001/api/customer-config')
      .then((r) => r.json())
      .then((cfg) => {
        setCustomerConfig(cfg);
        setFuelSurchargePercent(cfg.contract.fuelSurchargePercent);
        console.log(`⚙️ Loaded config for ${cfg.customerName}`);
      })
      .catch((err) => {
        console.error('Failed to load customer config — is the backend running?', err);
      });
  }, []);

  const styles = `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
        'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
        sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      background: #f8f9fa;
    }

    .app-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      background: white;
      border-bottom: 1px solid #e5e7eb;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo {
      width: 40px;
      height: 40px;
      background: #3b82f6;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 20px;
    }

    .header-title h1 {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
      margin: 0;
    }

    .header-title p {
      font-size: 12px;
      color: #6b7280;
      margin: 0;
    }

    .settings-btn {
      background: white;
      border: 1px solid #e5e7eb;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: #374151;
      transition: background 0.2s;
    }

    .settings-btn:hover {
      background: #f9fafb;
    }

    .main-content {
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 48px 24px;
      flex: 1;
    }

    .page-header {
      text-align: center;
      margin-bottom: 48px;
    }

    .page-header h2 {
      font-size: 32px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 12px;
    }

    .page-header p {
      font-size: 16px;
      color: #6b7280;
      max-width: 600px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .driver-input-section {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }

    .driver-input-section label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
    }

    .driver-input-section input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      transition: border-color 0.2s;
    }

    .driver-input-section input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .driver-input-section p {
      font-size: 12px;
      color: #6b7280;
      margin-top: 6px;
    }

    .upload-card {
      background: white;
      border-radius: 12px;
      padding: 48px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      margin-bottom: 32px;
    }

    .upload-zone {
      border: 2px dashed #d1d5db;
      border-radius: 8px;
      padding: 64px 32px;
      text-align: center;
      transition: all 0.2s;
      cursor: pointer;
    }

    .upload-zone:hover {
      border-color: #3b82f6;
      background: #f9fafb;
    }

    .upload-zone.dragging {
      border-color: #3b82f6;
      background: #eff6ff;
    }

    .upload-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #eff6ff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .upload-icon svg {
      width: 32px;
      height: 32px;
      color: #3b82f6;
    }

    .upload-zone h3 {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 8px;
    }

    .upload-zone > p {
      font-size: 14px;
      color: #6b7280;
      margin-bottom: 24px;
      line-height: 1.5;
    }

    .select-files-btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: background 0.2s;
    }

    .select-files-btn:hover {
      background: #2563eb;
    }

    .file-size-hint {
      font-size: 12px;
      color: #9ca3af;
      margin-top: 16px;
    }

    .selected-files-section {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      margin-bottom: 24px;
    }

    .selected-files-section h4 {
      font-size: 16px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 16px;
    }

    .file-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }

    .file-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
    }

    .file-item svg {
      width: 20px;
      height: 20px;
      color: #3b82f6;
      flex-shrink: 0;
    }

    .file-item span {
      flex: 1;
      font-size: 14px;
      color: #374151;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .remove-file-btn {
      background: none;
      border: none;
      color: #ef4444;
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background 0.2s;
    }

    .remove-file-btn:hover {
      background: #fee2e2;
    }

    .process-btn {
      width: 100%;
      background: #3b82f6;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .process-btn:hover:not(:disabled) {
      background: #2563eb;
    }

    .process-btn:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }

    .empty-state-card {
      background: white;
      border-radius: 12px;
      padding: 64px 32px;
      text-align: center;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .empty-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 24px;
      background: #f3f4f6;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .empty-icon svg {
      width: 32px;
      height: 32px;
      color: #9ca3af;
    }

    .empty-state-card h3 {
      font-size: 18px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 8px;
    }

    .empty-state-card p {
      font-size: 14px;
      color: #6b7280;
    }

    .loading-container {
      text-align: center;
      padding: 48px;
    }

    .spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #e5e7eb;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .results-container {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .results-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .results-header h3 {
      font-size: 20px;
      font-weight: 600;
      color: #111827;
    }

    .export-buttons {
      display: flex;
      gap: 8px;
    }

    .copy-btn {
      background: white;
      border: 1px solid #e5e7eb;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      color: #374151;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .copy-btn.copied {
      background: #10b981;
      color: white;
      border-color: #10b981;
    }

    .copy-btn:hover {
      background: #f9fafb;
    }

    .export-btn {
      background: white;
      border: 1px solid #e5e7eb;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      color: #374151;
      transition: background 0.2s;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .export-btn:hover {
      background: #f9fafb;
    }

    .table-wrapper {
      overflow-x: auto;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }

    th {
      background: #f9fafb;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      white-space: nowrap;
    }

    td {
      padding: 12px;
      border-bottom: 1px solid #f3f4f6;
      color: #111827;
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover {
      background: #f9fafb;
    }

    .editable-cell {
      cursor: pointer;
    }

    .editable-cell:hover {
      outline: 2px solid #93c5fd;
      outline-offset: -2px;
    }

    .low-confidence {
      background: #fef3c7 !important;
    }

    .review-needed {
      background: #fee2e2 !important;
      color: #b91c1c;
      font-weight: 600;
    }

    .cell-editor {
      width: 110px;
      padding: 4px 6px;
      border: 2px solid #3b82f6;
      border-radius: 4px;
      font-size: 13px;
    }

    .review-legend {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 12px;
      color: #6b7280;
      margin: -8px 0 16px;
    }

    .legend-swatch {
      display: inline-block;
      width: 14px;
      height: 14px;
      border-radius: 3px;
      border: 1px solid #e5e7eb;
    }

    .lane-section {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 24px;
    }

    .lane-section label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 8px;
    }

    .lane-controls {
      display: flex;
      gap: 8px;
    }

    .lane-controls select {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
      background: white;
    }

    .add-lane-btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
    }

    .add-lane-btn:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }

    .lane-section p {
      font-size: 12px;
      color: #6b7280;
      margin-top: 6px;
    }

    .manual-note {
      color: #6b7280;
      font-style: italic;
    }

    .remove-row-btn {
      background: none;
      border: none;
      color: #ef4444;
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      margin-left: 8px;
      padding: 0 4px;
      border-radius: 4px;
    }

    .remove-row-btn:hover {
      background: #fee2e2;
    }

    .settings-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .settings-content {
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
    }

    .settings-content h3 {
      font-size: 20px;
      font-weight: 600;
      color: #111827;
      margin-bottom: 16px;
    }

    .setting-item {
      margin-bottom: 16px;
    }

    .setting-item label {
      display: block;
      font-size: 14px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 8px;
    }

    .setting-item input {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      font-size: 14px;
    }

    .settings-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 24px;
    }

    .cancel-btn {
      background: white;
      border: 1px solid #e5e7eb;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      color: #374151;
    }

    .save-btn {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }
  `;

  // Server accepts 50MB JSON; base64 inflates PDFs ~33%, so cap files at 30MB
  // here with a clear message instead of an opaque server error
  const MAX_FILE_MB = 30;
  const acceptFiles = (files) => {
    const ok = files.filter((f) => f.size <= MAX_FILE_MB * 1024 * 1024);
    if (ok.length < files.length) {
      const skipped = files.filter((f) => f.size > MAX_FILE_MB * 1024 * 1024).map((f) => f.name);
      alert(`These files exceed ${MAX_FILE_MB}MB and were skipped:\n${skipped.join('\n')}`);
    }
    setSelectedFiles(ok);
  };

  const handleFileSelect = async (e) => {
    acceptFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragging(false);
    acceptFiles(Array.from(e.dataTransfer.files).filter(f => f.type === 'application/pdf'));
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDragLeave = () => {
    setDragging(false);
  };

  // Priced rows, derived from shipments — corrections re-price automatically.
  const results = useMemo(() => {
    if (!customerConfig) return [];
    return shipments.map((s) => ({
      ...calculateCharges(s, customerConfig, { fuelSurchargePercent, driverName }),
      filename: s.filename,
      pageNumber: (s.pageNumbers || [s.pageNumber]).join(', '),
      isMultiPage: s.isMultiPage,
    }));
  }, [shipments, customerConfig, fuelSurchargePercent, driverName]);

  const NUMERIC_FIELDS = ['weight', 'volumeFt3', 'detention'];

  const editableOptions = (field) => {
    const contract = customerConfig.contract;
    switch (field) {
      case 'zone': return Object.keys(contract.priceTable);
      case 'liftgate':
      case 'inside':
      case 'residential': return ['', 'Yes'];
      case 'overLength': return ['', ...Object.keys(contract.accessorials.overLength)];
      case 'timeSpecific': return ['', ...Object.keys(contract.accessorials.timeSpecific.rates), 'REVIEW'];
      default: return null; // numeric — free input
    }
  };

  const commitCorrection = (rowIdx, field, rawValue) => {
    const value = NUMERIC_FIELDS.includes(field) ? (parseFloat(rawValue) || 0) : rawValue;
    const shipment = shipments[rowIdx];
    const oldValue = shipment?.[field];

    if (String(oldValue ?? '') === String(value)) {
      setEditingCell(null); // nothing changed — not a correction
      return;
    }

    // Persist every correction — over time this shows which fields the model
    // actually gets wrong (GET /api/corrections/summary)
    fetch('http://localhost:3001/api/corrections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pro: shipment?.pro,
        field,
        oldValue,
        newValue: value,
        wasFlagged:
          (shipment?.lowConfidenceFields || []).includes(field) ||
          (field === 'zone' && !['BOL', 'MANUAL'].includes(shipment?.zoneSource)) ||
          (field === 'timeSpecific' && oldValue === 'REVIEW'),
        zoneSource: shipment?.zoneSource,
        filename: shipment?.filename,
      }),
    }).catch(() => {}); // logging must never block the correction itself

    setShipments((prev) => prev.map((s, i) => {
      if (i !== rowIdx) return s;
      const fixed = { ...s, [field]: value };
      // A human-corrected field is no longer low-confidence
      fixed.lowConfidenceFields = (s.lowConfidenceFields || []).filter((f) => f !== field);
      if (field === 'zone') fixed.zoneSource = 'MANUAL';
      return fixed;
    }));
    setEditingCell(null);
  };

  const cellClass = (row, field) => {
    const classes = ['editable-cell'];
    if (row.lowConfidenceFields?.includes(field)) classes.push('low-confidence');
    // Zone from the ZIP table (or unresolved) is a heuristic, not read off the BOL
    if (field === 'zone' && row.zoneSource && !['BOL', 'MANUAL'].includes(row.zoneSource)) {
      classes.push('low-confidence');
    }
    if (field === 'timeSpecific' && row.timeSpecific === 'REVIEW') classes.push('review-needed');
    return classes.join(' ');
  };

  const renderEditableCell = (row, rowIdx, field, display) => {
    const isEditing = editingCell && editingCell.row === rowIdx && editingCell.field === field;
    if (!isEditing) {
      return (
        <td
          className={cellClass(row, field)}
          title="Click to correct"
          onClick={() => setEditingCell({ row: rowIdx, field })}
        >
          {display}
        </td>
      );
    }
    let options = editableOptions(field);
    const current = shipments[rowIdx]?.[field] ?? '';
    if (options && !options.includes(current)) options = [current, ...options];
    return (
      <td>
        {options ? (
          <select
            className="cell-editor"
            autoFocus
            defaultValue={current}
            onChange={(e) => commitCorrection(rowIdx, field, e.target.value)}
            onBlur={() => setEditingCell(null)}
          >
            {options.map((o) => (
              <option key={o} value={o}>{o === '' ? '—' : o}</option>
            ))}
          </select>
        ) : (
          <input
            className="cell-editor"
            autoFocus
            type="number"
            defaultValue={current || 0}
            onBlur={(e) => commitCorrection(rowIdx, field, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCorrection(rowIdx, field, e.target.value);
              if (e.key === 'Escape') setEditingCell(null);
            }}
          />
        )}
      </td>
    );
  };

  // Fixed-price line-haul runs have no BOL to extract — the driver just makes
  // the run. They are entered manually (customer-confirmed workflow).
  const addLaneRun = () => {
    const price = customerConfig.contract.fixedLanes[selectedLane];
    if (!price) return;
    setShipments((prev) => [
      ...prev,
      {
        pro: selectedLane,
        laneKey: selectedLane,
        fixedPrice: price,
        isFixedLane: true,
        manualEntry: true,
        pageNumbers: ['manual'],
      },
    ]);
    setSelectedLane('');
  };

  const processFiles = async () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one PDF file.');
      return;
    }

    if (!driverName.trim()) {
      alert('Please enter the driver name before processing files.');
      return;
    }

    if (!customerConfig) {
      alert('Customer pricing config not loaded yet — make sure the backend is running on port 3001, then try again.');
      return;
    }

    setLoading(true);

    try {
      const allResults = [];
      const failedPages = [];

      for (const file of selectedFiles) {
        console.log(`\n📄 Processing: ${file.name}`);
        
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const pdfBase64 = await base64Promise;

        const response = await fetch('http://localhost:3001/api/process-bol', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pdfBase64,
            filename: file.name
          })
        });

        if (!response.ok) {
          throw new Error(`Server error: ${response.status} for file ${file.name}`);
        }

        const data = await response.json();
        console.log('📊 Server response:', data);
        
        if (data.results && data.results.length > 0) {
          data.results.forEach((result) => {
            if (result.success === false) {
              // Failed pages must not become invoice rows — track and report.
              failedPages.push({ filename: file.name, pageNumber: result.pageNumber, error: result.error });
              return;
            }
            console.log(`  Page ${result.pageNumber}:`, {
              pro: result.pro,
              weight: result.weight,
              volumeFt3: result.volumeFt3,
              zone: result.zone,
              liftgate: result.liftgate,
              inside: result.inside,
              residential: result.residential,
              timeSpecific: result.timeSpecific
            });
            // filename is needed by consolidation's consecutive-page signal
            allResults.push({ ...result, filename: file.name });
          });
        }
      }

      console.log('📋 All extracted results:', allResults);

      const consolidated = consolidateMultiPageBOLs(allResults, customerConfig.consolidation);
      console.log(`📦 Consolidated ${allResults.length} page(s) into ${consolidated.length} shipment(s)`);

      // New batch replaces extracted shipments but keeps manually entered runs
      setShipments((prev) => [...consolidated, ...prev.filter((s) => s.manualEntry)]);

      if (failedPages.length > 0) {
        const details = failedPages
          .map(p => `• ${p.filename} page ${p.pageNumber}: ${p.error || 'unknown error'}`)
          .join('\n');
        alert(`⚠️ ${failedPages.length} page(s) could not be extracted and are NOT included in the results:\n\n${details}\n\nProcess these pages manually or re-upload them.`);
      }

    } catch (error) {
      console.error('❌ Error processing files:', error);
      alert(`Error processing files: ${error.message}\n\nPlease check:\n- Server is running on port 3001\n- Files are valid PDFs\n- Driver name is entered`);
    } finally {
      setLoading(false);
    }
  };

  // Quote any field containing commas/quotes/newlines so a value can never
  // break the row
  const csvEscape = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportToCSV = () => {
    const headers = ['PRO', 'Driver', 'Zone', 'Weight', 'Volume', 'Chargeable', 'Freight', 'Fuel',
                     'Debris R', 'Liftgate', 'Inside', 'Over', 'Residential', 'Time', 'Detention', 'Extras', 'Total'];

    const rows = results.map(r => [
      r.pro, r.driver, r.zone, r.weight, r.volumeFt3, r.chargeable,
      r.freight, r.fuelSurcharge, r.debrisRemoval, r.liftgate, r.inside,
      r.overLength, r.residential, r.timeSpecific || '', r.detention, '', r.total
    ]);

    const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bol-results-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    // NO HEADERS - just data rows for pasting into Excel
    // Column order: PRO, Driver, Zone, Weight, Volume, Chargeable, Freight, Fuel, Debris R, Liftgate, Inside, Over, Residential, Time, Detention, Extras, Total
    const rows = results.map(r => [
      r.pro,                    // PRO
      r.driver,                 // Driver
      r.zone,                   // Zone
      r.weight,                 // Weight
      r.volumeFt3,              // Volume
      r.chargeable,             // Chargeable
      r.freight,                // Freight
      r.fuelSurcharge,          // Fuel
      r.debrisRemoval,          // Debris R
      r.liftgate,               // Liftgate
      r.inside,                 // Inside
      r.overLength || '',       // Over
      r.residential,            // Residential
      r.timeSpecific || '',     // Time
      r.detention,              // Detention
      '',                       // Extras
      r.total                   // Total
    ]);

    // Tab-separated for Excel
    const tableText = rows.map(row => row.join('\t')).join('\n');
    
    navigator.clipboard.writeText(tableText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(err => {
      alert('Failed to copy to clipboard. Please try again.');
      console.error('Copy error:', err);
    });
  };

  return (
    <>
      <style>{styles}</style>
      <div className="app-container">
        <header className="header">
          <div className="header-left">
            <div className="logo">
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
              </svg>
            </div>
            <div className="header-title">
              <h1>BOL Extractor</h1>
              <p>Automated Data Processing</p>
            </div>
          </div>
          <button className="settings-btn" onClick={() => setShowSettings(!showSettings)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6M7.05 7.05l4.95 4.95m0 0l4.95 4.95m-4.95-4.95l4.95-4.95m-4.95 4.95L7.05 16.95"/>
            </svg>
            Settings
          </button>
        </header>

        <main className="main-content">
          <div className="page-header">
            <h2>BOL Data Extractor</h2>
            <p>
              Automated Bill of Lading data extraction powered by AI. Upload your PDFs and get 
              structured data in seconds.
            </p>
          </div>

          <div className="driver-input-section">
            <label htmlFor="driverName">
              Driver Name <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              id="driverName"
              type="text"
              placeholder="Enter driver's name (e.g., John Smith)"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
            />
            <p>This name will be applied to all BOLs uploaded in this batch</p>
          </div>

          {customerConfig && Object.keys(customerConfig.contract.fixedLanes).length > 0 && (
            <div className="lane-section">
              <label htmlFor="laneSelect">Line-haul runs (fixed price)</label>
              <div className="lane-controls">
                <select
                  id="laneSelect"
                  value={selectedLane}
                  onChange={(e) => setSelectedLane(e.target.value)}
                >
                  <option value="">Select a lane…</option>
                  {Object.entries(customerConfig.contract.fixedLanes).map(([lane, price]) => (
                    <option key={lane} value={lane}>
                      {lane} — ${price.toLocaleString()}
                    </option>
                  ))}
                </select>
                <button className="add-lane-btn" onClick={addLaneRun} disabled={!selectedLane}>
                  + Add run
                </button>
              </div>
              <p>These runs have no BOL to scan — add them by hand. The lane price is all-in.</p>
            </div>
          )}

          <div className="upload-card">
            <div 
              className={`upload-zone ${dragging ? 'dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="upload-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <h3>Upload BOL PDFs</h3>
              <p>
                Drag and drop your Bill of Lading files here, or click to browse.<br/>
                Multi-page PDFs are automatically split and processed.
              </p>
              <button 
                className="select-files-btn" 
                onClick={() => document.getElementById('fileInput').click()}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Select Files
              </button>
              <p className="file-size-hint">Supports PDF files up to 30MB each</p>
              <input
                id="fileInput"
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
            </div>
          </div>

          {selectedFiles.length > 0 && !loading && (
            <div className="selected-files-section">
              <h4>Selected Files ({selectedFiles.length})</h4>
              <div className="file-list">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="file-item">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span title={file.name}>{file.name}</span>
                    <button 
                      className="remove-file-btn"
                      onClick={() => setSelectedFiles(selectedFiles.filter((_, i) => i !== index))}
                      title="Remove file"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              <button 
                className="process-btn"
                onClick={processFiles}
                disabled={!driverName.trim()}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 11 12 14 22 4"/>
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                </svg>
                Process {selectedFiles.length} File{selectedFiles.length !== 1 ? 's' : ''}
              </button>
            </div>
          )}

          {loading && (
            <div className="loading-container">
              <div className="spinner"></div>
              <p>Processing your BOL documents...</p>
            </div>
          )}

          {!loading && results.length === 0 && selectedFiles.length === 0 && (
            <div className="empty-state-card">
              <div className="empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
              </div>
              <h3>No BOL data yet</h3>
              <p>Upload your first Bill of Lading PDF to get started</p>
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="results-container">
              <div className="results-header">
                <h3>Extracted Results ({results.length})</h3>
                <div className="export-buttons">
                  <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={copyToClipboard}>
                    {copied ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                    )}
                    {copied ? 'Copied!' : 'Copy to Clipboard'}
                  </button>
                  <button className="export-btn" onClick={exportToCSV}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Download CSV
                  </button>
                </div>
              </div>

              <p className="review-legend">
                <span className="legend-swatch low-confidence"></span> low confidence — verify
                <span className="legend-swatch review-needed"></span> needs a decision
                <span>· click any highlighted (or plain) value to correct it — the total re-prices instantly</span>
              </p>

              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>PRO</th>
                      <th>Driver</th>
                      <th>Zone</th>
                      <th>Weight</th>
                      <th>Volume</th>
                      <th>Chargeable</th>
                      <th>Freight</th>
                      <th>Fuel</th>
                      <th>Debris R</th>
                      <th>Liftgate</th>
                      <th>Inside</th>
                      <th>Over</th>
                      <th>Residential</th>
                      <th>Time</th>
                      <th>Detention</th>
                      <th>Extras</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result, idx) => (
                      shipments[idx]?.manualEntry ? (
                        <tr key={idx}>
                          <td>
                            {result.pro}
                            <button
                              className="remove-row-btn"
                              title="Remove this run"
                              onClick={() => setShipments((prev) => prev.filter((_, i) => i !== idx))}
                            >
                              ×
                            </button>
                          </td>
                          <td>{result.driver}</td>
                          <td>{result.zone}</td>
                          <td className="manual-note" colSpan={12}>fixed-price line-haul run — all-in</td>
                          <td></td>
                          <td><strong>${result.total}</strong></td>
                        </tr>
                      ) : (
                      <tr key={idx}>
                        <td>{result.pro}</td>
                        <td>{result.driver}</td>
                        {renderEditableCell(result, idx, 'zone', result.zone)}
                        {renderEditableCell(result, idx, 'weight', result.weight)}
                        {renderEditableCell(result, idx, 'volumeFt3', result.volumeFt3)}
                        <td>{result.chargeable}</td>
                        <td>${result.freight}</td>
                        <td>${result.fuelSurcharge}</td>
                        <td>${result.debrisRemoval}</td>
                        {renderEditableCell(result, idx, 'liftgate', result.liftgate)}
                        {renderEditableCell(result, idx, 'inside', result.inside)}
                        {renderEditableCell(result, idx, 'overLength', result.overLength)}
                        {renderEditableCell(result, idx, 'residential', result.residential)}
                        {renderEditableCell(result, idx, 'timeSpecific', result.timeSpecific)}
                        {renderEditableCell(result, idx, 'detention', result.detention)}
                        <td></td>
                        <td><strong>${result.total}</strong></td>
                      </tr>
                      )
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </div>

      {showSettings && (
        <div className="settings-modal" onClick={() => setShowSettings(false)}>
          <div className="settings-content" onClick={(e) => e.stopPropagation()}>
            <h3>Settings</h3>
            <div className="setting-item">
              <label>Fuel Surcharge Percentage</label>
              <input
                type="number"
                step="0.01"
                value={fuelSurchargePercent * 100}
                onChange={(e) => setFuelSurchargePercent(parseFloat(e.target.value) / 100)}
                min="0"
                max="100"
              />
            </div>
            <div className="settings-actions">
              <button className="cancel-btn" onClick={() => setShowSettings(false)}>
                Cancel
              </button>
              <button className="save-btn" onClick={() => setShowSettings(false)}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;