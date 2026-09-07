/** Run after npm run build, with a preview server listening on BLOG_TEST_URL.
 * PLAYWRIGHT_MODULE may point to an existing Playwright installation; no repo dependency is added.
 * Optional: BLOG_SCREENSHOT_DIR to save review images, CHROME_PATH for a local browser.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.BLOG_TEST_URL || 'http://127.0.0.1:8766';
const out = process.env.BLOG_SCREENSHOT_DIR;
if (out) await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const results = [];
const errors = [];
const check = (name, ok) => { assert.ok(ok, name); results.push(name); console.log('PASS', name); };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, colorScheme: 'light' });
  const page = await context.newPage();
  await page.addInitScript(() => document.addEventListener('astro:page-load', () => { window.__testPageReady = true; }));
  page.on('pageerror', e => errors.push(e.message));
  const go = async path => { await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.__testPageReady === true); await page.waitForTimeout(100); };
  const theme = () => page.locator('html').getAttribute('data-visual-theme');
  const shot = async name => { if (out) await page.screenshot({ path: join(out, `${name}.png`) }); };
  await go('/');
  check('Fresh visitors default to cyanotype', await theme() === 'cyanotype');
  check('Original hero text visible', (await page.locator('h1:visible').innerText()).includes('慢慢显影'));
  check('Theme controls contain SVG, not Unicode icons', await page.locator('[data-theme-icon] svg').count() === 2 && !(await page.locator('[data-theme-icon]').innerText()).trim());
  check('One hero heading in accessibility layout', await page.locator('h1:visible').count() === 1);
  const articleHref = await page.locator('.catalog-content h2 a').first().getAttribute('href');
  await shot('cyanotype-desktop');
  await page.locator('.theme-toggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.waitForTimeout(300);
  check('Dark SVG toggles correctly', await page.locator('[data-theme-icon] .ui-icon--moon').isVisible());
  await shot('cyanotype-dark');
  // Exercise real Astro client routing, rather than only full navigations.
  await page.locator('.site-header a[href="/about/"]').click();
  await page.waitForURL('**/about/');
  await page.waitForTimeout(400);
  check('Astro navigation preserves both preferences', await theme() === 'cyanotype' && await page.locator('html').getAttribute('data-theme') === 'dark');
  await page.locator('.theme-toggle').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  check('Day/night button rebinds after navigation', true);
  for (const name of ['still', 'fluid', 'minimal', 'trace', 'cyanotype']) {
    await page.locator(`[data-visual-theme-option="${name}"]`).click();
    await page.waitForFunction(t => document.documentElement.dataset.visualTheme === t, name);
    check(`${name}: theme switch and selected state`, await page.locator(`[data-visual-theme-option="${name}"]`).getAttribute('aria-pressed') === 'true');
    check(`${name}: no duplicate cyanotype copy`, name === 'cyanotype' || await page.locator('[data-theme-copy-cyanotype]:visible').count() === 0);
    await page.locator('.site-header nav a[href="/"]').click();
    await page.waitForURL(`${base}/`); await page.waitForTimeout(300);
    check(`${name}: persists through client navigation`, await theme() === name);
    check(`${name}: one visible homepage heading`, await page.locator('h1:visible').count() === 1);
    await page.locator('.site-header a[href="/about/"]').click();
    await page.waitForURL('**/about/'); await page.waitForTimeout(300);
  }
  await shot('cyanotype-about');
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(250);
  check('Theme preference survives reload', await theme() === 'cyanotype');
  await go('/blog/');
  await page.locator('[data-order-sort="oldest"]').click(); await page.waitForTimeout(250);
  const dates = await page.locator('[data-order-card]').evaluateAll(nodes => nodes.map(n => n.dataset.orderDate));
  check('Article date ordering works', dates.every((d, i) => !i || dates[i - 1] <= d));
  await page.locator('[data-catalog-view="cards"]').click();
  check('Article card layout works', await page.locator('[data-catalog-list]').getAttribute('data-catalog-layout') === 'cards');
  await page.locator('[data-catalog-view="rows"]').click();
  await shot('cyanotype-blog');
  await go('/gallery/');
  await page.locator('[data-gallery-view="timeline"]').click();
  await page.locator('[data-gallery-sort="oldest"]').click(); await page.waitForTimeout(250);
  await page.waitForFunction(() => document.querySelector('.gallery-masonry--journal [data-theme-copy-cyanotype]')?.textContent.includes('切片'));
  check('Gallery sequence uses cyanotype copy after sorting', true);
  await page.locator('.gallery-masonry--journal [data-gallery-open]:visible').first().click();
  check('Gallery lightbox opens', await page.locator('#gallery-viewer').isVisible());
  await page.keyboard.press('Escape');
  check('Gallery lightbox closes with Escape', !await page.locator('#gallery-viewer').isVisible());
  await page.locator('[data-gallery-tab="independent"]').click();
  check('Independent photos tab works', await page.locator('[data-gallery-tab="independent"]').getAttribute('aria-selected') === 'true');
  await shot('cyanotype-gallery');
  await go('/blog/分享一首歌-music-player-test/');
  check('Music controls use original SVG icons', await page.locator('.song-player__toggle svg').count() > 0 && await page.locator('.song-player__volume-toggle svg').count() > 0);
  const volume = page.locator('.song-player__volume-toggle').first();
  await volume.click();
  check('Mute control updates accessible state', await volume.getAttribute('aria-label') === '取消静音');
  await volume.click();
  check('Unmute control restores state', await volume.getAttribute('aria-label') === '静音');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/', '/blog/', '/gallery/', '/about/', '/private/', '/404.html', articleHref]) {
      await go(route);
      const measure = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, offenders: [...document.querySelectorAll('main *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 8).map(e => `${e.tagName}.${e.className}`) }));
      check(`No horizontal overflow at ${width}px on ${route}: ${JSON.stringify(measure)}`, measure.sw <= measure.w + 1);
      if (width === 390 && ['/', articleHref].includes(route)) await shot(route === '/' ? 'cyanotype-mobile' : 'cyanotype-article-mobile');
    }
  }
  await context.close();
  const noJS = await browser.newContext({ javaScriptEnabled: false });
  const noJSPage = await noJS.newPage();
  await noJSPage.goto(base, { waitUntil: 'domcontentloaded' });
  check('SSR default and original copy work without JavaScript', (await noJSPage.locator('h1:visible').innerText()).includes('慢慢显影'));
  await noJS.close();
  const blocked = await browser.newContext({ reducedMotion: 'reduce' });
  const blockedPage = await blocked.newPage();
  await blockedPage.addInitScript(() => { Storage.prototype.getItem = () => { throw new Error('Storage disabled'); }; Storage.prototype.setItem = () => { throw new Error('Storage disabled'); }; });
  blockedPage.on('pageerror', e => errors.push(e.message));
  await blockedPage.goto(`${base}/about/`, { waitUntil: 'domcontentloaded' }); await blockedPage.waitForTimeout(300);
  await blockedPage.locator('[data-visual-theme-option="trace"]').click();
  await blockedPage.locator('[data-visual-theme-option="cyanotype"]').click();
  check('Theme picker works without localStorage', await blockedPage.locator('html').getAttribute('data-visual-theme') === 'cyanotype');
  await blockedPage.locator('.theme-toggle').click();
  check('Reduced-motion mode avoids transition class', !(await blockedPage.locator('html').getAttribute('class')).split(' ').includes('vt'));
  await blocked.close();
  check(`No uncaught browser errors: ${errors.join('; ')}`, errors.length === 0);
  console.log(JSON.stringify({ passed: results.length, checks: results }, null, 2));
} finally { await browser.close(); }

