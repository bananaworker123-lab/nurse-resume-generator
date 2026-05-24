const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve('nurse-resume-generator.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const papers = Array.from(document.querySelectorAll('#resume-scroll-wrap .paper'));
    return papers.map((p, i) => {
      const pRect = p.getBoundingClientRect();
      const rl = p.querySelector('.r-left');
      const rr = p.querySelector('.r-right');
      return {
        page: i + 1,
        scrollH: p.scrollHeight,
        entries: p.querySelectorAll('.r-job').length,
        rlKids: rl ? Array.from(rl.children).map(k => ({
          cls: k.className.split(' ')[0],
          text: k.textContent.trim().slice(0, 40),
        })) : [],
      };
    });
  });

  console.log('Total pages:', info.length);
  info.forEach(h => {
    const ok = h.scrollH <= 828 ? '✓' : `✗ (${h.scrollH}px)`;
    console.log(`\n  p${h.page} [${ok}] ${h.entries} jobs | sidebar (${h.rlKids.length}):`);
    h.rlKids.forEach(k => console.log(`    ${k.cls}: ${k.text}`));
  });

  // scroll to show page gap between p1 and p2
  await page.evaluate(() => {
    const panel = document.querySelector('.preview-panel');
    if (panel) panel.scrollTop = 750;
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'preview-gap.png' });
  console.log('\nScreenshot: preview-gap.png (p1→p2 boundary)');

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
