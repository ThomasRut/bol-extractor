const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
const { PDFDocument } = require('pdf-lib');
const sharp = require('sharp'); // ⭐ NEW: Image compression
require('dotenv').config();

console.log('🔐 API Key status:', process.env.ANTHROPIC_API_KEY ? 'Loaded ✓' : 'Missing ✗');
console.log('🔐 First 10 chars:', process.env.ANTHROPIC_API_KEY?.substring(0, 10));

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ============== ⭐ NEW: RATE LIMITING HELPER ==============
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const DELAY_BETWEEN_PAGES_MS = 2000; // 2 seconds between API calls
// ==========================================================

const FIXED_PRICE_LANES = {
  "GA-NJ": 2000,
  "CA-GA": 6000,
  "GA-CA": 3600
};

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
  "30110": "G", "30111": "C", "30112": "F", "30113": "E", "30114": "F", "30115": "F", "30116": "H",
  "30117": "H", "30118": "J", "30119": "J", "30120": "C", "30121": "K", "30122": "D", "30124": "G",
  "30125": "J", "30126": "D", "30127": "E", "30132": "H", "30133": "H", "30134": "I", "30135": "J",
  "30137": "G", "30138": "F", "30139": "H", "30140": "I", "30141": "I", "30142": "J", "30143": "I",
  "30144": "I", "30145": "I", "30147": "I", "30148": "I", "30149": "I", "30150": "K", "30152": "G",
  "30153": "H", "30154": "I", "30156": "I", "30157": "I", "30160": "J", "30161": "I", "30162": "J",
  "30165": "K", "30168": "E", "30169": "G", "30170": "I", "30171": "I", "30172": "I", "30173": "F",
  "30175": "J", "30176": "I", "30177": "J", "30178": "J", "30179": "K", "30180": "H", "30182": "G",
  "30183": "J", "30184": "I", "30185": "K", "30187": "J", "30188": "H", "30189": "G", "30204": "G",
  "30205": "G", "30206": "H", "30212": "G", "30213": "H", "30214": "H", "30215": "G", "30216": "G",
  "30217": "H", "30218": "I", "30219": "I", "30220": "I", "30222": "H", "30223": "H", "30224": "I",
  "30228": "F", "30229": "I", "30230": "I", "30233": "H", "30234": "G", "30236": "G", "30237": "F",
  "30238": "G", "30240": "I", "30241": "I", "30248": "G", "30250": "I", "30251": "I", "30252": "G",
  "30253": "G", "30256": "I", "30257": "H", "30258": "F", "30259": "I", "30260": "C", "30263": "G",
  "30264": "G", "30265": "G", "30266": "G", "30268": "G", "30269": "G", "30270": "G", "30271": "G",
  "30272": "C", "30273": "G", "30274": "G", "30275": "G", "30276": "H", "30277": "H", "30281": "F",
  "30285": "I", "30286": "I", "30287": "I", "30288": "F", "30289": "I", "30290": "I", "30291": "I",
  "30292": "C", "30293": "G", "30294": "C", "30295": "G", "30296": "C", "30297": "C", "30298": "C",
  "30301": "C", "30302": "C", "30303": "C", "30304": "C", "30305": "C", "30306": "C", "30307": "C",
  "30308": "C", "30309": "C", "30310": "C", "30311": "C", "30312": "C", "30313": "C", "30314": "C",
  "30315": "C", "30316": "C", "30317": "C", "30318": "C", "30319": "D", "30320": "C", "30321": "C",
  "30322": "C", "30324": "D", "30325": "D", "30326": "D", "30327": "D", "30328": "D", "30329": "C",
  "30330": "C", "30331": "C", "30332": "C", "30333": "C", "30334": "C", "30336": "C", "30337": "C",
  "30338": "D", "30339": "D", "30340": "D", "30341": "D", "30342": "D", "30343": "C", "30344": "C",
  "30345": "C", "30346": "D", "30347": "C", "30348": "C", "30349": "C", "30350": "D", "30353": "C",
  "30354": "C", "30355": "D", "30356": "C", "30357": "C", "30358": "D", "30359": "D", "30360": "D",
  "30361": "D", "30362": "D", "30363": "D", "30364": "C", "30366": "C", "30368": "C", "30369": "C",
  "30370": "C", "30371": "C", "30374": "C", "30375": "C", "30376": "C", "30377": "C", "30378": "C",
  "30380": "C", "30384": "C", "30385": "C", "30386": "C", "30387": "C", "30388": "C", "30389": "C",
  "30390": "D", "30392": "C", "30394": "C", "30396": "C", "30398": "C", "30410": "K", "30412": "L",
  "30413": "L", "30414": "L", "30415": "K", "30417": "K", "30420": "L", "30421": "K", "30423": "K",
  "30424": "K", "30425": "K", "30426": "L", "30427": "K", "30428": "K", "30429": "L", "30434": "J",
  "30436": "J", "30438": "K", "30439": "K", "30441": "K", "30442": "L", "30445": "K", "30446": "K",
  "30447": "K", "30448": "J", "30449": "K", "30450": "J", "30451": "K", "30452": "K", "30453": "K",
  "30454": "K", "30455": "K", "30456": "K", "30457": "K", "30458": "L", "30459": "K", "30460": "K",
  "30461": "L", "30464": "K", "30467": "K", "30470": "K", "30471": "K", "30473": "K", "30477": "L",
  "30499": "C", "30501": "F", "30502": "G", "30503": "E", "30504": "F", "30506": "F", "30507": "G",
  "30510": "F", "30511": "G", "30512": "H", "30513": "G", "30514": "G", "30515": "H", "30516": "F",
  "30517": "F", "30518": "F", "30519": "G", "30520": "H", "30521": "H", "30522": "G", "30523": "G",
  "30525": "H", "30527": "H", "30528": "H", "30529": "H", "30530": "I", "30531": "I", "30533": "I",
  "30534": "I", "30535": "I", "30536": "I", "30537": "I", "30538": "I", "30539": "I", "30540": "H",
  "30541": "I", "30542": "I", "30543": "I", "30544": "I", "30545": "H", "30546": "I", "30547": "I",
  "30548": "I", "30549": "H", "30550": "I", "30552": "H", "30553": "I", "30554": "I", "30555": "I",
  "30557": "I", "30558": "I", "30559": "I", "30560": "I", "30562": "I", "30563": "I", "30564": "I",
  "30565": "I", "30566": "I", "30567": "I", "30568": "I", "30571": "I", "30572": "I", "30573": "I",
  "30575": "I", "30576": "I", "30577": "I", "30580": "H", "30581": "I", "30582": "I", "30596": "H",
  "30597": "G", "30598": "G", "30599": "F", "30601": "H", "30602": "H", "30603": "H", "30604": "H",
  "30605": "H", "30606": "H", "30607": "H", "30608": "H", "30609": "H", "30612": "H", "30619": "H",
  "30620": "I", "30621": "I", "30622": "I", "30623": "I", "30624": "I", "30625": "I", "30627": "I",
  "30628": "I", "30629": "H", "30630": "I", "30631": "I", "30633": "H", "30634": "I", "30635": "I",
  "30638": "I", "30639": "I", "30641": "I", "30642": "I", "30643": "I", "30645": "I", "30646": "H",
  "30647": "F", "30648": "I", "30650": "I", "30655": "I", "30656": "H", "30660": "H", "30662": "H",
  "30663": "I", "30664": "I", "30665": "I", "30666": "I", "30667": "I", "30668": "I", "30669": "I",
  "30671": "I", "30673": "I", "30677": "I", "30678": "I", "30680": "I", "30683": "I", "30701": "I",
  "30703": "I", "30705": "I", "30707": "I", "30708": "I", "30710": "I", "30711": "I", "30719": "I",
  "30720": "I", "30721": "I", "30724": "I", "30725": "I", "30726": "I", "30728": "I", "30730": "I",
  "30731": "I", "30732": "I", "30733": "I", "30734": "I", "30735": "I", "30736": "I", "30738": "I",
  "30739": "I", "30740": "I", "30741": "I", "30742": "I", "30746": "I", "30747": "I", "30750": "I",
  "30751": "I", "30752": "I", "30753": "I", "30755": "I", "30756": "I", "30757": "I", "30802": "J",
  "30803": "J", "30805": "J", "30807": "J", "30808": "J", "30809": "J", "30810": "J", "30812": "J",
  "30813": "J", "30814": "J", "30815": "J", "30816": "J", "30817": "J", "30818": "K", "30820": "K",
  "30821": "K", "30822": "K", "30823": "K", "30824": "K", "30828": "K", "30830": "K", "30833": "K",
  "30901": "J", "30903": "J", "30904": "J", "30905": "J", "30906": "J", "30907": "J", "30909": "J",
  "30912": "J", "30999": "J", "31001": "J", "31002": "J", "31003": "J", "31004": "I", "31005": "J",
  "31006": "J", "31007": "J", "31008": "J", "31009": "J", "31010": "J", "31011": "J", "31012": "J",
  "31013": "J", "31014": "J", "31015": "J", "31016": "J", "31017": "J", "31018": "J", "31019": "K",
  "31020": "K", "31021": "J", "31022": "J", "31023": "J", "31024": "J", "31025": "J", "31027": "K",
  "31028": "K", "31029": "J", "31030": "K", "31031": "J", "31032": "K", "31033": "K", "31034": "K",
  "31035": "J", "31036": "J", "31037": "K", "31038": "J", "31039": "J", "31040": "K", "31041": "J",
  "31042": "J", "31044": "J", "31045": "J", "31046": "K", "31047": "K", "31049": "K", "31050": "K",
  "31051": "K", "31052": "K", "31054": "K", "31055": "K", "31057": "K", "31058": "K", "31060": "K",
  "31061": "K", "31062": "K", "31063": "K", "31064": "K", "31065": "K", "31066": "K", "31067": "K",
  "31068": "K", "31069": "J", "31070": "J", "31071": "K", "31072": "K", "31075": "K", "31076": "K",
  "31077": "K", "31078": "K", "31079": "K", "31081": "K", "31082": "K", "31083": "K", "31084": "K",
  "31085": "K", "31086": "K", "31087": "K", "31088": "K", "31089": "K", "31090": "K", "31091": "K",
  "31092": "K", "31093": "K", "31094": "K", "31095": "K", "31096": "J", "31097": "K", "31098": "J",
  "31099": "J", "31106": "J", "31107": "J", "31119": "J", "31126": "J", "31131": "J", "31136": "J",
  "31139": "J", "31141": "J", "31145": "J", "31146": "J", "31150": "J", "31156": "K", "31191": "J",
  "31192": "J", "31193": "J", "31195": "J", "31196": "J", "31197": "J", "31198": "K", "31199": "J",
  "31201": "K", "31202": "K", "31203": "K", "31204": "K", "31205": "K", "31206": "K", "31207": "K",
  "31208": "K", "31209": "K", "31210": "K", "31211": "K", "31212": "K", "31213": "K", "31216": "K",
  "31217": "K", "31220": "L", "31294": "K", "31295": "K", "31296": "K", "31297": "K", "31298": "K",
  "31299": "K", "31301": "K", "31302": "K", "31303": "K", "31304": "K", "31305": "K", "31308": "K",
  "31309": "K", "31312": "K", "31313": "K", "31314": "K", "31315": "K", "31316": "K", "31318": "K",
  "31319": "K", "31320": "K", "31321": "K", "31322": "K", "31323": "K", "31324": "K", "31326": "K",
  "31327": "K", "31328": "K", "31329": "K", "31331": "K", "31333": "K", "31401": "K", "31402": "K",
  "31403": "K", "31404": "K", "31405": "K", "31406": "K", "31407": "K", "31408": "K", "31409": "K",
  "31410": "K", "31411": "K", "31412": "K", "31414": "K", "31415": "K", "31416": "K", "31418": "K",
  "31419": "K", "31420": "K", "31421": "K", "31501": "L", "31502": "K", "31503": "L", "31510": "K",
  "31512": "L", "31513": "L", "31515": "L", "31516": "L", "31518": "L", "31519": "L", "31520": "L",
  "31521": "L", "31522": "L", "31523": "L", "31524": "L", "31525": "L", "31527": "L", "31532": "K",
  "31533": "K", "31535": "L", "31537": "L", "31539": "L", "31542": "L", "31543": "L", "31544": "L",
  "31545": "L", "31546": "L", "31547": "L", "31548": "L", "31549": "L", "31550": "L", "31551": "L",
  "31552": "L", "31553": "L", "31554": "L", "31555": "L", "31556": "L", "31557": "L", "31558": "L",
  "31560": "L", "31561": "L", "31562": "L", "31563": "L", "31564": "L", "31565": "L", "31566": "L",
  "31567": "L", "31568": "L", "31569": "L", "31598": "L", "31599": "L", "31601": "K", "31602": "K",
  "31603": "K", "31605": "K", "31606": "K", "31620": "L", "31622": "L", "31623": "L", "31624": "L",
  "31625": "L", "31626": "L", "31627": "K", "31629": "L", "31630": "L", "31631": "L", "31632": "L",
  "31634": "L", "31635": "L", "31636": "L", "31637": "L", "31638": "L", "31639": "L", "31641": "L",
  "31642": "L", "31643": "L", "31645": "L", "31647": "L", "31648": "L", "31649": "L", "31650": "L",
  "31698": "K", "31699": "K", "31701": "J", "31702": "J", "31703": "J", "31704": "J", "31705": "J",
  "31707": "J", "31709": "J", "31711": "K", "31712": "L", "31714": "K", "31716": "L", "31719": "L",
  "31720": "K", "31721": "L", "31722": "K", "31727": "K", "31730": "L", "31733": "L", "31735": "L",
  "31738": "L", "31743": "L", "31744": "L", "31747": "K", "31749": "L", "31750": "K", "31753": "L",
  "31756": "L", "31757": "L", "31763": "L", "31764": "K", "31765": "L", "31768": "L", "31771": "L",
  "31772": "L", "31773": "K", "31774": "L", "31775": "L", "31776": "L", "31778": "L", "31779": "L",
  "31780": "L", "31781": "L", "31783": "L", "31784": "L", "31787": "L", "31788": "L", "31789": "L",
  "31790": "L", "31791": "K", "31792": "K", "31793": "K", "31794": "L", "31795": "L", "31796": "L",
  "31798": "K", "31799": "L", "31801": "J", "31803": "J", "31804": "J", "31805": "J", "31806": "J",
  "31807": "J", "31808": "J", "31810": "J", "31811": "K", "31812": "K", "31814": "L", "31815": "K",
  "31816": "J", "31820": "L", "31822": "K", "31823": "K", "31826": "K", "31827": "L", "31830": "J",
  "31831": "L", "31833": "L", "31836": "K", "36261": "J", "36262": "J", "36263": "I", "36264": "K",
  "36269": "I", "36273": "I", "36274": "K", "36275": "K", "36278": "K", "36280": "J", "36855": "L",
  "36863": "L", "39901": "B"
};

const VALID_ZONES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// ============== ⭐ NEW: IMAGE COMPRESSION FUNCTION ==============
async function compressPdfToImage(pdfBase64) {
  try {
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    
    const compressedBuffer = await sharp(pdfBuffer)
      .resize(1400, null, { withoutEnlargement: true, fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    const compressedBase64 = compressedBuffer.toString('base64');
    
    const originalSize = pdfBuffer.length;
    const compressedSize = compressedBuffer.length;
    const savings = ((1 - compressedSize / originalSize) * 100).toFixed(1);
    console.log(`  🗜️  Compressed: ${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB (${savings}% reduction)`);
    
    return compressedBase64;
  } catch (error) {
    console.warn('  ⚠️  Compression failed, using original:', error.message);
    return pdfBase64;
  }
}
// ================================================================

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
      
      // ⭐ NEW: Compress the page
      const compressedBase64 = await compressPdfToImage(pageBase64);
      
      pages.push({
        pageNumber: i + 1,
        base64: compressedBase64
      });
    }
    
    return pages;
  } catch (error) {
    console.error('Error splitting PDF:', error);
    throw error;
  }
}

async function processPage(pageBase64, pageNumber) {
  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [{
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pageBase64 },
        }, {
          type: 'text',
          text: `You are analyzing a Bill of Lading (BOL) document. BOLs come in many different formats and layouts, but you need to extract the same core information regardless of format.

**DOCUMENT TYPES YOU MAY ENCOUNTER:**
- Traditional freight BOLs (multi-column layout with shipper/consignee sections)
- Delivery Receipt format (simpler layout with pickup/deliver sections)
- Single-page or multi-page BOLs (may have suffixes like 1A, 1B)
- Various carrier formats (different field names and locations)

**YOUR TASK:** Extract 15 specific data points from any BOL format.

══════════════════════════════════════════════════════════════

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

══════════════════════════════════════════════════════════════

**FIELD 2: PICKUP STATE**
⚠️ NEW FIELD - Used to identify fixed-price lanes

WHAT TO LOOK FOR:
- The state abbreviation from the PICKUP/SHIPPER address
- Location: "Ship From:", "Shipper:", pickup/origin section
- Format: 2-letter state code (e.g., "GA", "CA", "NJ")

CRITICAL RULES:
- MUST be from pickup/origin address, NOT delivery address
- Return uppercase 2-letter state code only
- This is used to identify special contract lanes (GA-NJ, CA-GA, GA-CA)

EXTRACTION RULE:
- Return 2-letter state code as string (e.g., "GA", "CA", "TX")
- Return "" if not found

══════════════════════════════════════════════════════════════

**FIELD 3: DELIVERY STATE**
⚠️ NEW FIELD - Used to identify fixed-price lanes

WHAT TO LOOK FOR:
- The state abbreviation from the DELIVERY/CONSIGNEE address
- Location: "Ship To:", "Deliver To:", "Consignee:", delivery section
- Format: 2-letter state code (e.g., "GA", "NJ", "CA")

CRITICAL RULES:
- MUST be from delivery address, NOT pickup address
- Return uppercase 2-letter state code only
- This is used to identify special contract lanes

EXTRACTION RULE:
- Return 2-letter state code as string (e.g., "NJ", "CA", "FL")
- Return "" if not found

══════════════════════════════════════════════════════════════

**FIELD 4: ZONE (DELIVERY ZONE)**
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

══════════════════════════════════════════════════════════════

**FIELD 5: DELIVERY ZIP CODE**
⚠️ Used as fallback when zone is not explicitly shown

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

══════════════════════════════════════════════════════════════

**FIELD 6: DELIVERY ADDRESS (FULL)**
WHAT TO LOOK FOR:
- The complete delivery/consignee address including street, city, state, ZIP
- Location: "Deliver To:", "Consignee:", delivery section
- Used for multi-page BOL consolidation

EXTRACTION RULE:
- Return full address as single string
- Return "" if not found

══════════════════════════════════════════════════════════════

**FIELD 7: WEIGHT**
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

══════════════════════════════════════════════════════════════

**FIELD 8: VOLUME**
WHAT TO LOOK FOR:
- Labels: "Volume-ft3", "Volume", "Cu Ft", "CF"
- Location: Item details table or totals section
- Format: Cubic feet (ft³)

EXTRACTION RULE:
- Return numeric value only (no units)
- Return 0 if not found

══════════════════════════════════════════════════════════════

**FIELD 9: LIFTGATE**
WHAT TO LOOK FOR:
- Explicit indicators: "Liftgate", "Lift Gate", "LIFTGATE" (checkbox or text)
- Location: Services section, special services, or handwritten notes
- May be circled or written in margins

⚠️ IMPORTANT: Even handwritten "LIFTGATE" counts

EXTRACTION RULE:
- Return "Yes" if liftgate service is indicated anywhere
- Return "" (empty string) if not present

══════════════════════════════════════════════════════════════

**FIELD 10: INSIDE DELIVERY**
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

══════════════════════════════════════════════════════════════

**FIELD 11: RESIDENTIAL DELIVERY**
WHAT TO LOOK FOR:
- Explicit indicators: "Residential", "Res", "RSDL", residential checkbox
- Location: Service sections, delivery type fields

DO NOT ASSUME:
- Don't guess based on address format alone
- Only mark if explicitly stated

EXTRACTION RULE:
- Return "Yes" only if explicitly marked as residential
- Return "" (empty string) if not marked or unclear

══════════════════════════════════════════════════════════════

**FIELD 12: OVER LENGTH (dimensional charges)**
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
- 145-192 inches → "145-192"
- 193-240 inches → "193-240"
- 241+ inches → "241 or more"
- Under 97 inches → "" (empty string, no charge)

EXTRACTION RULE:
- Return one of: "97-144", "145-192", "193-240", "241 or more", or ""
- Return "" if under 97 inches OR dimensions not found

══════════════════════════════════════════════════════════════

**FIELD 13: PALLET COUNT**
WHAT TO LOOK FOR:
- Labels: "Pieces", "Pallets", "Pallet", "Skid", item count
- Location: Item details section
- May be in "Type" or "Description" column

EXTRACTION RULE:
- Return numeric count
- Return 0 if not found

══════════════════════════════════════════════════════════════

**FIELD 14: DEBRIS REMOVAL SECTION**
WHAT TO LOOK FOR:
- Checkbox or section labeled "Debris Removal"
- Any indication that debris removal service is available/requested
- This is different from Lakeshore client check

EXTRACTION RULE:
- Return true if debris section/checkbox exists
- Return false if not present

══════════════════════════════════════════════════════════════

**FIELD 15: CLIENT NAME**
WHAT TO LOOK FOR:
- Client name, shipper name, or customer name
- Check if name contains "Lakeshore" anywhere

EXTRACTION RULE:
- Return the full client/shipper name as string
- Return "" if not found

══════════════════════════════════════════════════════════════

**FIELD 16: TIME-SPECIFIC DELIVERY**
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

EXTRACTION RULE:
- Return one of: "AM Special", "2 Hours", "15 Minutes", or ""
- Base decision on ACTUAL time window, not "TS" notes
- Return "" if no qualifying time window found

══════════════════════════════════════════════════════════════

**FIELD 17: DETENTION**
WHAT TO LOOK FOR:
- Handwritten notes about wait time, delay, detention
- Format: Usually in minutes or hours
- Location: Margins, additional info section, driver notes

EXTRACTION RULE:
- Return number of MINUTES (convert hours to minutes if needed)
- Return 0 if not found

══════════════════════════════════════════════════════════════

**OUTPUT FORMAT:**
Return ONLY a valid JSON object with these exact keys (no markdown, no explanations):

{
  "pro": "string",
  "pickupState": "2-letter state code",
  "deliveryState": "2-letter state code",
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
  "clientName": "string",
  "timeSpecific": "AM Special" or "2 Hours" or "15 Minutes" or "",
  "detention": number
}

**EXTRACTION PROCESS:**
1. Scan the ENTIRE document first
2. Identify the format (traditional BOL vs delivery receipt vs other)
3. Extract pickup state and delivery state FIRST (these determine if it's a fixed-price lane)
4. Locate each field using the labels and locations described above
5. For handwritten elements, look EVERYWHERE (margins, bottom, circled text)
6. When in doubt between similar fields, prefer delivery/consignee over pickup/shipper
7. Return empty string "" for missing text fields, 0 for missing numbers, false for missing booleans

**REMEMBER:**
- Pickup state and delivery state are critical for lane identification
- Zone is ALWAYS the delivery zone
- Delivery ZIP is ALWAYS from delivery address
- Check both printed and handwritten areas for services`
        }]
      }]
    });

    const textContent = message.content.find((c) => c.type === 'text')?.text;

    let extractedData;
    try {
      let cleanedText = textContent;
      const jsonStart = cleanedText.indexOf('{');
      const jsonEnd = cleanedText.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1) {
        cleanedText = cleanedText.substring(jsonStart, jsonEnd + 1);
      }
      
      cleanedText = cleanedText.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(cleanedText);
      console.log('  ✅ Successfully parsed JSON data');
    } catch (parseError) {
      console.error('  ❌ JSON Parse Error:', parseError);
      console.error('  📄 Response Text:', textContent);
      throw new Error('Failed to parse Claude response as JSON');
    }

    const pickupState = extractedData.pickupState?.toUpperCase() || '';
    const deliveryState = extractedData.deliveryState?.toUpperCase() || '';
    const laneKey = `${pickupState}-${deliveryState}`;
    
    if (FIXED_PRICE_LANES[laneKey]) {
      extractedData.isFixedLane = true;
      extractedData.laneKey = laneKey;
      extractedData.fixedPrice = FIXED_PRICE_LANES[laneKey];
      console.log(`  🛣️  Fixed price lane: ${laneKey} = $${FIXED_PRICE_LANES[laneKey]}`);
    } else {
      extractedData.isFixedLane = false;
      
      if (!extractedData.zone || !VALID_ZONES.includes(extractedData.zone.toUpperCase())) {
        const zipCode = extractedData.deliveryZip?.replace(/\D/g, '').substring(0, 5);
        
        if (zipCode && ZIP_TO_ZONE[zipCode]) {
          extractedData.zone = ZIP_TO_ZONE[zipCode];
          extractedData.zoneSource = 'ZIP';
          console.log(`  🗺️  Zone from ZIP ${zipCode}: ${extractedData.zone}`);
        } else {
          extractedData.zone = 'QUOTE';
          extractedData.zoneSource = 'UNKNOWN';
          console.warn(`  ⚠️  No zone/ZIP match - requires quote`);
        }
      } else {
        extractedData.zoneSource = 'BOL';
        console.log(`  ✓ Zone found on BOL: ${extractedData.zone}`);
      }
    }

    extractedData.isLakeshore = extractedData.clientName?.toLowerCase().includes('lakeshore') || false;

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

app.post('/api/process-bol', async (req, res) => {
  try {
    const { pdfBase64, filename } = req.body;

    if (!pdfBase64) {
      return res.status(400).json({ error: 'No PDF data provided' });
    }

    console.log(`\n📄 Processing: ${filename}`);
    
    const pages = await splitPdfPages(pdfBase64);
    const results = [];
    
    // ⭐ NEW: Add rate limiting with delays
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      
      try {
        console.log(`  ⏳ Processing page ${page.pageNumber}/${pages.length}...`);
        
        // ⭐ NEW: Add delay before processing (except first page)
        if (i > 0) {
          console.log(`  ⏸️  Waiting ${DELAY_BETWEEN_PAGES_MS}ms...`);
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
  console.log(`   ✓ Image compression: ~60% token reduction\n`);
});