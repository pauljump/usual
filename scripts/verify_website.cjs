#!/usr/bin/env node
/* Local browser verification. Supply installed Playwright through NODE_PATH.
 * USUAL_BROWSER_EXECUTABLE may point to a local Chromium/Chrome executable.
 * No browser is downloaded; all external requests are blocked during this run.
 * Run: node scripts/verify_website.cjs http://127.0.0.1:8876 /tmp/usual-site-evidence
 */
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const base = new URL(process.argv[2] || 'http://127.0.0.1:8876');
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a loopback-only preview.');
  const out = path.resolve(process.argv[3] || '/tmp/usual-site-evidence');
  await fs.mkdir(out, {recursive:true});
  const browser = await chromium.launch({headless:true, ...(process.env.USUAL_BROWSER_EXECUTABLE ? {executablePath:process.env.USUAL_BROWSER_EXECUTABLE} : {})});
  const context = await browser.newContext({viewport:{width:1440,height:1000}, reducedMotion:'reduce', acceptDownloads:true});
  const external = [], errors = [], results = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== base.origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.copiedText = '';
    Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:async value => {window.copiedText=value;}}});
  });
  const shot = async name => {await page.screenshot({path:path.join(out,name+'.png'),fullPage:true});results.push(name);};
  const noOverflow = async label => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ' overflows horizontally');
  await page.goto(base.href);
  await page.waitForSelector('[data-demo-next="finding"]');
  await noOverflow('Desktop homepage');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.skip-link').evaluate(element=>document.activeElement===element),true);
  assert.equal(await page.locator('.skip-link').evaluate(element=>getComputedStyle(element).opacity),'1');
  await page.keyboard.press('Tab');
  await shot('01-home-desktop');
  await page.locator('[data-demo-next="finding"]').click();
  await page.locator('.evidence-details summary').click();
  assert.equal(await page.locator('.evidence-card').count(),2);
  assert.match(await page.locator('#demo-stage').innerText(), /note-only handoff/);
  await shot('02-cited-finding');
  await page.locator('[data-demo-next="action"]').click();
  assert.match(await page.locator('#recorded-command').innerText(),/loops run release-files/);
  await shot('03-local-routine');
  await page.locator('[data-demo-next="receipt"]').click();
  assert.equal(await page.locator('.receipt-check').count(),2);
  assert.match(await page.locator('.receipt-limit').innerText(), /does not verify application behavior/);
  await shot('04-receipt');
  await page.locator('[data-demo-next="share"]').click();
  const recipe = JSON.parse(await page.locator('#sample-recipe').innerText());
  assert.deepEqual(recipe.modules.map(item=>item.id), ['loops','pop']);
  assert(!JSON.stringify(recipe).includes('sample-flagship'));
  await shot('05-recipe');
  const downloadEvent = page.waitForEvent('download');
  await page.locator('[data-download-recipe]').click();
  const download = await downloadEvent;
  await download.saveAs(path.join(out, 'downloaded-example-recipe.json'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(out,'downloaded-example-recipe.json'),'utf8')),recipe);
  const cardPage = await context.newPage();
  const cardResponse = await cardPage.goto(new URL('/example-setup.html',base).href);
  assert.equal(cardResponse.status(),200);
  const cardText = await cardPage.locator('body').innerText();
  assert.match(cardText,/loops/i);
  assert.match(cardText,/pop/i);
  assert(!cardText.includes('sample-flagship'));
  await cardPage.screenshot({path:path.join(out,'06-shareable-html.png'),fullPage:true});
  results.push('06-shareable-html');
  await cardPage.close();
  await page.locator('[data-demo-step="scope"]').click();
  await page.locator('[data-sample="thin"]').click();
  await page.locator('[data-demo-next="finding"]').click();
  assert.match(await page.locator('.empty-state').innerText(), /No supported recurring request/);
  await shot('06-empty-state');
  await page.locator('#handoff-scope').selectOption('none');
  assert.match(await page.locator('#handoff-prompt').inputValue(),/Start without importing history/);
  await page.locator('[data-copy-target="handoff-prompt"]').click();
  assert.match(await page.evaluate(()=>window.copiedText),/Start without importing history/);
  await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw new Error('Denied for test')};});
  await page.locator('[data-copy-target="handoff-prompt"]').click();
  assert.match(await page.locator('#notice').innerText(), /Automatic copy isn’t available/);
  assert(await page.locator('#handoff-prompt').evaluate(element=>element.selectionEnd>element.selectionStart));
  await shot('07-copy-fallback');
  let releaseFixture;
  const pendingFixture = new Promise(resolve => {releaseFixture = resolve;});
  await page.route('**/flagship.json', async route => {await pendingFixture;await route.abort();});
  await page.goto(base.href);
  await page.waitForSelector('.loading-state');
  await shot('08-loading-state');
  releaseFixture();
  await page.waitForSelector('.error-state');
  await shot('09-error-state');
  await page.unroute('**/flagship.json');
  await page.locator('[data-demo-retry]').click();
  await page.waitForSelector('[data-demo-next="finding"]');
  const items = ['vibecheck','choices','recall','loops','pop','escape'];
  for (const id of items) {
    await page.goto(new URL(`/menu/${id}/`,base).href);
    assert.equal(await page.locator('h1').count(),1);
    await noOverflow(id+' desktop');
    assert(await page.locator('#item-prompt').inputValue());
    await shot(`tool-${id}-desktop`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(base.href);
  await page.waitForSelector('[data-demo-next="finding"]');
  await noOverflow('Mobile homepage');
  await shot('10-home-mobile');
  await page.locator('[data-demo-step="finding"]').click();
  await page.locator('.evidence-details summary').click();
  await noOverflow('Mobile expanded finding');
  assert.equal(await page.locator('.skip-link').evaluate(element=>getComputedStyle(element).opacity),'0');
  await shot('11-finding-mobile');
  for (const id of items) {
    await page.goto(new URL(`/menu/${id}/`,base).href);
    await noOverflow(id+' mobile');
    await shot(`tool-${id}-mobile`);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(new URL('/escape/demo/',base).href);
  await page.locator('#show-escape').click();
  assert.match(await page.locator('#escape-status').innerText(), /Forced example opened/);
  assert(! (await page.locator('body').innerText()).includes('undefined'));
  await shot('12-escape-forced-desktop');
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  assert.deepEqual(external, [], 'New collection pages attempted external requests');
  const report = {origin:base.origin,kind:'scripted Chromium browser verification',browser:await browser.version(),viewport_desktop:'1440×1000',viewport_mobile:'390×844',screenshots:results,checks:['six catalog pages desktop/mobile','cited finding and exception','recorded routine and receipt','sanitized recipe download','thin-history state','loading/error/retry','copy and manual-copy fallback','no horizontal overflow','forced Escape example','no external requests'],limitations:['Synthetic fixture and scripted browser checks do not establish fresh live-agent behavior or actual in-app-browser device support.']};
  await fs.writeFile(path.join(out,'browser-report.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{console.error(error);process.exit(1);});
