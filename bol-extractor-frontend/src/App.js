import React, { useState } from 'react';
import { Upload, Download, Copy, Loader2, AlertCircle, Settings, X } from 'lucide-react';

// Price table for zone-based pricing
const PRICE_TABLE = {
  'A': { '10000+': 0.0121, '5000+': 0.0129, '2000+': 0.0137, '1000+': 0.0144, min: 18.00, max: 160.00 },
  'B': { '10000+': 0.0132, '5000+': 0.0140, '2000+': 0.0147, '1000+': 0.0157, min: 20.00, max: 180.00 },
  'C': { '10000+': 0.0143, '5000+': 0.0150, '2000+': 0.0160, '1000+': 0.0169, min: 22.00, max: 200.00 },
  'D': { '10000+': 0.0154, '5000+': 0.0163, '2000+': 0.0173, '1000+': 0.0183, min: 24.00, max: 220.00 },
  'E': { '10000+': 0.0183, '5000+': 0.0195, '2000+': 0.0204, '1000+': 0.0218, min: 26.00, max: 240.00 },
  'F': { '10000+': 0.0198, '5000+': 0.0209, '2000+': 0.0221, '1000+': 0.0235, min: 28.00, max: 260.00 },
  'G': { '10000+': 0.0213, '5000+': 0.0226, '2000+': 0.0239, '1000+': 0.0253, min: 31.00, max: 290.00 },
  'H': { '10000+': 0.0230, '5000+': 0.0243, '2000+': 0.0258, '1000+': 0.0273, min: 34.00, max: 320.00 },
  'I': { '10000+': 0.0249, '5000+': 0.0262, '2000+': 0.0279, '1000+': 0.0295, min: 37.00, max: 350.00 },
  'J': { '10000+': 0.0267, '5000+': 0.0284, '2000+': 0.0301, '1000+': 0.0319, min: 40.00, max: 380.00 },
  'K': { '10000+': 0.0289, '5000+': 0.0307, '2000+': 0.0325, '1000+': 0.0344, min: 43.00, max: 400.00 },
  'L': { '10000+': 0.0313, '5000+': 0.0332, '2000+': 0.0352, '1000+': 0.0371, min: 46.00, max: 420.00 },
};

function App() {
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fuelSurchargePercent, setFuelSurchargePercent] = useState(0.24);
  const [showSettings, setShowSettings] = useState(false);

  const handleFileChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    const fileObjects = selectedFiles.map(file => ({
      file,
      driverName: ''
    }));
    setFiles(prev => [...prev, ...fileObjects]);
  };

  const updateDriverName = (index, name) => {
    setFiles(prev => prev.map((f, i) => i === index ? { ...f, driverName: name } : f));
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const calculateChargeableWeight = (volumeFt3) => {
    if (!volumeFt3) return 0;
    return (volumeFt3 * 1728) / 115;
  };

  const calculateFreight = (zone, applicableWeight) => {
    const zoneRates = PRICE_TABLE[zone?.toUpperCase()];
    if (!zoneRates) {
      console.warn(`⚠️ Zone "${zone}" not found in price table. Freight requires manual quote.`);
      return 'Quote Required';
    }

    let rate;
    if (applicableWeight >= 10000) rate = zoneRates['10000+'];
    else if (applicableWeight >= 5000) rate = zoneRates['5000+'];
    else if (applicableWeight >= 2000) rate = zoneRates['2000+'];
    else rate = zoneRates['1000+'];

    let freight = applicableWeight * rate;
    return Math.max(zoneRates.min, Math.min(freight, zoneRates.max));
  };

  const calculateInsideDelivery = (applicableWeight) => {
    if (!applicableWeight) return 0;
    const calculated = applicableWeight * 0.15;
    return Math.max(20, Math.min(calculated, 150));
  };

  const calculateOverLength = (overLengthCategory) => {
    const rates = {
      '97-144': 25,
      '145-192': 35,
      '193-240': 50,
      '241 or more': 80
    };
    return rates[overLengthCategory] || 0;
  };

  const calculateTimeSpecific = (zone, timeType) => {
    if (!timeType || timeType === "") return 0;
    
    const earlyZones = ['A', 'B', 'C', 'D'];
    const isEarlyZone = earlyZones.includes(zone?.toUpperCase());
    
    if (timeType === 'AM Special') return isEarlyZone ? 23 : 33;
    if (timeType === '2 Hours') return isEarlyZone ? 38 : 48;
    if (timeType === '15 Minutes') return isEarlyZone ? 53 : 63;
    
    return 0;
  };

  const calculateDetention = (minutes) => {
    if (!minutes || minutes <= 30) return 0;
    const billableMinutes = minutes - 30;
    return (billableMinutes / 60) * 36;
  };

  const calculateDebrisRemoval = (palletCount, hasDebrisSection, isLakeshore) => {
    if (!palletCount) return 0;
    if (hasDebrisSection || isLakeshore) {
      return palletCount * 3;
    }
    return 0;
  };

  const consolidateMultiPageBOLs = (processedResults) => {
    const grouped = {};

    const normalizeAddress = (addr) => {
      if (!addr) return '';
      
      let normalized = addr
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/\./g, '')
        .replace(/,/g, '')
        .replace(/\brd\b/g, 'road')
        .replace(/\bst\b/g, 'street')
        .replace(/\bave\b/g, 'avenue')
        .replace(/\bdr\b/g, 'drive')
        .replace(/\bln\b/g, 'lane')
        .replace(/\bblvd\b/g, 'boulevard')
        .replace(/\bct\b/g, 'court')
        .replace(/\bpkwy\b/g, 'parkway')
        .replace(/\bpl\b/g, 'place')
        .replace(/\bcir\b/g, 'circle')
        .replace(/\bste\b/g, 'suite')
        .replace(/\bapt\b/g, 'apartment')
        .replace(/\s+/g, ' ')
        .trim();
      
      normalized = normalized
        .replace(/\bnortheast\b/g, '')
        .replace(/\bnorthwest\b/g, '')
        .replace(/\bsoutheast\b/g, '')
        .replace(/\bsouthwest\b/g, '')
        .replace(/\bnorth\b/g, '')
        .replace(/\bsouth\b/g, '')
        .replace(/\beast\b/g, '')
        .replace(/\bwest\b/g, '')
        .replace(/\bne\b/g, '')
        .replace(/\bnw\b/g, '')
        .replace(/\bse\b/g, '')
        .replace(/\bsw\b/g, '')
        .replace(/\bn\b/g, '')
        .replace(/\bs\b/g, '')
        .replace(/\be\b/g, '')
        .replace(/\bw\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      return normalized;
    };

    processedResults.forEach(result => {
      const normalizedAddress = normalizeAddress(result.deliveryAddress);
      const groupKey = normalizedAddress;
      
      if (!groupKey || groupKey === '') {
        const uniqueKey = `${result.pro}-${Math.random()}`;
        grouped[uniqueKey] = {
          ...result,
          pages: [result],
          isMultiPage: false,
          originalPro: result.pro,
          hasDebrisSection: result.hasDebrisSection,
          isLakeshore: result.isLakeshore,
        };
        return;
      }
      
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          ...result,
          pages: [result],
          isMultiPage: false,
          originalPro: result.pro,
          hasDebrisSection: result.hasDebrisSection,
          isLakeshore: result.isLakeshore,
        };
      } else {
        grouped[groupKey].isMultiPage = true;
        grouped[groupKey].pages.push(result);
        
        grouped[groupKey].weight = (grouped[groupKey].weight || 0) + (result.weight || 0);
        grouped[groupKey].volumeFt3 = (grouped[groupKey].volumeFt3 || 0) + (result.volumeFt3 || 0);
        
        if (result.overLength && result.overLength !== "") {
          const ranges = ["97-144", "145-192", "193-240", "241 or more"];
          const currentIndex = ranges.indexOf(grouped[groupKey].overLength || "");
          const newIndex = ranges.indexOf(result.overLength);
          if (currentIndex === -1 || newIndex > currentIndex) {
            grouped[groupKey].overLength = result.overLength;
          }
        }
        
        grouped[groupKey].palletCount = (grouped[groupKey].palletCount || 0) + (result.palletCount || 0);
        
        if (result.liftgate === "Yes") grouped[groupKey].liftgate = "Yes";
        if (result.inside === "Yes") grouped[groupKey].inside = "Yes";
        if (result.residential === "Yes") grouped[groupKey].residential = "Yes";
        
        if (result.hasDebrisSection) grouped[groupKey].hasDebrisSection = true;
        if (result.isLakeshore) grouped[groupKey].isLakeshore = true;
        
        if (result.timeSpecific && result.timeSpecific !== "") {
          if (!grouped[groupKey].timeSpecific || grouped[groupKey].timeSpecific === "") {
            grouped[groupKey].timeSpecific = result.timeSpecific;
          } else {
            const priority = { "15 Minutes": 3, "AM Special": 2, "2 Hours": 1 };
            if (priority[result.timeSpecific] > priority[grouped[groupKey].timeSpecific]) {
              grouped[groupKey].timeSpecific = result.timeSpecific;
            }
          }
        }
        
        if (result.detention > 0) {
          grouped[groupKey].detention = (grouped[groupKey].detention || 0) + result.detention;
        }
      }
    });

    return Object.values(grouped);
  };

  const processPDFs = async () => {
    if (files.length === 0) return;

    setLoading(true);
    setError('');
    setResults([]);

    const allResults = [];
    const errors = [];

    try {
      for (const fileObj of files) {
        try {
          console.log(`\n📄 Processing: ${fileObj.file.name}`);
          
          const reader = new FileReader();
          const base64Promise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(fileObj.file);
          });

          const pdfBase64 = await base64Promise;

          const response = await fetch('http://localhost:3001/api/process-bol', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pdfBase64,
              filename: fileObj.file.name
            })
          });

          if (!response.ok) {
            throw new Error(`Server returned ${response.status}`);
          }

          const data = await response.json();
          console.log('📊 Response:', data);

          if (data.results && data.results.length > 0) {
            data.results.forEach(pageResult => {
              if (pageResult.success && pageResult.data) {
                try {
                  const cleanedText = pageResult.data.replace(/```json\n?|\n?```/g, '').trim();
                  const parsedData = JSON.parse(cleanedText);
                  
                  allResults.push({
                    ...parsedData,
                    driver: fileObj.driverName,
                    filename: fileObj.file.name,
                    pageNumber: pageResult.pageNumber,
                    isFixedLane: pageResult.isFixedLane || false,
                    laneKey: pageResult.laneKey || '',
                    fixedPrice: pageResult.fixedPrice || 0,
                    zoneSource: pageResult.zoneSource || 'BOL'
                  });
                } catch (parseError) {
                  console.error('Parse error:', parseError);
                  errors.push(`${fileObj.file.name} (Page ${pageResult.pageNumber}): Failed to parse data`);
                }
              } else if (!pageResult.success) {
                errors.push(`${fileObj.file.name} (Page ${pageResult.pageNumber}): ${pageResult.error}`);
              }
            });
          }
        } catch (fileError) {
          console.error(`Error processing ${fileObj.file.name}:`, fileError);
          errors.push(`${fileObj.file.name}: ${fileError.message}`);
        }
      }

      console.log('\n📊 Total results before consolidation:', allResults.length);
      
      const consolidatedResults = consolidateMultiPageBOLs(allResults);
      console.log('📊 Results after consolidation:', consolidatedResults.length);

      const calculatedResults = consolidatedResults.map(result => {
        // ========== CHECK FOR FIXED PRICE LANE FIRST ==========
        if (result.isFixedLane && result.fixedPrice) {
          console.log(`🛣️ Fixed lane: ${result.laneKey} = ${result.fixedPrice}`);
          return {
            pro: result.pro,
            driver: result.driver,
            zone: '',  // Blank for fixed lanes
            zoneSource: 'FIXED_LANE',
            weight: result.weight?.toFixed(0) || '0',
            volumeFt3: result.volumeFt3?.toFixed(2) || '0.00',
            chargeable: '',  // Blank for fixed lanes
            freight: result.fixedPrice.toFixed(2),
            fuelSurcharge: '',  // Blank for fixed lanes
            debrisRemoval: '',  // Blank for fixed lanes
            liftgate: '',
            inside: '',
            overLength: '',
            residential: '',
            timeSpecific: '',
            detention: 0,
            extras: '',  // Blank for fixed lanes
            total: result.fixedPrice.toFixed(2),
          };
        }

        // ========== ZONE-BASED PRICING WITH ACCESSORIALS ==========
        const chargeableWeight = calculateChargeableWeight(result.volumeFt3);
        const applicableWeight = Math.max(result.weight || 0, chargeableWeight);
        
        const freight = calculateFreight(result.zone, applicableWeight);
        const fuelSurcharge = freight === 'Quote Required' ? 'Quote Required' : freight * fuelSurchargePercent;
        
        const debrisRemoval = calculateDebrisRemoval(
          result.palletCount,
          result.hasDebrisSection,
          result.isLakeshore
        );
        
        const liftgateCharge = result.liftgate === "Yes" ? 20 : 0;
        const insideCharge = result.inside === "Yes" ? calculateInsideDelivery(applicableWeight) : 0;
        const overLengthCharge = calculateOverLength(result.overLength);
        const residentialCharge = result.residential === "Yes" ? 15 : 0;
        const timeSpecificCharge = calculateTimeSpecific(result.zone, result.timeSpecific);
        const detentionCharge = calculateDetention(result.detention);

        const extras = debrisRemoval + liftgateCharge + insideCharge + overLengthCharge + 
                      residentialCharge + timeSpecificCharge + detentionCharge;

        const total = freight === 'Quote Required' ? 'Quote Required' : 
                     freight + fuelSurcharge + extras;

        return {
          pro: result.pro,
          driver: result.driver,
          zone: result.zone || '?',
          zoneSource: result.zoneSource,
          deliveryZip: result.deliveryZip,
          weight: result.weight?.toFixed(0) || '0',
          volumeFt3: result.volumeFt3?.toFixed(2) || '0.00',
          chargeable: chargeableWeight.toFixed(0),
          freight: freight === 'Quote Required' ? freight : freight.toFixed(2),
          fuelSurcharge: fuelSurcharge === 'Quote Required' ? fuelSurcharge : fuelSurcharge.toFixed(2),
          debrisRemoval: debrisRemoval.toFixed(2),
          liftgate: result.liftgate === "Yes" ? "Yes" : "",
          inside: result.inside === "Yes" ? "Yes" : "",
          overLength: result.overLength || "",
          residential: result.residential === "Yes" ? "Yes" : "",
          timeSpecific: result.timeSpecific || "",
          detention: result.detention || 0,
          extras: extras.toFixed(2),
          total: total === 'Quote Required' ? total : total.toFixed(2),
        };
      });

      setResults(calculatedResults);

      if (errors.length > 0) {
        setError(`Processed with errors:\n${errors.join('\n')}`);
      }

    } catch (error) {
      console.error('Processing error:', error);
      setError(error.message || 'Failed to process files');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    const headers = ['Job', 'Driver', 'Zone', 'Weight', 'Volume', 'Chargeable', 'Freight', 'Fuel', 
                    'Debris', 'Lift', 'Inside', 'Over', 'Res', 'Time', 'Det', 'Extras', 'Total'];
    
    const rows = results.map(r => [
      r.pro, r.driver, r.zone, r.weight, r.volumeFt3, r.chargeable,
      r.freight === 'Quote Required' ? r.freight : (r.freight ? `${r.freight}` : ''),
      r.fuelSurcharge === 'Quote Required' ? r.fuelSurcharge : (r.fuelSurcharge ? `${r.fuelSurcharge}` : ''),
      r.debrisRemoval ? `${r.debrisRemoval}` : '', r.liftgate, r.inside, r.overLength, r.residential,
      r.timeSpecific, r.detention > 0 ? `${r.detention} min` : '', r.extras ? `${r.extras}` : '',
      r.total === 'Quote Required' ? r.total : `${r.total}`
    ]);

    const tableText = [headers, ...rows].map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(tableText);
    alert('Table copied to clipboard!');
  };

  const downloadCSV = () => {
    const headers = ['Job', 'Driver', 'Zone', 'Zone Source', 'Delivery ZIP', 'Weight', 'Volume', 'Chargeable', 
                    'Freight', 'Fuel', 'Debris', 'Lift', 'Inside', 'Over', 'Res', 'Time', 'Det', 'Extras', 'Total'];
    
    const rows = results.map(r => [
      r.pro, r.driver, r.zone, r.zoneSource, r.deliveryZip, r.weight, r.volumeFt3, r.chargeable,
      r.freight, r.fuelSurcharge, r.debrisRemoval, r.liftgate, r.inside, r.overLength,
      r.residential, r.timeSpecific, r.detention, r.extras, r.total
    ]);

    const csv = [headers, ...rows].map(row => 
      row.map(cell => `"${cell}"`).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bol_extract_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-lg p-8 mb-6">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">BOL Data Extractor</h1>
              <p className="text-gray-600 mt-1">Automated freight calculation system with lane pricing</p>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Settings className="w-5 h-5" />
              Settings
            </button>
          </div>

          {showSettings && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-medium text-gray-900 mb-3">Configuration</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">Fuel Surcharge:</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={fuelSurchargePercent * 100}
                      onChange={(e) => setFuelSurchargePercent(parseFloat(e.target.value) / 100)}
                      className="w-20 px-3 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">%</span>
                  </label>
                  <button
                    onClick={() => setFuelSurchargePercent(0.24)}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    Reset to 24%
                  </button>
                </div>
                <div className="text-sm text-gray-600 border-t pt-3 mt-3">
                  <p className="font-medium mb-1">Fixed Price Lanes:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>GA → NJ: $2,000 (flat, no accessorials)</li>
                    <li>CA → GA: $6,000 (flat, no accessorials)</li>
                    <li>GA → CA: $3,600 (flat, no accessorials)</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <label className="block">
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-blue-500 transition-colors cursor-pointer">
              <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-lg font-medium text-gray-700 mb-2">Upload BOL PDFs</p>
              <p className="text-sm text-gray-500">Click to select multiple PDF files</p>
              <input
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          </label>

          {files.length > 0 && (
            <div className="mt-6">
              <div className="flex justify-between items-center mb-3">
                <p className="font-medium text-gray-700">Uploaded Files ({files.length}):</p>
                <button
                  onClick={() => setFiles([])}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Clear All
                </button>
              </div>
              <div className="space-y-3 max-h-96 overflow-y-auto">
                {files.map((fileObj, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 px-4 py-3 rounded-lg border border-gray-200">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700 mb-2 truncate" title={fileObj.file.name}>
                        📄 {fileObj.file.name}
                      </p>
                      <input
                        type="text"
                        placeholder="Enter driver name (e.g., John Smith)"
                        value={fileObj.driverName}
                        onChange={(e) => updateDriverName(i, e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      />
                    </div>
                    <button
                      onClick={() => removeFile(i)}
                      className="flex-shrink-0 p-2 hover:bg-red-100 rounded-lg transition-colors group"
                      title="Remove this file"
                    >
                      <X className="w-5 h-5 text-gray-500 group-hover:text-red-600" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={processPDFs}
            disabled={loading || files.length === 0}
            className="mt-6 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-medium py-3 px-6 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Processing {files.length} file{files.length !== 1 ? 's' : ''}...
              </>
            ) : (
              `Extract & Calculate (${files.length} file${files.length !== 1 ? 's' : ''})`
            )}
          </button>
        </div>

        {error && (
          <div className={`${results.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'} border rounded-lg p-4 mb-6`}>
            <div className="flex items-start gap-3">
              <AlertCircle className={`w-5 h-5 ${results.length > 0 ? 'text-yellow-600' : 'text-red-600'} flex-shrink-0 mt-0.5`} />
              <p className={`whitespace-pre-line ${results.length > 0 ? 'text-yellow-800' : 'text-red-800'}`}>{error}</p>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">Results ({results.length} BOLs)</h2>
              <div className="flex gap-2">
                <button onClick={copyToClipboard} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg">
                  <Copy className="w-4 h-4" /> Copy Table
                </button>
                <button onClick={downloadCSV} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                  <Download className="w-4 h-4" /> Download CSV
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-3 py-2 text-left">Job</th>
                    <th className="border px-3 py-2 text-left">Driver</th>
                    <th className="border px-3 py-2 text-left">Zone</th>
                    <th className="border px-3 py-2 text-right">Weight</th>
                    <th className="border px-3 py-2 text-right">Volume</th>
                    <th className="border px-3 py-2 text-right">Chargeable</th>
                    <th className="border px-3 py-2 text-right">Freight</th>
                    <th className="border px-3 py-2 text-right">Fuel</th>
                    <th className="border px-3 py-2 text-right">Debris</th>
                    <th className="border px-3 py-2 text-center">Lift</th>
                    <th className="border px-3 py-2 text-center">Inside</th>
                    <th className="border px-3 py-2 text-center">Over</th>
                    <th className="border px-3 py-2 text-center">Res</th>
                    <th className="border px-3 py-2 text-center">Time</th>
                    <th className="border px-3 py-2 text-right">Det</th>
                    <th className="border px-3 py-2 text-right">Extras</th>
                    <th className="border px-3 py-2 text-right bg-blue-50 font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="border px-3 py-2">{row.pro}</td>
                      <td className="border px-3 py-2">{row.driver}</td>
                      <td className="border px-3 py-2 text-center">
                        {row.zone}
                        {row.zoneSource === 'ZIP' && (
                          <span 
                            className="ml-1 text-xs text-blue-600 cursor-help" 
                            title={`Zone determined from delivery ZIP: ${row.deliveryZip}`}
                          >
                            (ZIP)
                          </span>
                        )}
                      </td>
                      <td className="border px-3 py-2 text-right">{row.weight}</td>
                      <td className="border px-3 py-2 text-right">{row.volumeFt3}</td>
                      <td className="border px-3 py-2 text-right">{row.chargeable}</td>
                      <td className="border px-3 py-2 text-right">{row.freight === 'Quote Required' ? row.freight : (row.freight ? `${row.freight}` : '')}</td>
                      <td className="border px-3 py-2 text-right">{row.fuelSurcharge === 'Quote Required' ? row.fuelSurcharge : (row.fuelSurcharge ? `${row.fuelSurcharge}` : '')}</td>
                      <td className="border px-3 py-2 text-right">{row.debrisRemoval ? `${row.debrisRemoval}` : ''}</td>
                      <td className="border px-3 py-2 text-center">{row.liftgate}</td>
                      <td className="border px-3 py-2 text-center">{row.inside}</td>
                      <td className="border px-3 py-2 text-center">{row.overLength}</td>
                      <td className="border px-3 py-2 text-center">{row.residential}</td>
                      <td className="border px-3 py-2 text-center">{row.timeSpecific}</td>
                      <td className="border px-3 py-2 text-right">{row.detention > 0 ? `${row.detention} min` : ''}</td>
                      <td className="border px-3 py-2 text-right">{row.extras ? `${row.extras}` : ''}</td>
                      <td className="border px-3 py-2 text-right font-bold bg-blue-50">
                        {row.total === 'Quote Required' ? row.total : `${row.total}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;