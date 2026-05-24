/**
 * server.js — Nurse Resume Generator API
 * Express + Playwright, designed for Railway deployment
 *
 * POST /api/generate   { ...collectData(), accent, ver, _orderId, ... }
 *   → streams back a ZIP containing 8 PDFs
 *
 * GET  /               → serves nurse-resume-generator.html
 */

const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');
const archiver = require('archiver');
const { chromium } = require('playwright');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Concurrency limiter ────────────────────────────────────────────
// Each Playwright job needs ~300-500 MB RAM.
// Railway free tier: 512 MB → allow 1 job at a time to be safe.
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '1', 10);
let activeJobs = 0;
const jobQueue = [];

function acquireSlot() {
  return new Promise(resolve => {
    const tryAcquire = () => {
      if (activeJobs < MAX_CONCURRENT) { activeJobs++; resolve(); }
      else jobQueue.push(tryAcquire);
    };
    tryAcquire();
  });
}
function releaseSlot() {
  activeJobs--;
  if (jobQueue.length) jobQueue.shift()();
}

// ── Docs × Sizes ──────────────────────────────────────────────────
const DOCS = [
  { param: 'resume1', label: 'Resume'        },
  { param: 'cover',   label: 'Cover_Letter'  },
  { param: 'refs',    label: 'References'    },
];
const SIZES = [
  { name: 'USLetter', param: 'letter', width: '8.5in',  height: '11in'  },
  { name: 'A4',       param: 'a4',     width: '210mm',  height: '297mm' },
];

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname)));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'nurse-resume-generator.html')));

// ── Health check ─────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, activeJobs }));

// ── Main endpoint ─────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const order = req.body;

  // Basic validation
  if (!order?.fn || !order?.ln) {
    return res.status(400).json({ error: 'Missing fn / ln in request body' });
  }

  // Queue check — tell client if server is busy
  if (activeJobs >= MAX_CONCURRENT) {
    return res.status(503).json({ error: 'Server busy — please retry in 30 seconds' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nurse-'));
  await acquireSlot();

  const browser = await chromium.launch({ headless: true }).catch(err => {
    releaseSlot();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  });

  try {
    const htmlPath = path.join(__dirname, 'nurse-resume-generator.html');
    const baseUrl  = `file://${htmlPath}`;
    const context  = await browser.newContext({ viewport: { width: 640, height: 900 } });
    const pdfPaths = [];

    // NEW-BUG-01: sanitize once here so both PDF filenames and ZIP filename are clean
    const safeName = (str='') => (str+'').replace(/[^a-zA-Z0-9À-ɏ_\-]/g, '_').trim() || 'Resume';
    const safeFirst = safeName(order.fn);
    const safeLast  = safeName(order.ln);

    for (const doc of DOCS) {
      for (const size of SIZES) {
        const filename = `${safeFirst}_${safeLast}_${doc.label}_${size.name}.pdf`;
        const outPath  = path.join(tmpDir, filename);

        const page = await context.newPage();
        try {
          await page.addInitScript((o) => {
        window.__ORDER__ = o;
        // Apply margins from order if present
        if(o._margins) window.__MARGINS__ = o._margins;
      }, order);
          await page.goto(`${baseUrl}?print=1&doc=${doc.param}&size=${size.param}`, {
            waitUntil: 'networkidle',
            timeout: 30_000,
          });
          const ready = await page.waitForFunction(
            () => window.__PRINT_READY__ === true,
            { timeout: 12_000 }
          ).then(() => true).catch(() => false);

          if (!ready) await page.waitForTimeout(2000);

          // WARN-02: detect content overflow before generating PDF
          const overflowInfo = await page.evaluate(() => {
            const paper = document.querySelector('.paper');
            if (!paper) return null;
            return { scrollH: paper.scrollHeight, overflow: paper.scrollHeight > 1056 * 1.02 };
          }).catch(() => null);
          if (overflowInfo?.overflow) {
            console.warn(`  ⚠ Content overflow in ${doc.label} ${size.name}: ${overflowInfo.scrollH}px > 1077px`);
          }

          // Scale: viewport is 640px → scale up to fill the PDF page exactly
          // Letter 8.5in = 816px @96dpi → 816/640 = 1.275
          // A4 210mm = 794px @96dpi → 794/640 = 1.241
          const pdfScale = size.name === 'A4' ? 1.241 : 1.275;
          await page.pdf({
            path:            outPath,
            width:           size.width,
            height:          size.height,
            printBackground: true,
            preferCSSPageSize: false,
            scale:           pdfScale,
            margin:          { top: '0', right: '0', bottom: '0', left: '0' },
          });
          pdfPaths.push({ path: outPath, doc: doc.label, overflow: overflowInfo?.overflow || false });
        } finally {
          await page.close();
        }
      }
    }

    // ── Stream ZIP back to client ────────────────────────────────
    // BUG-04: safeFirst/safeLast already computed above (NEW-BUG-01 fix)
    const zipName   = `${safeFirst}_${safeLast}_Resume_Package.zip`;
    // RFC 5987 encoding for non-ASCII names (Müller, García, etc.)
    const encodedName = encodeURIComponent(zipName);
    // USER-BUG-03: pass overflow warnings as header so client can show message
    const overflowDocs = pdfPaths
      .filter(p => p.overflow)
      .map(p => p.doc)
      .filter((v,i,a) => a.indexOf(v)===i);
    if (overflowDocs.length) {
      res.setHeader('X-Overflow-Warning', overflowDocs.join(','));
    }
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition',
      `attachment; filename="${zipName.replace(/"/g, '_')}"; filename*=UTF-8''${encodedName}`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);
    for (const p of pdfPaths) archive.file(p.path, { name: path.basename(p.path) });
    await archive.finalize();

  } finally {
    await browser.close();
    releaseSlot();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  if (!res.headersSent) res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Nurse Resume Generator listening on port ${PORT}`);
  console.log(`Max concurrent jobs: ${MAX_CONCURRENT}`);
});
