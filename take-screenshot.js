const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const filePath = 'file:///' + path.resolve('nurse-resume-generator.html').replace(/\\/g, '/');
  await page.goto(filePath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Click "Add Education" 3 times for total 5 edu items
  for (let i = 0; i < 3; i++) {
    const btn = await page.$('button[onclick*="addEdu"], button[onclick*="Edu"]') ||
                await page.$$('button').then(bs => bs.find(async b => (await b.textContent()).includes('Education')));
    // Find by text
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent.includes('Education') && b.textContent.includes('+'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(400);
  }

  // Fill in extra edu fields with content
  await page.evaluate(() => {
    const fill = (id, val) => { const el = document.getElementById(id); if(el){ el.value = val; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); } };
    // edu 3
    fill('eD3', 'Associate Degree in Nursing (ADN)');
    fill('eS3', 'Austin Community College');
    fill('eY3', '2015');
    // edu 4
    fill('eD4', 'Certified Nurse Anesthetist Program');
    fill('eS4', 'Texas A&M University Health Science Center');
    fill('eY4', '2017');
    // edu 5
    fill('eD5', 'Post-Graduate Certificate in Critical Care');
    fill('eS5', 'University of Houston College of Nursing');
    fill('eY5', '2019');
  });

  // Increase edu font size via Design tab to force overflow
  await page.evaluate(() => {
    // bump edu item font size directly if FS is accessible
    if (window.FS) {
      window.FS.edu = 14; // bigger than default
    }
    // Trigger re-render
    const ev = new Event('input');
    const any = document.querySelector('input');
    if (any) any.dispatchEvent(ev);
  });

  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => {
    const papers = Array.from(document.querySelectorAll('#resume-scroll-wrap .paper'));
    return papers.map((p, i) => {
      const rl = p.querySelector('.r-left');
      return {
        page: i + 1,
        scrollH: p.scrollHeight,
        rlKids: rl ? Array.from(rl.children).map(k => ({
          cls: k.className.split(' ')[0],
          text: k.textContent.trim().slice(0, 45),
        })) : [],
      };
    });
  });

  console.log('Total pages:', info.length);
  info.forEach(h => {
    const ok = h.scrollH <= 828 ? '✓' : `✗ (${h.scrollH}px)`;
    console.log(`\n  p${h.page} [${ok}] | sidebar (${h.rlKids.length}):`);
    h.rlKids.forEach(k => console.log(`    ${k.cls}: "${k.text}"`));
  });

  await browser.close();
})().catch(e => { console.error(e.message); process.exit(1); });
