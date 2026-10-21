/**
 * opensinnoh.com, the landing page (site/): its production build, served by the second web server in
 * playwright.config.ts. At 360, 768 and 1280 px in both themes: no sideways overflow, no console errors, text
 * contrast ≥ 4.5, no axe violations, every image described (or inside decorative art), and every Play link going
 * to play.opensinnoh.com, every Discord link to the invite, every external link with rel="noopener". Each image is scrolled into view (lazy loading as a reader meets it) and must load and
 * keep a real box: the iPhone once showed two follower frames collapsed to their title tabs. Desktop project, and the
 * opt-in WebKit project at an iPhone size (OPENSINNOH_TEST_WEBKIT=1, playwright.config.ts); the spec sets its own sizes.
 */
import { expect, test } from '@playwright/test';
import { axe } from './axe.ts';
import { contrastFailures } from './contrast.ts';

const SITE = `http://127.0.0.1:${process.env.OPENSINNOH_SITE_PORT}/`;
const DISCORD = 'https://discord.gg/DHKCWq9WkF';
const WIDTHS = [360, 390, 768, 1280];

for (const theme of ['dark', 'light'] as const) {
  test(`landing page: layout, errors, contrast, images, links (${theme})`, async ({ browser }) => {
    for (const width of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme: theme, reducedMotion: 'reduce' });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('requestfailed', (r) => errors.push(`${r.url()} ${r.failure()?.errorText}`));
      await page.goto(SITE);
      await page.evaluate(() => document.fonts.ready);
      // Scroll each image into view as a reader would; it loads (lazily) and has a box of its own shape.
      for (const img of await page.locator('img').all()) {
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0), { timeout: 10_000 }).toBe(true);
        const box = await img.evaluate((i: HTMLImageElement) => {
          const r = i.getBoundingClientRect();
          return { src: i.src, w: r.width, h: r.height, natural: i.naturalHeight / i.naturalWidth };
        });
        expect(box.w, box.src).toBeGreaterThan(40);
        expect(box.h / box.w, box.src).toBeGreaterThanOrEqual(box.natural * 0.9);
      }
      await page.evaluate(() => scrollTo(0, 0));

      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, view: innerWidth }));
      expect(overflow.page, `sideways overflow at ${width}`).toBeLessThanOrEqual(overflow.view);

      // Every image has an alt; an empty one only inside decorative art.
      const undescribed = await page.$$eval('img', (imgs) => imgs.filter((i) => !i.alt.trim() && !i.closest('[aria-hidden="true"]')).map((i) => i.src));
      expect(undescribed).toEqual([]);

      const play = await page.$$eval('a[data-play], .nav a.os-btn:not(.icon)', (as) => as.map((a) => (a as HTMLAnchorElement).href));
      expect(play.length).toBeGreaterThanOrEqual(2);
      for (const href of play) expect(href).toBe('https://play.opensinnoh.com/');

      // Discord: the top bar's icon button (named), the community block, the footer, the beta line and the FAQ.
      await expect(page.getByRole('link', { name: 'Join our Discord' })).toHaveAttribute('href', DISCORD);
      for (const sel of ['#community a.os-btn.primary', '.foot-links a:text-is("Discord")', '.beta-note a', '#faq a']) {
        await expect(page.locator(sel)).toHaveAttribute('href', DISCORD);
      }
      // The top bar's Discord mark sits centred in its button's inner box (inside the 4-px frame), on whole pixels.
      const dc = await page.$eval('.nav .dc a', (a) => {
        const r = a.getBoundingClientRect(), g = a.querySelector('path')!.getBoundingClientRect(), s = a.querySelector('svg')!.getBoundingClientRect();
        return { dx: g.x + g.width / 2 - (r.x + r.width / 2), dy: g.y + g.height / 2 - (r.y + r.height / 2), sx: s.x, sy: s.y };
      });
      expect(Math.abs(dc.dx), 'Discord mark, horizontal').toBeLessThanOrEqual(0.5);
      expect(Math.abs(dc.dy), 'Discord mark, vertical').toBeLessThanOrEqual(0.5);
      expect([dc.sx % 1, dc.sy % 1].map((v) => Math.min(v, 1 - v) < 0.01)).toEqual([true, true]);
      const external =await page.$$eval('a[href^="http"]', (as) => (as as HTMLAnchorElement[]).filter((a) => !a.relList.contains('noopener')).map((a) => a.href));
      expect(external).toEqual([]);

      // Reduced motion: the loop stays on its poster; the wordmark has no running intro.
      expect(await page.$eval('video.loop', (v: HTMLVideoElement) => v.paused)).toBe(true);
      expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);

      expect(await contrastFailures(page, 'body')).toEqual([]);
      const { violations } = await axe(page);
      expect(violations).toEqual([]);
      expect(errors).toEqual([]);
      await page.close();
    }
  });
}

test('landing page: the loop plays, pauses, and the theme pick sticks', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' });
  await page.goto(SITE);
  // No visible control: the montage itself is the pause button (WCAG 2.2.2), by click and by keyboard.
  const toggle = page.locator('button[data-loop-toggle]');
  await expect(toggle).toHaveAccessibleName('Gameplay montage, press to pause');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Gameplay montage, press to play');
  expect(await page.$eval('video.loop', (v: HTMLVideoElement) => v.paused)).toBe(true);
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAccessibleName('Gameplay montage, press to pause');
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAccessibleName('Gameplay montage, press to play');

  await page.locator('.foot [data-theme-pick="light"]').click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await expect(page.locator('.foot [data-theme-pick="light"]')).toHaveAttribute('aria-pressed', 'true');
  await page.close();
});

/**
 * Anonymous analytics (site/src/analytics.ts), PostHog intercepted: the page view, Play now and Discord with only
 * their properties, cookieless (no cookie, nothing stored); nothing under Do Not Track or without the test opt-in
 * (the page sends only on opensinnoh.com itself).
 */
for (const mode of ['opt-in', 'Do Not Track', 'no opt-in'] as const) {
  test(`landing page: analytics (${mode})`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const sent: { api_key: string; event: string; distinct_id: string; properties: Record<string, unknown> }[] = [];
    await context.route(/^https:\/\/[^/]*\.posthog\.com\//, async (route) => {
      if (route.request().method() === 'POST') sent.push(JSON.parse(route.request().postData()!));
      await route.fulfill({ status: 200, body: '{"status":"Ok"}', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' } });
    });
    // The links' targets stay on this machine.
    await context.route(/^https:\/\/(play\.opensinnoh\.com|discord\.gg)\//, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>away</title>' }));
    if (mode !== 'no opt-in') await context.addInitScript(() => ((window as { openSinnohTestAnalytics?: boolean }).openSinnohTestAnalytics = true));
    if (mode === 'Do Not Track') await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1' }));
    const page = await context.newPage();
    await page.goto(SITE);
    await expect(page.locator('#faq')).toContainText('We count visits anonymously, without cookies.');
    await page.locator('a[data-play]').click();
    await page.waitForURL('https://play.opensinnoh.com/');
    await page.goto(SITE);
    await page.getByRole('link', { name: 'Join our Discord' }).click();
    await page.waitForURL(DISCORD);
    if (mode !== 'opt-in') {
      expect(sent).toEqual([]);
      return context.close();
    }
    await expect.poll(() => sent.map((e) => e.event)).toEqual(['$pageview', 'play_now_click', '$pageview', 'discord_click']);
    const common = ['site', 'version', 'device', 'viewport', '$cookieless_mode', '$process_person_profile', '$host', '$raw_user_agent', '$timezone'];
    for (const e of sent) {
      expect(e).toMatchObject({ api_key: 'phc_nt86bScPDMTWrGxzRg6TirzTKa6CHprPKNnU2sCo4Yqt', distinct_id: '$posthog_cookieless' });
      expect(e.properties).toMatchObject({ site: 'landing', device: 'desktop', viewport: 'large', $cookieless_mode: true, $process_person_profile: false });
      expect(Object.keys(e.properties).sort()).toEqual([...common, ...(e.event === '$pageview' ? ['$current_url', '$pathname'] : [])].sort());
    }
    expect(sent[0]!.properties.$current_url).toBe(SITE);
    await page.goto(SITE);
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => [Object.keys(localStorage), Object.keys(sessionStorage), document.cookie])).toEqual([[], [], '']);
    await context.close();
  });
}

/**
 * Search discovery: the build ships robots.txt and sitemap.xml, the page has one h1 with real text, headings never
 * skip a level, and the JSON-LD parses and matches what the page shows (the FAQ word for word).
 */
test('landing page: SEO (robots, sitemap, one h1, headings, JSON-LD)', async ({ page, request }) => {
  const robots = await request.get(`${SITE}robots.txt`);
  expect(robots.ok()).toBe(true);
  const robotsText = await robots.text();
  expect(robotsText).toContain('Allow: /');
  expect(robotsText).toContain('Sitemap: https://opensinnoh.com/sitemap.xml');
  const sitemap = await request.get(`${SITE}sitemap.xml`);
  expect(sitemap.ok()).toBe(true);
  expect(await sitemap.text()).toContain('<loc>https://opensinnoh.com/</loc>');

  await page.goto(SITE);
  expect(await page.locator('h1').count()).toBe(1);
  expect(await page.locator('h1').textContent()).toMatch(/OpenSinnoh: play Pokémon Platinum in your browser/);
  await expect(page.locator('h1')).toHaveAccessibleName(/OpenSinnoh: play Pokémon Platinum in your browser/);
  const levels = await page.$$eval('h1, h2, h3, h4, h5, h6', (hs) => hs.map((h) => Number(h.tagName[1])));
  levels.forEach((l, i) => i && expect(l, `heading order at ${i}`).toBeLessThanOrEqual(levels[i - 1]! + 1));
  expect(await page.getAttribute('html', 'lang')).toBe('en');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://opensinnoh.com/');
  expect(await page.locator('meta[name="description"]').getAttribute('content')).toMatch(/Play Pokémon Platinum in your browser/);

  const blocks = await page.$$eval('script[type="application/ld+json"]', (s) => s.map((e) => e.textContent!));
  expect(blocks.length).toBeGreaterThan(0);
  const graph = blocks.flatMap((b) => (JSON.parse(b) as { '@graph': { '@type': string }[] })['@graph']);
  expect(graph.map((n) => n['@type'])).toEqual(expect.arrayContaining(['WebSite', 'Organization', 'WebApplication', 'FAQPage']));
  const app = graph.find((n) => n['@type'] === 'WebApplication') as unknown as { applicationCategory: string; offers: { price: string } };
  expect(app.applicationCategory).toBe('Game');
  expect(app.offers.price).toBe('0');
  // The FAQ markup is the visible Q&A, word for word.
  const faq = graph.find((n) => n['@type'] === 'FAQPage') as unknown as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  const visible = await page.$$eval('#faq details', (ds) => ds.map((d) => ({ name: d.querySelector('summary')!.textContent!.trim(), text: d.querySelector('p')!.textContent!.trim() })));
  expect(faq.mainEntity.map((q) => ({ name: q.name, text: q.acceptedAnswer.text }))).toEqual(visible);
});
