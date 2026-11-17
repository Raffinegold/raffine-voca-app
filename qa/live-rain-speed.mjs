/**
 * 라이브(GitHub Pages) 배포 확인 — 산성비 2종 속도 선택 · WAVE 배지
 *
 *   node qa/live-rain-speed.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const LIVE = process.env.LIVE_URL ?? 'https://raffinegold.github.io/raffine-voca-app/';
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const log = (m) => console.log(`• ${m}`);
const fail = (m) => {
  errors.push(m);
  console.log(`✗ ${m}`);
};
const check = (c, ok, bad) => (c ? log(ok) : fail(bad));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(25000);
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => r.status() >= 400 && errors.push(`http ${r.status()} ${r.url()}`));

  const res = await page.goto(LIVE, { waitUntil: 'load' });
  log(`라이브 응답 ${res.status()} · ${page.url()}`);
  await page.getByText('라피네').first().waitFor();
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 });
  log('라이브 로그인 성공 (김서연 · 1111)');

  /* 영어 산성비 */
  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await page.getByTestId('eng-pick-rain').click();
  await page.getByTestId('eng-rain-canvas').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  const engBtns = await page.locator('[data-testid^="eng-rain-speed-"]').count();
  check(engBtns === 3, '라이브 영어 산성비 속도 버튼 3개', `라이브 영어 속도 버튼 ${engBtns}개`);
  const engActive = await page.locator('[data-testid^="eng-rain-speed-"][data-active="1"]').getAttribute('data-testid');
  check(String(engActive).endsWith('speed-normal'), '라이브 영어 기본 속도 = 보통', `라이브 영어 기본 속도 ${engActive}`);
  const engWave = (await page.getByTestId('eng-rain-wave').innerText()).replace(/\s+/g, ' ').trim();
  check(/WAVE\s*1/.test(engWave), `라이브 영어 WAVE 배지: ${engWave}`, `라이브 영어 WAVE 배지 없음 (${engWave})`);
  await page.getByTestId('eng-rain-speed-fast').click();
  await page.waitForTimeout(400);
  check(
    (await page.getByTestId('eng-rain-root').getAttribute('data-speed')) === 'fast',
    '라이브 영어 빠름 선택 반영',
    '라이브 영어 빠름 선택 미반영'
  );
  await page.waitForTimeout(2600);
  await page.screenshot({ path: path.join(OUT, 'qa_live_rain_speed.png') });
  log('라이브 스크린샷 qa_live_rain_speed.png');

  /* 코딩 키워드 디펜스 */
  await page.getByTestId('subject-coding').click().catch(() => {});
  await page.getByTestId('coding-daily-earned').waitFor();
  await page.goto(`${LIVE.replace(/\/$/, '')}/game?g=rain`, { waitUntil: 'load' });
  await page.getByTestId('cod-rain-canvas').waitFor();
  await page.waitForTimeout(700);
  const codBtns = await page.locator('[data-testid^="cod-rain-speed-"]').count();
  check(codBtns === 3, '라이브 코딩 디펜스 속도 버튼 3개', `라이브 코딩 속도 버튼 ${codBtns}개`);
  const codWave = (await page.getByTestId('cod-rain-wave').innerText()).replace(/\s+/g, ' ').trim();
  check(/WAVE\s*1/.test(codWave), `라이브 코딩 WAVE 배지: ${codWave}`, `라이브 코딩 WAVE 배지 없음 (${codWave})`);
  await page.getByTestId('cod-rain-speed-slow').click();
  await page.waitForTimeout(400);
  check(
    (await page.getByTestId('cod-rain-root').getAttribute('data-speed')) === 'slow',
    '라이브 코딩 느림 선택 반영',
    '라이브 코딩 느림 선택 미반영'
  );
} catch (e) {
  errors.push(`exception: ${e?.stack || e}`);
  console.log('✗ 예외:', e?.message || e);
} finally {
  await browser.close();
}

console.log(`\n=== 라이브 확인: ${errors.length ? `오류 ${errors.length}건` : '오류 0건'} ===`);
for (const e of errors.slice(0, 10)) console.log(` - ${String(e).slice(0, 200)}`);
process.exit(errors.length ? 1 : 0);
