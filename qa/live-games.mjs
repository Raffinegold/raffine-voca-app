/**
 * 라이브 점검 — GitHub Pages 에 배포된 게임 10종 화면이 실제로 뜨고 조작되는지 확인합니다.
 *
 *   node qa/live-games.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.LIVE_BASE || 'https://raffinegold.github.io/raffine-voca-app/';
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
const errors = [];
const log = (m) => console.log(`• ${m}`);

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
  page.setDefaultTimeout(20000);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  const res = await page.goto(BASE, { waitUntil: 'load' });
  log(`라이브 응답 ${res?.status()} · ${BASE}`);

  await page.getByTestId('student-stu-seoyeon').click();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  log('학생 로그인 성공');

  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  log(`영어 게임 카드 ${await page.locator('[data-testid^="eng-pick-"]').count()}개`);

  await page.getByTestId('eng-pick-rain').click();
  await page.getByTestId('eng-rain-input').waitFor();
  await page.waitForTimeout(2600);
  for (let i = 0; i < 3; i += 1) {
    const words = (await page.getByTestId('eng-rain-words').getAttribute('data-words')) || '';
    const first = words.split(' ').filter(Boolean)[0];
    if (!first) {
      await page.waitForTimeout(500);
      continue;
    }
    await page.getByTestId('eng-rain-input').fill(first);
    await page.waitForTimeout(450);
  }
  const kills = await page.getByTestId('eng-rain-kills').innerText();
  log(`라이브 산성비 격추 HUD: ${kills.replace(/\n/g, ' ')}`);
  await page.screenshot({ path: `${OUT}/qa_live_eng_rain.png` });

  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await page.getByTestId('subject-coding').click();
  await page.getByTestId('coding-game-menu').waitFor();
  log(`코딩 게임 카드 ${await page.locator('[data-testid^="coding-pick-"]').count()}개`);

  await page.getByTestId('coding-pick-robot').click();
  await page.getByTestId('cod-robot-grid').waitFor();
  const stageBefore = await page.getByTestId('cod-robot-stage').innerText();
  const sol = (await page.getByTestId('cod-robot-grid').getAttribute('data-solution')).split(',').filter(Boolean);
  for (const c of sol) await page.getByTestId(`cod-robot-cmd-${c}`).click();
  await page.getByTestId('cod-robot-run').click();
  await page.waitForTimeout(900 + sol.length * 380 + 400);
  const stageAfter = await page.getByTestId('cod-robot-stage').innerText();
  log(`라이브 로봇: ${stageBefore} → ${stageAfter} (다음 스테이지로 넘어가면 클리어)`);
  await page.screenshot({ path: `${OUT}/qa_live_cod_robot.png` });

  await page.getByTestId('nav-game').click();
  await page.getByTestId('coding-game-menu').waitFor();
  await page.getByTestId('coding-pick-hacker').click();
  await page.getByTestId('cod-hacker-lock-0').waitFor();
  const opts = page.locator('[data-testid^="cod-hacker-option-"]');
  const idx = await opts.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
  if (idx >= 0) await opts.nth(idx).click();
  await page.waitForTimeout(700);
  log(`라이브 해커 FW1 열림: ${await page.getByTestId('cod-hacker-lock-0').getAttribute('data-open')}`);
  await page.screenshot({ path: `${OUT}/qa_live_cod_hacker.png` });
} finally {
  await browser.close();
}

console.log(`\n=== 라이브 콘솔 오류 ${errors.length}건 ===`);
for (const e of errors.slice(0, 8)) console.log(' -', String(e).slice(0, 200));
process.exitCode = errors.length ? 1 : 0;
