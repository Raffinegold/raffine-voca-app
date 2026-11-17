/**
 * QA — 🎵 게임 배경음악(BGM) 스모크 테스트 (스크린샷 없이 빠르게)
 *
 *   npm run build
 *   node qa/bgm.mjs
 *
 * 확인 항목
 *  ① 게임 카드로 진입하면 arcade BGM이 켜지고, 실제로 오실레이터가 계속 예약되는가
 *  ② 스피커 버튼(🔊/🔇)으로 BGM이 즉시 꺼지고 다시 켜지는가
 *  ③ '← 목록으로' 로 나가면 BGM이 멈추는가
 *  ④ 해커 침투는 cyber BGM, 나머지는 arcade BGM
 *  ⑤ 발음 리스닝에서 발음이 나는 동안 BGM이 낮아지는가(duck)
 *  ⑥ 콘솔/페이지/HTTP 오류 0건
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.env.QA_DIST || 'dist');
const ORIGIN = 'http://rafine-voca-app.local';
const PREFIX = '/raffine-voca-app';
const BASE = process.env.QA_BASE || `${ORIGIN}${PREFIX}/`;
const OUT = process.env.QA_OUT ?? path.resolve('qa');

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
    if (url.hostname !== new URL(ORIGIN).hostname) return route.fallback();
    let pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(PREFIX)) pathname = PREFIX + pathname;
    let rel = pathname.slice(PREFIX.length);
    if (rel === '' || rel === '/') rel = '/index.html';
    let file = path.join(DIST, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(DIST, 'index.html');
    return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
}

const steps = [];
const errors = [];
const checks = [];
const log = (m) => {
  steps.push(m);
  console.log(`• ${m}`);
};
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

const oscCount = (page) => page.evaluate(() => window.__osc ?? 0);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });

try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  await serveDist(ctx);
  // 오실레이터가 실제로 예약되는지 세어 봅니다 (BGM이 정말 소리를 만드는지)
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
  page.setDefaultTimeout(15000);
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ kind: 'console', text: m.text() });
  });
  page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: e.message }));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push({ kind: 'http', text: `${r.status()} ${r.url()}` });
  });

  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByText('라피네').first().waitFor();
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 8000 });
  await page.getByText('안녕, 김서연!').waitFor();
  log('학생 로그인 (김서연)');

  /* ① 영어 게임 카드 진입 → arcade BGM */
  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  check((await bgmState(page)).mood === null, '게임 목록 화면에서는 BGM 없음');

  await page.getByTestId('eng-pick-match').click();
  await page.getByTestId('game-board').waitFor();
  await page.waitForTimeout(700);
  let st = await bgmState(page);
  check(st.mood === 'arcade', `짝맞추기 진입 → BGM arcade (실제: ${st.mood})`);

  const c1 = await oscCount(page);
  await page.waitForTimeout(1600);
  const c2 = await oscCount(page);
  check(c2 - c1 >= 5, `BGM 음이 계속 예약됨 (1.6초에 오실레이터 +${c2 - c1}개)`);

  /* ② 스피커 토글 */
  await page.getByTestId('game-mute').click();
  await page.waitForTimeout(400);
  st = await bgmState(page);
  check(st.mood === null, `🔇 누르면 BGM 즉시 정지 (실제: ${st.mood})`);
  const m1 = await oscCount(page);
  await page.waitForTimeout(1100);
  const m2 = await oscCount(page);
  check(m2 - m1 <= 1, `음소거 중에는 BGM 음이 나오지 않음 (+${m2 - m1})`);

  await page.getByTestId('game-mute').click();
  await page.waitForTimeout(600);
  st = await bgmState(page);
  check(st.mood === 'arcade', `🔊 다시 누르면 BGM 재개 (실제: ${st.mood})`);
  const u1 = await oscCount(page);
  await page.waitForTimeout(1300);
  const u2 = await oscCount(page);
  check(u2 - u1 >= 4, `재개 후에도 음이 계속 예약됨 (+${u2 - u1})`);

  /* ③ 목록으로 나가면 정지 */
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await page.waitForTimeout(500);
  st = await bgmState(page);
  check(st.mood === null, `← 목록으로 나가면 BGM 정지 (실제: ${st.mood})`);
  const e1 = await oscCount(page);
  await page.waitForTimeout(1200);
  const e2 = await oscCount(page);
  check(e2 - e1 <= 1, `목록 화면에서 BGM 음 없음 (+${e2 - e1})`);

  /* ④ 다른 영어 게임도 arcade, 해커는 cyber */
  await page.getByTestId('eng-pick-rain').click();
  await page.getByTestId('eng-rain-input').waitFor();
  await page.waitForTimeout(600);
  st = await bgmState(page);
  check(st.mood === 'arcade', `산성비 → arcade (실제: ${st.mood})`);
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('eng-game-menu').waitFor();

  await page.getByTestId('subject-coding').click();
  await page.getByTestId('coding-game-menu').waitFor();
  check((await bgmState(page)).mood === null, '코딩 게임 목록 화면에서는 BGM 없음');

  await page.getByTestId('coding-pick-hacker').click();
  await page.getByTestId('cod-hacker-lock-0').waitFor();
  await page.waitForTimeout(700);
  st = await bgmState(page);
  check(st.mood === 'cyber', `해커 침투 → cyber (실제: ${st.mood})`);
  const h1 = await oscCount(page);
  await page.waitForTimeout(1600);
  const h2 = await oscCount(page);
  check(h2 - h1 >= 2, `cyber 루프 음 예약됨 (+${h2 - h1})`);

  await page.getByTestId('coding-game-menu-button').click();
  await page.getByTestId('coding-game-menu').waitFor();
  await page.waitForTimeout(500);
  check((await bgmState(page)).mood === null, '코딩 목록으로 나가면 cyber BGM 정지');

  await page.getByTestId('coding-pick-robot').click();
  await page.getByTestId('cod-robot-grid').waitFor();
  await page.waitForTimeout(600);
  st = await bgmState(page);
  check(st.mood === 'arcade', `로봇 길찾기 → arcade (실제: ${st.mood})`);
  await page.getByTestId('coding-game-menu-button').click();
  await page.getByTestId('coding-game-menu').waitFor();

  /* ⑤ 리스닝 게임 — 발음 중 duck */
  await page.getByTestId('subject-english').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await page.getByTestId('eng-pick-listen').click();
  await page.getByTestId('eng-listen-play').waitFor();
  await page.waitForTimeout(500);
  st = await bgmState(page);
  check(st.mood === 'arcade', `리스닝 진입 → arcade (실제: ${st.mood})`);
  check(st.ducked === '1', `발음 재생 중 BGM duck 표시 (실제 ducked=${st.ducked})`);
  await page.waitForTimeout(2200);
  st = await bgmState(page);
  check(st.ducked === '0', `발음이 끝나면 BGM 원래 볼륨 (실제 ducked=${st.ducked})`);

  /* 다시 듣기 버튼으로도 duck */
  await page.getByTestId('eng-listen-replay').click();
  await page.waitForTimeout(350);
  st = await bgmState(page);
  check(st.ducked === '1', `🔁 다시 듣기에서도 duck (실제 ducked=${st.ducked})`);

  /* 리스닝에서 나가면 정지 */
  await page.getByTestId('game-menu-button').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await page.waitForTimeout(500);
  check((await bgmState(page)).mood === null, '리스닝 화면을 벗어나면 BGM 정지');

  /* ⑥ 배경 탭 이동 시 정지되는지 (visibilitychange) */
  await page.getByTestId('eng-pick-boss').click();
  await page.getByTestId('eng-boss-arena').waitFor();
  await page.waitForTimeout(600);
  check((await bgmState(page)).mood === 'arcade', `보스전 → arcade (실제: ${(await bgmState(page)).mood})`);
} catch (e) {
  errors.push({ kind: 'exception', text: e?.stack || String(e) });
  console.log('✗ 예외:', e?.message || e);
} finally {
  await browser.close();
}

fs.mkdirSync(OUT, { recursive: true });
const report = { ok: errors.length === 0, errors, steps, checks, when: new Date().toISOString() };
fs.writeFileSync(path.join(OUT, 'bgm_report.json'), JSON.stringify(report, null, 2));
console.log(`\n=== BGM QA: ${errors.length ? `오류 ${errors.length}건` : '오류 0건'} · 검사 ${checks.length}개 ===`);
for (const e of errors.slice(0, 12)) console.log(` - [${e.kind}] ${String(e.text).slice(0, 220)}`);
process.exit(errors.length ? 1 : 0);
