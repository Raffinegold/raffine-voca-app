/**
 * QA — 🌠 산성비 2종 속도 선택(느림/보통/빠름) + 단계(WAVE) 가속 검증
 *
 *   npm run build
 *   node qa/rain-speed-wave.mjs
 *
 * dist/ 를 Playwright 요청 인터셉트로 GitHub Pages 하위 경로와 같은 조건으로 서빙합니다.
 * - 영어 단어 산성비 / 코딩 키워드 디펜스 각각
 *   ① 속도 버튼 3개 · 기본 '보통' · 선택 반영(data-speed)
 *   ② 느림 vs 빠름 실제 낙하 시간 차이 (매 측정마다 새 판에서 첫 운석만 추적)
 *   ③ WAVE 1 → 2 → 3 배지 상승 · 격추 클리어 (새 판 · 하트 5개)
 *   ④ 콘솔 오류 0건
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.env.QA_DIST || 'dist');
const ORIGIN = 'http://rafine-voca-app.local';
const PREFIX = '/raffine-voca-app';
const BASE = process.env.QA_BASE || 'http://rafine-voca-app.local/raffine-voca-app/';
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
const QADIR = path.resolve('qa');
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
    if (url.hostname !== new URL(ORIGIN).hostname) return route.fallback();
    let pathname = decodeURIComponent(url.pathname);
    if (!pathname.startsWith(PREFIX)) pathname = PREFIX + pathname;
    let rel = pathname.slice(PREFIX.length);
    if (rel === '' || rel === '/') rel = '/index.html';
    let file = path.join(DIST, rel);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(DIST, 'index.html');
    return route.fulfill({
      status: 200,
      contentType: MIME[path.extname(file)] || 'application/octet-stream',
      body: fs.readFileSync(file),
    });
  });
}

const steps = [];
const errors = [];
const results = [];
const log = (m) => {
  steps.push(m);
  console.log(`• ${m}`);
};
const fail = (m) => {
  errors.push({ kind: 'assert', text: m });
  console.log(`✗ ${m}`);
};
const check = (cond, okMsg, badMsg) => (cond ? log(okMsg) : fail(badMsg));

function attach(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ tag, kind: 'console', text: m.text() });
  });
  page.on('pageerror', (e) => errors.push({ tag, kind: 'pageerror', text: e.message }));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push({ tag, kind: 'http', text: `${r.status()} ${r.url()}` });
  });
}

async function loginStudent(page, studentId, pin) {
  await page.getByTestId(`student-${studentId}`).click();
  await page.getByRole('dialog').waitFor();
  for (const d of pin) await page.getByTestId(`pin-${d}`).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 8000 });
}

async function resetWallet(page) {
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('rafine-voca-db-v1'));
    const today = new Date().toLocaleDateString('sv-SE');
    const w = raw.wallets.find((x) => x.student_id === 'stu-seoyeon');
    if (w) {
      w.daily_cash_earned = 0;
      w.earned_date = today;
    }
    localStorage.setItem('rafine-voca-db-v1', JSON.stringify(raw));
  });
}

/** 새 판으로 다시 열기 (하트 5개 · 운석 0개 상태에서 측정하기 위함) */
async function reloadGame(page, prefix) {
  await page.reload({ waitUntil: 'load' });
  await page.getByTestId(`${prefix}-canvas`).waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
}

/**
 * 방금 새로 나타난 운석 하나가 방어선까지 떨어지는 시간(ms).
 * 측정 시작 시점에 이미 떠 있던 단어는 제외합니다.
 */
async function measureFall(page, prefix) {
  return page.evaluate(async (p) => {
    const el = document.querySelector(`[data-testid="${p}-words"]`);
    if (!el) return { error: 'no words node' };
    const read = () => (el.getAttribute('data-words') || '').trim().split(/\s+/).filter(Boolean);
    const before = new Set(read());
    let target = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 12000) {
      const fresh = read().find((w) => !before.has(w));
      if (fresh) {
        target = fresh;
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    if (!target) return { error: 'no new word appeared' };
    const t1 = performance.now();
    while (performance.now() - t1 < 26000) {
      if (!read().includes(target)) return { word: target, fallMs: Math.round(performance.now() - t1) };
      await new Promise((r) => setTimeout(r, 60));
    }
    return { error: 'timeout', word: target };
  }, prefix);
}

/** 속도 버튼 확인 + 라벨 확인 */
async function checkSpeedUI(page, prefix, tagLabel) {
  const buttons = page.locator(`[data-testid^="${prefix}-speed-"]`);
  const count = await buttons.count();
  check(count === 3, `${tagLabel} 속도 버튼 3개 확인`, `${tagLabel} 속도 버튼이 3개가 아니에요 (${count})`);
  const labels = await buttons.allInnerTexts();
  const flat = labels.map((t) => t.replace(/\s+/g, ''));
  check(
    flat.some((t) => t.includes('느림')) && flat.some((t) => t.includes('보통')) && flat.some((t) => t.includes('빠름')),
    `${tagLabel} 속도 라벨 확인: ${labels.map((t) => t.trim()).join(' / ')}`,
    `${tagLabel} 속도 버튼 라벨이 이상해요 (${labels.join(' / ')})`
  );
  const active = await page
    .locator(`[data-testid^="${prefix}-speed-"][data-active="1"]`)
    .getAttribute('data-testid')
    .catch(() => '');
  check(String(active).endsWith('speed-normal'), `${tagLabel} 기본 속도 = 보통`, `${tagLabel} 기본 속도가 보통이 아니에요 (${active})`);
}

/** 속도 선택 → 새 판에서 낙하 시간 측정 */
async function measureAt(page, prefix, speedKey) {
  await reloadGame(page, prefix);
  await page.getByTestId(`${prefix}-speed-${speedKey}`).click();
  await page.waitForTimeout(200);
  const root = await page.getByTestId(`${prefix}-root`).getAttribute('data-speed');
  check(root === speedKey, `${prefix} 속도 선택 반영 (data-speed=${speedKey})`, `${prefix} ${speedKey} 선택이 반영되지 않았어요 (${root})`);
  return measureFall(page, prefix);
}

/**
 * 새 판에서 한 판을 끝까지 진행하며 관찰한 WAVE 값을 모읍니다.
 * 떠 있는 운석 중 가장 아래(=가장 먼저 나온) 단어부터 입력합니다.
 */
async function playAndClear(page, prefix, summaryTestId) {
  const seenWaves = new Set();
  const waveBadge = page.getByTestId(`${prefix}-wave`);
  if (await waveBadge.count()) {
    const visible = await waveBadge.isVisible();
    const txt = (await waveBadge.innerText()).replace(/\s+/g, ' ').trim();
    seenWaves.add(Number(await waveBadge.getAttribute('data-wave')));
    check(visible && /WAVE\s*1/.test(txt), `${prefix} WAVE 배지 표시: ${txt}`, `${prefix} WAVE 배지가 없거나 WAVE 1 이 아니에요 (${txt})`);
  } else {
    fail(`${prefix} WAVE 배지가 없어요`);
  }

  for (let guard = 0; guard < 160; guard += 1) {
    if (await page.getByTestId(summaryTestId).count()) break;
    const words = (await page.getByTestId(`${prefix}-words`).getAttribute('data-words')) || '';
    const list = words.split(' ').filter(Boolean);
    if (list.length) await page.getByTestId(`${prefix}-input`).fill(list[0]);
    await page.waitForTimeout(110);
    if (await waveBadge.count()) seenWaves.add(Number(await waveBadge.getAttribute('data-wave')));
  }
  await page.getByTestId(summaryTestId).waitFor({ timeout: 25000 });
  return [...seenWaves].sort();
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    serviceWorkers: 'block',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  await serveDist(mobile);
  const page = await mobile.newPage();
  page.setDefaultTimeout(15000);
  attach(page, 'student');

  await page.goto(BASE, { waitUntil: 'load' });
  await page.getByText('라피네').first().waitFor();
  await loginStudent(page, 'stu-seoyeon', '1111');
  await page.getByText('안녕, 김서연!').waitFor();
  log('학생 로그인 성공 (김서연 · 1111)');

  /* ============================ 1. 영어 단어 산성비 ============================ */
  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await resetWallet(page);
  await page.getByTestId('eng-pick-rain').click();
  await page.getByTestId('eng-rain-canvas').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  await checkSpeedUI(page, 'eng-rain', '영어 산성비');

  const slowFall = await measureAt(page, 'eng-rain', 'slow');
  log(`영어 느림 낙하 시간: ${slowFall.fallMs ?? slowFall.error}ms`);
  const fastFall = await measureAt(page, 'eng-rain', 'fast');
  log(`영어 빠름 낙하 시간: ${fastFall.fallMs ?? fastFall.error}ms`);
  if (slowFall.fallMs && fastFall.fallMs) {
    check(
      slowFall.fallMs > fastFall.fallMs * 1.35,
      `영어 낙하 속도 차이 확인 (느림 ${slowFall.fallMs}ms > 빠름 ${fastFall.fallMs}ms)`,
      `영어 느림/빠름 낙하 시간 차이가 부족해요 (느림 ${slowFall.fallMs}ms · 빠름 ${fastFall.fallMs}ms)`
    );
  } else {
    fail(`영어 낙하 시간 측정 실패 (느림 ${JSON.stringify(slowFall)} · 빠름 ${JSON.stringify(fastFall)})`);
  }

  /* 대표 스크린샷 — 새 판 · 보통 속도 · 운석이 떠 있는 순간 */
  await reloadGame(page, 'eng-rain');
  await page.getByTestId('eng-rain-speed-normal').click();
  await page.waitForTimeout(4200);
  await page.screenshot({ path: path.join(OUT, 'qa_rain_speed_wave.png') });
  log('스크린샷 qa_rain_speed_wave.png 저장');

  /* 클리어 — 새 판(하트 5개)에서 */
  await reloadGame(page, 'eng-rain');
  const engWaves = await playAndClear(page, 'eng-rain', 'game-summary');
  const engSummary = (await page.getByTestId('game-summary').innerText()).replace(/\n/g, ' ');
  results.push({ game: 'eng-rain', waves: engWaves, summary: engSummary, slowFall, fastFall });
  log(`영어 산성비 클리어 · 관찰된 WAVE ${engWaves.join(' → ')} · ${engSummary.replace(/\s+/g, ' ').slice(0, 90)}`);
  check(
    engWaves.includes(1) && engWaves.includes(2) && engWaves.includes(3),
    '영어 산성비 WAVE 1 → 2 → 3 상승 확인',
    `영어 산성비 WAVE 상승이 부족해요 (관찰: ${engWaves.join(', ')})`
  );

  /* ============================ 2. 코딩 키워드 디펜스 ============================ */
  await page.getByTestId('subject-coding').click().catch(() => {});
  await page.getByTestId('coding-daily-earned').waitFor();
  await resetWallet(page);
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=rain`, { waitUntil: 'load' });
  await page.getByTestId('cod-rain-canvas').waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);

  await checkSpeedUI(page, 'cod-rain', '코딩 키워드 디펜스');

  const codSlowFall = await measureAt(page, 'cod-rain', 'slow');
  log(`코딩 느림 낙하 시간: ${codSlowFall.fallMs ?? codSlowFall.error}ms`);
  const codFastFall = await measureAt(page, 'cod-rain', 'fast');
  log(`코딩 빠름 낙하 시간: ${codFastFall.fallMs ?? codFastFall.error}ms`);
  if (codSlowFall.fallMs && codFastFall.fallMs) {
    check(
      codSlowFall.fallMs > codFastFall.fallMs * 1.35,
      `코딩 낙하 속도 차이 확인 (느림 ${codSlowFall.fallMs}ms > 빠름 ${codFastFall.fallMs}ms)`,
      `코딩 느림/빠름 낙하 시간 차이가 부족해요 (느림 ${codSlowFall.fallMs}ms · 빠름 ${codFastFall.fallMs}ms)`
    );
  } else {
    fail(`코딩 낙하 시간 측정 실패 (느림 ${JSON.stringify(codSlowFall)} · 빠름 ${JSON.stringify(codFastFall)})`);
  }

  await reloadGame(page, 'cod-rain');
  await page.getByTestId('cod-rain-speed-normal').click();
  await page.waitForTimeout(4200);
  await page.screenshot({ path: path.join(QADIR, 'qa_cod_rain_wave.png') });
  log('진단용 스크린샷 qa/qa_cod_rain_wave.png 저장');

  await reloadGame(page, 'cod-rain');
  const codWaves = await playAndClear(page, 'cod-rain', 'coding-game-summary');
  const codSummary = (await page.getByTestId('coding-game-summary').innerText()).replace(/\n/g, ' ');
  results.push({ game: 'cod-rain', waves: codWaves, summary: codSummary, slowFall: codSlowFall, fastFall: codFastFall });
  log(`코딩 키워드 디펜스 클리어 · 관찰된 WAVE ${codWaves.join(' → ')} · ${codSummary.replace(/\s+/g, ' ').slice(0, 90)}`);
  check(
    codWaves.includes(1) && codWaves.includes(2) && codWaves.includes(3),
    '코딩 키워드 디펜스 WAVE 1 → 2 → 3 상승 확인',
    `코딩 WAVE 상승이 부족해요 (관찰: ${codWaves.join(', ')})`
  );
} catch (e) {
  errors.push({ kind: 'exception', text: e?.stack || String(e) });
  console.log('✗ 예외:', e?.message || e);
} finally {
  await browser.close();
}

const report = { ok: errors.length === 0, errors, steps, results, when: new Date().toISOString() };
fs.writeFileSync(path.join(QADIR, 'rain-speed-wave_report.json'), JSON.stringify(report, null, 2));
console.log(`\n=== 결과: ${errors.length ? `오류 ${errors.length}건` : '오류 0건'} ===`);
for (const e of errors.slice(0, 12)) console.log(` - [${e.kind}] ${e.tag ?? ''} ${String(e.text).slice(0, 220)}`);
process.exit(errors.length ? 1 : 0);
