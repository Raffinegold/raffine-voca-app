/**
 * 배포 후 라이브 점검 — GitHub Pages 주소에서 게임·상점 탭이 실제로 렌더링되는지 확인합니다.
 * 실행: node qa/live-game-shop.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_LIVE ?? 'https://raffinegold.github.io/raffine-voca-app';
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const log = (m) => {
  results.push(m);
  console.log(`• ${m}`);
};

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ kind: 'console', text: m.text() });
  });
  page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: e.message }));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push({ kind: 'http', text: `${r.status()} ${r.url()}` });
  });

  const homeRes = await page.request.get(`${BASE}/`);
  const html = await homeRes.text();
  const bundle = (html.match(/assets\/index-[A-Za-z0-9_-]*\.js/) ?? [''])[0];
  log(`라이브 응답 ${homeRes.status()} · 번들 ${bundle}`);

  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.getByText('라피네 영단어').first().waitFor();
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  log('학생 로그인 OK · 하단 탭에 게임/상점 노출');

  await page.getByTestId('nav-game').click();
  await page.getByTestId('game-board').waitFor();
  const cardCount = await page.locator('[data-testid^="game-card-"]').count();
  const dailyText = (await page.getByTestId('game-daily-earned').innerText()).replace(/\s+/g, ' ');
  log(`게임 탭 렌더 OK · 카드 ${cardCount}장 · 오늘 적립 ${dailyText} · URL ${page.url()}`);
  await page.screenshot({ path: path.join(OUT, 'qa_live_game.png') });

  // 새로고침해도 게임 경로가 살아 있는지 (Pages 404.html 폴백 + basename 라우터)
  await page.reload({ waitUntil: 'load' });
  await page.getByTestId('game-board').waitFor();
  log('게임 경로 새로고침 후에도 보드 유지 OK');

  await page.getByTestId('nav-shop').click();
  await page.getByText('기프티콘 상점').first().waitFor();
  const balance = await page.getByTestId('shop-balance').innerText();
  const items = await page.locator('[data-testid^="shop-item-"]').count();
  log(`상점 탭 렌더 OK · 보유 ${balance.replace(/\s+/g, '')} · 상품 ${items}개 · URL ${page.url()}`);
  await page.screenshot({ path: path.join(OUT, 'qa_live_shop.png') });

  await page.reload({ waitUntil: 'load' });
  await page.getByTestId('shop-balance').waitFor();
  log('상점 경로 새로고침 OK');

  // 관리자
  const admin = await ctx.newPage();
  admin.setDefaultTimeout(20000);
  admin.on('pageerror', (e) => errors.push({ kind: 'admin-pageerror', text: e.message }));
  await admin.goto(`${BASE}/`, { waitUntil: 'load' });
  await admin.getByText('안녕, 김서연!').waitFor();
  await admin.evaluate(() => localStorage.removeItem('rafine-voca-session-v1'));
  await admin.reload({ waitUntil: 'load' });
  await admin.getByRole('button', { name: '원장님', exact: true }).click();
  for (const d of '9999') await admin.getByTestId(`pin-${d}`).click();
  await admin.getByText('이번 주 학원 현황').waitFor();
  await admin.setViewportSize({ width: 1280, height: 900 });
  await admin.getByTestId('tab-shop').click();
  await admin.getByText('상점 · 교환 관리').waitFor();
  const shopTabText = await admin.locator('main').innerText();
  log(
    `관리자 상점·교환 탭 OK · 일일 상한 카드 ${shopTabText.includes('일일 캐시 적립 상한')} · 상품 관리 ${shopTabText.includes('상점 상품 관리')}`
  );

  console.log('\n=== LIVE RESULT ===');
  console.log(JSON.stringify({ base: BASE, bundle, errors }, null, 2));
} catch (err) {
  console.error('LIVE CHECK FAILED:', err);
  console.log(JSON.stringify({ base: BASE, errors, results }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
