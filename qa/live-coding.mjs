/**
 * 실제 배포된 GitHub Pages 주소에서 💻 코딩 탭이 동작하는지 최종 확인 (배포 후 점검).
 * 실행: node qa/live-coding.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_LIVE ?? 'https://raffinegold.github.io/raffine-voca-app/';
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const bad = [];
const steps = [];
const log = (m) => {
  steps.push(m);
  console.log(`• ${m}`);
};

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
  page.setDefaultTimeout(30000);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/r/')) bad.push(`${r.status()} ${r.url()}`);
  });

  await page.goto(BASE, { waitUntil: 'load' });
  const indexStatus = await page.request.get(BASE);
  log(`라이브 URL ${indexStatus.status()} · ${BASE}`);

  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  log('라이브 학생 로그인 OK (김서연)');

  log(`과목 전환 스위치 ${await page.getByTestId('subject-switch').count()}개 · 💻 버튼 ${await page.getByTestId('subject-coding').count()}개`);
  await page.getByTestId('subject-coding').click();
  await page.getByTestId('coding-home').waitFor();
  log('라이브 📚→💻 전환 OK · 코딩 홈 표시');

  await page.getByTestId('coding-start-mission').click();
  await page.getByTestId('coding-mission-progress').waitFor();
  const choices = page.locator('[data-testid^="coding-choice-"]');
  const idx = await choices.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
  await choices.nth(idx).click();
  await page.getByTestId('coding-feedback').waitFor();
  log(`라이브 코딩 미션 정답 처리 OK (${(await page.getByTestId('coding-feedback').innerText()).split('\n')[0]})`);
  await page.screenshot({ path: path.join(OUT, 'qa_live_coding_mission.png') });
  await page.getByText('← 그만하기').click();

  await page.getByTestId('nav-game').click();
  await page.getByTestId('coding-pick-bug').waitFor();
  await page.getByTestId('coding-pick-bug').click();
  const lines = page.locator('[data-testid^="coding-bug-line-"]');
  const bugIdx = await lines.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
  await lines.nth(bugIdx).click();
  await page.getByTestId('coding-game-feedback').waitFor();
  log('라이브 🐛 버그 찾기 플레이 OK');
  await page.screenshot({ path: path.join(OUT, 'qa_live_coding_game.png') });

  // 관리자 코딩 탭
  const adminCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block' });
  const admin = await adminCtx.newPage();
  admin.setDefaultTimeout(30000);
  await admin.goto(BASE, { waitUntil: 'load' });
  await admin.getByRole('button', { name: '원장님', exact: true }).click();
  for (const d of '9999') await admin.getByTestId(`pin-${d}`).click();
  await admin.getByText('이번 주 학원 현황').waitFor();
  await admin.getByTestId('tab-coding').click();
  await admin.getByText('코딩 학습 현황').waitFor();
  const row = await admin.getByTestId('admin-coding-row-stu-seoyeon').count();
  log(`라이브 관리자 코딩 탭 OK · 김서연 행 ${row}개`);

  console.log('\n=== LIVE RESULT ===');
  console.log(JSON.stringify({ steps: steps.length, errors: errors.slice(0, 5), bad: bad.slice(0, 5) }, null, 2));
} catch (err) {
  console.error('LIVE CHECK FAILED:', err.message);
  console.log(JSON.stringify({ steps, errors, bad }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
