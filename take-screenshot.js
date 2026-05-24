const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve('nurse-resume-generator.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Add edu items 3 & 4
  await page.evaluate(() => {
    const addB = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('+') && b.textContent.includes('Edu'));
    if (addB) { addB.click(); addB.click(); }
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const fill = (id, v) => { const e = document.getElementById(id); if(e){e.value=v; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change'));} };
    fill('eD3','Associate Degree in Nursing (ADN)');
    fill('eS3','Austin Community College of Nursing');
    fill('eY3','2015');
    fill('eD4','Post-Graduate Certificate in Critical Care Nursing');
    fill('eS4','University of Houston College of Nursing and Health Sciences');
    fill('eY4','2019');
  });
  await page.waitForTimeout(300);

  // Go to Design tab and bump edu font size
  await page.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('[data-tab]')).find(t => t.dataset.tab === 'design' || t.textContent.includes('DESIGN'));
    if (tab) tab.click();
  });
  await page.waitForTimeout(300);

  // Find edu font size slider/input and increase it
  await page.evaluate(() => {
    // Try to find edu font input
    const inputs = Array.from(document.querySelectorAll('input[type="range"], input[type="number"]'));
    // Look for edu-related size control
    const eduInput = inputs.find(i => i.id && i.id.toLowerCase().includes('edu') && i.id.toLowerCase().includes('size'));
    if (eduInput) {
      eduInput.value = parseInt(eduInput.max || 16);
      eduInput.dispatchEvent(new Event('input'));
    } else {
      // Directly set FS.edu if accessible
      if (window.FS) {
        window.FS.edu = 14;
        const ev = new Event('input');
        const el = document.querySelector('input');
        if (el) el.dispatchEvent(ev);
      }
    }
  });
  await page.waitForTimeout(1500);

  // Scroll to show page 1 bottom / page 2 top
  await page.evaluate(() => {
    const panel = document.querySelector('.preview-panel');
    if (panel) panel.scrollTop = 700;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'preview-p1-bottom.png' });

  // Scroll to show page 2
  await page.evaluate(() => {
    const panel = document.querySelector('.preview-panel');
    if (panel) panel.scrollTop = 900;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'preview-p2.png' });

  // Log sidebar data
  const info = await page.evaluate(() => {
    const papers = Array.from(document.querySelectorAll('#resume-scroll-wrap .paper'));
    return papers.map((p, i) => {
      const rl = p.querySelector('.r-left');
      return {
        page: i+1,
        scrollH: p.scrollHeight,
        rlKids: rl ? Array.from(rl.children).map(k => ({
          cls: k.className.split(' ')[0],
          text: k.textContent.trim().slice(0,50)
        })) : []
      };
    });
  });
  info.forEach(h => {
    console.log(`\np${h.page} [${h.scrollH<=828?'✓':'✗ '+h.scrollH}]:`);
    h.rlKids.forEach(k => console.log(`  ${k.cls}: "${k.text}"`));
  });

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
