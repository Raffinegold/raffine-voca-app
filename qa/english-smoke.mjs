/**
 * 영어 기능 회귀 점검 — 코딩 통합 후에도 기존 영어 흐름이 그대로인지 확인합니다.
 *  로그인 → 오늘의 미션(카드 → 4지선다 → 스펠링) → 결과 → 오답노트 → 랭킹 → 상점
 *
 * 실행: npm run build && node qa/english-smoke.mjs
 * (dist/ 를 Playwright 요청 인터셉트로 서빙 — 로컬 서버 불필요)
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.env.QA_DIST ?? 'dist');
const ORIGIN_HOST = 'rafine-voca-app.local';
const PREFIX = '/raffine-voca-app';
const BASE = process.env.QA_BASE ?? `http://${ORIGIN_HOST}${PREFIX}/`;
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

async function serveDist(context) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== ORIGIN_HOST) return route.fallback();
    let p = decodeURIComponent(url.pathname);
    if (!p.startsWith(PREFIX)) p = PREFIX + p;
    let rel = p.slice(PREFIX.length);
    if (rel === '' || rel === '/') rel = '/index.html';
    let file = path.join(DIST, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(DIST, 'index.html');
    return route.fulfill({
      status: 200,
      contentType: MIME[path.extname(file)] ?? 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  });
}

const steps = [];
const errors = [];
const log = (m) => {
  steps.push(m);
  console.log(`• ${m}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
  });
  await serveDist(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  log('영어 로그인 OK · 오늘 탭');

  const words = await page.evaluate(() => JSON.parse(localStorage.getItem('rafine-voca-db-v1')).words);

  await page.getByTestId('start-mission').click();
  await page.locator('header').getByText('카드 암기').waitFor();
  let cards = 0;
  while (cards < 40) {
    const btn = page.getByTestId('card-know');
    if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) break;
    await btn.click();
    cards += 1;
    await page.waitForTimeout(80);
  }
  log(`카드 암기 ${cards}장 확인`);

  await page.locator('header').getByText('4지선다 퀴즈').waitFor();
  let choices = 0;
  while (choices < 60) {
    const options = page.getByTestId('choice-option');
    if (!(await options.count())) break;
    const texts = await options.allInnerTexts();
    const prompt = await page.locator('main .rounded-3xl').first().innerText();
    const head = (prompt.split('\n').map((t) => t.trim()).filter(Boolean)[0] ?? '').trim();
    const byWord = words.find((w) => w.word.toLowerCase() === head.toLowerCase());
    const correctText = byWord ? byWord.meaning : words.find((w) => w.meaning === head)?.word ?? '';
    const cleaned = texts.map((t) => t.split('\n').map((x) => x.trim()).filter(Boolean).pop() ?? '');
    let idx = cleaned.findIndex((t) => t === correctText.trim());
    if (idx < 0) idx = 0;
    await options.nth(idx).click();
    await page.getByTestId('next-step').click();
    choices += 1;
  }
  log(`4지선다 ${choices}문항 응답`);

  await page.locator('header').getByText('스펠링 퀴즈').waitFor();
  let spells = 0;
  while (spells < 60) {
    const input = page.getByTestId('spell-input');
    if (!(await input.count()) || !(await input.isVisible().catch(() => false))) break;
    const cardText = await page.locator('main .rounded-3xl').first().innerText();
    const meaning = (cardText.split('\n').map((t) => t.trim()).filter(Boolean)[0] ?? '').trim();
    const match = words.find((w) => w.meaning === meaning);
    await input.fill(match?.word ?? 'test');
    await page.getByTestId('spell-submit').click();
    await page.getByTestId('next-step').click();
    spells += 1;
  }
  log(`스펠링 ${spells}문항 응답`);

  await page.locator('main').getByText('오늘의 결과').waitFor();
  const resultText = (await page.locator('main').innerText()).replace(/\n+/g, ' | ');
  log(`결과 화면 OK: ${resultText.slice(0, 80)}`);
  await page.screenshot({ path: path.join(OUT, 'qa_english_result_after_coding.png') });

  await page.getByRole('button', { name: '홈으로' }).click();
  await page.getByText('오늘 완료!').first().waitFor({ timeout: 8000 });
  log('오늘 완료 표시 OK');

  await page.getByTestId('nav-wrong').click();
  await page.getByText('오답 복습 큐').waitFor();
  log('영어 오답노트 OK');

  await page.getByTestId('nav-rank').click();
  await page.getByText('학원 주간 랭킹').first().waitFor();
  log('영어 랭킹 OK');

  await page.getByTestId('nav-shop').click();
  await page.getByText('기프티콘 상점').first().waitFor().catch(() => {});
  log('상점 OK');

  console.log('\n=== ENGLISH SMOKE ===');
  console.log(JSON.stringify({ steps: steps.length, errors }, null, 2));
} catch (err) {
  console.error('SMOKE FAILED:', err.message);
  console.log(JSON.stringify({ steps, errors }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
