/**
 * 라이브(GitHub Pages) 배포본에서 배경음악(BGM) 동작을 확인 — 스크린샷 없이 빠르게.
 *
 *   node qa/live-bgm.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_LIVE ?? 'https://raffinegold.github.io/raffine-voca-app';
const errors = [];
const checks = [];
const check = (ok, m) => {
  checks.push({ ok, text: m });
  console.log(`${ok ? '✓' : '✗'} ${m}`);
  if (!ok) errors.push({ kind: 'assert', text: m });
};

const bgmState = (page) =>
  page.evaluate(() => ({
    mood: document.documentElement.dataset.bgm ?? null,
    ducked: document.documentElement.dataset.bgmDucked ?? null,
  }));

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  await ctx.addInitScript(() => {
    window.__osc = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const orig = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function patched(...args) {
      window.__osc += 1;
      return orig.apply(this, args);
    };
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

  const res = await page.goto(`${BASE}/`, { waitUntil: 'load' });
  check(res?.status() === 200, `라이브 첫 화면 HTTP ${res?.status()}`);
  await page.getByText('라피네').first().waitFor();
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10000 });
  await page.getByText('안녕, 김서연!').waitFor();

  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  check((await bgmState(page)).mood === null, '목록 화면 BGM 없음');

  await page.getByTestId('eng-pick-match').click();
  await page.getByTestId('game-board').waitFor();
  await page.waitForTimeout(800);
  check((await bgmState(page)).mood === 'arcade', `짝맞추기 진입 → arcade (${(await bgmState(page)).mood})`);
  const a1 = await page.evaluate(() => window.__osc);
  await page.waitForTimeout(1500);
  const a2 = await page.evaluate(() => window.__osc);
  check(a2 - a1 >= 5, `BGM 음이 실제로 예약됨 (+${a2 - a1})`);

  await page.getByTestId('game-mute').click();
  await page.waitForTimeout(400);
  check((await bgmState(page)).mood === null, '🔇 → BGM 정지');
  await page.getByTestId('game-mute').click();
  await page.waitForTimeout(500);
  check((await bgmState(page)).mood === 'arcade', '🔊 → BGM 재개');

  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await page.waitForTimeout(400);
  check((await bgmState(page)).mood === null, '← 목록으로 → BGM 정지');

  await page.getByTestId('eng-pick-listen').click();
  await page.getByTestId('eng-listen-play').waitFor();
  await page.waitForTimeout(600);
  const listen = await bgmState(page);
  check(listen.mood === 'arcade', `리스닝 진입 → arcade (${listen.mood})`);
  check(listen.ducked === '1', `발음 중 BGM duck (ducked=${listen.ducked})`);
  await page.waitForTimeout(2200);
  check((await bgmState(page)).ducked === '0', '발음 끝나면 원래 볼륨');

  await page.getByTestId('subject-coding').click();
  await page.getByTestId('coding-game-menu').waitFor();
  await page.getByTestId('coding-pick-hacker').click();
  await page.getByTestId('cod-hacker-lock-0').waitFor();
  await page.waitForTimeout(800);
  check((await bgmState(page)).mood === 'cyber', `해커 침투 → cyber (${(await bgmState(page)).mood})`);
} catch (e) {
  errors.push({ kind: 'exception', text: e?.stack || String(e) });
  console.log('✗ 예외:', e?.message || e);
} finally {
  await browser.close();
}

console.log(`\n=== 라이브 BGM 확인: ${errors.length ? `오류 ${errors.length}건` : '오류 0건'} · 검사 ${checks.length}개 ===`);
for (const e of errors.slice(0, 10)) console.log(` - [${e.kind}] ${String(e.text).slice(0, 200)}`);
process.exit(errors.length ? 1 : 0);
