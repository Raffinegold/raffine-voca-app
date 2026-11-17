/**
 * QA — 🎮 게임 풀세트 (영어 5종 + 코딩 5종) 실제 진입·조작·클리어·캐시 적립 검증
 *
 *   npm run build
 *   node qa/games10.mjs
 *
 * dist/ 를 Playwright 요청 인터셉트로 GitHub Pages 하위 경로와 같은 조건으로 서빙합니다.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.env.QA_DIST || 'dist');
const ORIGIN = 'http://rafine-voca-app.local';
const PREFIX = '/raffine-voca-app';
const BASE = process.env.QA_BASE || 'http://rafine-voca-app.local/raffine-voca-app/';
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
const shots = [];
const results = [];
const log = (m) => {
  steps.push(m);
  console.log(`• ${m}`);
};
const fail = (m) => {
  errors.push({ kind: 'assert', text: m });
  console.log(`✗ ${m}`);
};

function attach(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ tag, kind: 'console', text: m.text() });
  });
  page.on('pageerror', (e) => errors.push({ tag, kind: 'pageerror', text: e.message }));
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push({ tag, kind: 'http', text: `${r.status()} ${r.url()}` });
  });
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  shots.push(file);
  log(`스크린샷 ${name}`);
}

async function loginStudent(page, studentId, pin) {
  await page.getByTestId(`student-${studentId}`).click();
  await page.getByRole('dialog').waitFor();
  for (const d of pin) await page.getByTestId(`pin-${d}`).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 8000 });
}

/** 지갑을 초기화해 각 게임의 적립을 따로 확인 */
async function resetWallet(page, studentId = 'stu-seoyeon') {
  await page.evaluate((id) => {
    const raw = JSON.parse(localStorage.getItem('rafine-voca-db-v1'));
    const today = new Date().toLocaleDateString('sv-SE');
    const w = raw.wallets.find((x) => x.student_id === id);
    if (w) {
      w.daily_cash_earned = 0;
      w.earned_date = today;
    }
    localStorage.setItem('rafine-voca-db-v1', JSON.stringify(raw));
  }, studentId);
}

async function goGame(page, subject, key) {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (subject === 'coding') {
    await page.getByTestId('subject-coding').click().catch(() => {});
    await page.getByTestId('coding-daily-earned').waitFor();
    const url = new URL(page.url());
    await page.goto(`${BASE.replace(/\/$/, '')}/game?g=${key}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
  } else {
    await page.getByTestId('subject-english').click().catch(() => {});
    await page.getByTestId('game-daily-earned').waitFor();
    await page.goto(`${BASE.replace(/\/$/, '')}/game?g=${key}`, { waitUntil: 'load' });
    await page.waitForTimeout(500);
  }
}

async function summaryText(page) {
  const el = page.getByTestId(/game-summary/).first();
  return (await el.innerText()).replace(/\n/g, ' ');
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

  /* ---------------------------- 1. 영어 게임 메뉴 ---------------------------- */
  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  const engCards = await page.locator('[data-testid^="eng-pick-"]').count();
  if (engCards !== 5) fail(`영어 게임 카드가 5개가 아니에요 (${engCards})`);
  log(`영어 게임 메뉴 카드 ${engCards}개`);
  await shot(page, 'qa_games_eng_menu.png');

  /* ------------------------------ 2. 영어 ① 짝맞추기 ------------------------------ */
  await resetWallet(page);
  await goGame(page, 'english', 'match');
  await page.getByTestId('game-board').waitFor();
  for (let guard = 0; guard < 30; guard += 1) {
    if (await page.getByTestId('game-summary').count()) break;
    const cards = page.locator('[data-testid^="game-card-"]');
    const n = await cards.count();
    let acted = false;
    for (let i = 0; i < n && !acted; i += 1) {
      const a = cards.nth(i);
      if (await a.isDisabled().catch(() => true)) continue;
      const pair = await a.getAttribute('data-pair');
      const face = await a.getAttribute('data-face');
      for (let j = i + 1; j < n; j += 1) {
        const b = cards.nth(j);
        if (await b.isDisabled().catch(() => true)) continue;
        if ((await b.getAttribute('data-pair')) === pair && (await b.getAttribute('data-face')) !== face) {
          await a.click();
          await b.click();
          acted = true;
          break;
        }
      }
    }
    await page.waitForTimeout(450);
  }
  await page.getByTestId('game-summary').waitFor();
  results.push({ game: 'eng-match', summary: await summaryText(page) });
  log(`① 짝맞추기 클리어 · ${await summaryText(page)}`);
  await shot(page, 'qa_games_eng_match.png');

  /* ------------------------------ 3. 영어 ② 산성비 ------------------------------ */
  await resetWallet(page);
  await goGame(page, 'english', 'rain');
  await page.getByTestId('eng-rain-input').waitFor();
  await page.getByTestId('eng-rain-canvas').waitFor();
  await page.waitForTimeout(4200);
  await shot(page, 'qa_top_eng_rain.png');
  let rainShot = true;
  for (let guard = 0; guard < 40; guard += 1) {
    if (await page.getByTestId('game-summary').count()) break;
    const words = (await page.getByTestId('eng-rain-words').getAttribute('data-words')) || '';
    const list = words.split(' ').filter(Boolean);
    if (!list.length) {
      await page.waitForTimeout(500);
      continue;
    }
    if (!rainShot) rainShot = true;
    await page.getByTestId('eng-rain-input').fill(list[0]);
    await page.waitForTimeout(420);
  }
  await page.getByTestId('game-summary').waitFor({ timeout: 20000 });
  const rainKills = await page.getByTestId('eng-rain-kills').innerText().catch(() => '');
  results.push({ game: 'eng-rain', summary: await summaryText(page), hud: rainKills });
  log(`② 영단어 산성비 클리어 · ${await summaryText(page)}`);
  await shot(page, 'qa_games_eng_rain_end.png');

  /* ------------------------------ 4. 영어 ③ 보스전 ------------------------------ */
  await resetWallet(page);
  await goGame(page, 'english', 'boss');
  await page.getByTestId('eng-boss-arena').waitFor();
  let bossShot = false;
  for (let guard = 0; guard < 10; guard += 1) {
    if (await page.getByTestId('game-summary').count()) break;
    const opts = page.locator('[data-testid^="eng-boss-option-"]');
    const idx = await opts.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (idx < 0) {
      await page.waitForTimeout(300);
      continue;
    }
    const disabled = await opts.nth(idx).isDisabled().catch(() => true);
    if (disabled) {
      await page.waitForTimeout(250);
      continue;
    }
    await opts.nth(idx).click();
    if (!bossShot) {
      await page.waitForTimeout(260);
      await shot(page, 'qa_top_eng_boss.png');
      bossShot = true;
    }
    await page.waitForTimeout(1250);
  }
  await page.getByTestId('game-summary').waitFor({ timeout: 20000 });
  results.push({ game: 'eng-boss', summary: await summaryText(page) });
  log(`③ 몬스터 보스전 클리어 · ${await summaryText(page)}`);
  await shot(page, 'qa_games_eng_boss_end.png');

  /* ------------------------------ 5. 영어 ④ 리스닝 ------------------------------ */
  await resetWallet(page);
  await goGame(page, 'english', 'listen');
  await page.getByTestId('eng-listen-play').waitFor();
  for (let guard = 0; guard < 10; guard += 1) {
    if (await page.getByTestId('game-summary').count()) break;
    const opts = page.locator('[data-testid^="eng-listen-option-"]');
    const idx = await opts.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (idx >= 0 && !(await opts.nth(idx).isDisabled().catch(() => true))) {
      await opts.nth(idx).click();
      if (guard === 0) await shot(page, 'qa_games_eng_listen.png');
    }
    await page.waitForTimeout(1350);
  }
  await page.getByTestId('game-summary').waitFor({ timeout: 25000 });
  results.push({ game: 'eng-listen', summary: await summaryText(page) });
  log(`④ 발음 리스닝 클리어 · ${await summaryText(page)}`);

  /* ------------------------------ 6. 영어 ⑤ 빈칸 ------------------------------ */
  await resetWallet(page);
  await goGame(page, 'english', 'blank');
  await page.getByTestId('eng-blank-slot').waitFor();
  for (let guard = 0; guard < 10; guard += 1) {
    if (await page.getByTestId('game-summary').count()) break;
    const opts = page.locator('[data-testid^="eng-blank-option-"]');
    const idx = await opts.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (idx >= 0 && !(await opts.nth(idx).isDisabled().catch(() => true))) {
      await opts.nth(idx).click();
      if (guard === 0) await shot(page, 'qa_games_eng_blank.png');
    }
    await page.waitForTimeout(1750);
  }
  await page.getByTestId('game-summary').waitFor({ timeout: 25000 });
  results.push({ game: 'eng-blank', summary: await summaryText(page) });
  log(`⑤ 예문 빈칸 클리어 · ${await summaryText(page)}`);

  /* ------------------------------ 7. 코딩 게임 메뉴 ------------------------------ */
  await goGame(page, 'coding', 'robot');
  await page.getByTestId('cod-robot-grid').waitFor();
  await page.goto(`${BASE.replace(/\/$/, '')}/game`, { waitUntil: 'load' });
  await page.getByTestId('coding-game-menu').waitFor();
  const codCards = await page.locator('[data-testid^="coding-pick-"]').count();
  if (codCards !== 5) fail(`코딩 게임 카드가 5개가 아니에요 (${codCards})`);
  log(`코딩 게임 메뉴 카드 ${codCards}개`);
  await shot(page, 'qa_games_coding_menu.png');

  /* ------------------------------ 8. 코딩 ① 로봇 ------------------------------ */
  await resetWallet(page);
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=robot`, { waitUntil: 'load' });
  await page.getByTestId('cod-robot-grid').waitFor();
  let robotShot = false;
  for (let stage = 0; stage < 5; stage += 1) {
    if (await page.getByTestId('coding-game-summary').count()) break;
    const grid = page.getByTestId('cod-robot-grid');
    const solution = (await grid.getAttribute('data-solution')) || '';
    const cmds = solution.split(',').filter(Boolean);
    const stageName = await page.getByTestId('cod-robot-stage').innerText();
    for (const cmd of cmds) await page.getByTestId(`cod-robot-cmd-${cmd}`).click();
    await page.getByTestId('cod-robot-run').click();
    if (stage === 2 && !robotShot) {
      await page.waitForTimeout(950);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(260);
      await shot(page, 'qa_top_cod_robot.png');
      robotShot = true;
    }
    await page.waitForTimeout(900 + cmds.length * 380);
    if (await page.getByTestId('cod-robot-message').count()) {
      const msg = await page.getByTestId('cod-robot-message').innerText();
      log(`  ${stageName} → ${msg}`);
      if (msg.includes('벽에')) fail(`로봇이 ${stageName}에서 벽에 부딪혔어요`);
    }
    await page.waitForTimeout(1500);
  }
  await page.getByTestId('coding-game-summary').waitFor({ timeout: 25000 });
  results.push({ game: 'cod-robot', summary: await summaryText(page) });
  log(`① 로봇 길찾기 클리어 · ${await summaryText(page)}`);
  await shot(page, 'qa_games_cod_robot_end.png');

  /* ------------------------------ 9. 코딩 ② 키워드 디펜스 ------------------------------ */
  await resetWallet(page);
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=rain`, { waitUntil: 'load' });
  await page.getByTestId('cod-rain-input').waitFor();
  await page.waitForTimeout(4200);
  await shot(page, 'qa_games_cod_rain.png');
  let codRainShot = true;
  for (let guard = 0; guard < 40; guard += 1) {
    if (await page.getByTestId('coding-game-summary').count()) break;
    const words = (await page.getByTestId('cod-rain-words').getAttribute('data-words')) || '';
    const list = words.split(' ').filter(Boolean);
    if (!list.length) {
      await page.waitForTimeout(500);
      continue;
    }
    if (!codRainShot) codRainShot = true;
    await page.getByTestId('cod-rain-input').fill(list[0]);
    await page.waitForTimeout(420);
  }
  await page.getByTestId('coding-game-summary').waitFor({ timeout: 20000 });
  results.push({ game: 'cod-rain', summary: await summaryText(page) });
  log(`② 키워드 디펜스 클리어 · ${await summaryText(page)}`);

  /* ------------------------------ 10. 코딩 ③ 디버깅 보스 ------------------------------ */
  await resetWallet(page);
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=debug`, { waitUntil: 'load' });
  await page.getByTestId('cod-debug-arena').waitFor();
  for (let guard = 0; guard < 10; guard += 1) {
    if (await page.getByTestId('coding-game-summary').count()) break;
    const lines = page.locator('[data-testid^="cod-debug-line-"]');
    const idx = await lines.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (idx >= 0 && !(await lines.nth(idx).isDisabled().catch(() => true))) {
      await lines.nth(idx).click();
      if (guard === 0) await shot(page, 'qa_games_cod_debug.png');
    }
    await page.waitForTimeout(1350);
  }
  await page.getByTestId('coding-game-summary').waitFor({ timeout: 25000 });
  results.push({ game: 'cod-debug', summary: await summaryText(page) });
  log(`③ 디버깅 보스전 클리어 · ${await summaryText(page)}`);

  /* ------------------------------ 11. 코딩 ④ 유니티 좌표 ------------------------------ */
  await resetWallet(page);
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=unity`, { waitUntil: 'load' });
  await page.getByTestId('cod-unity-grid').waitFor();
  for (let guard = 0; guard < 10; guard += 1) {
    if (await page.getByTestId('coding-game-summary').count()) break;
    const opts = page.locator('[data-testid^="cod-unity-option-"]');
    const idx = await opts.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (idx >= 0 && !(await opts.nth(idx).isDisabled().catch(() => true))) {
      await opts.nth(idx).click();
      if (guard === 0) await shot(page, 'qa_games_cod_unity.png');
    }
    await page.waitForTimeout(1900);
  }
  await page.getByTestId('coding-game-summary').waitFor({ timeout: 25000 });
  results.push({ game: 'cod-unity', summary: await summaryText(page) });
  log(`④ 유니티 좌표 퀴즈 클리어 · ${await summaryText(page)}`);

  /* ------------------------------ 12. 코딩 ⑤ 해커 ------------------------------ */
  await resetWallet(page);
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=hacker`, { waitUntil: 'load' });
  await page.getByTestId('cod-hacker-lock-0').waitFor();
  let hackerShot = false;
  for (let guard = 0; guard < 8; guard += 1) {
    if (await page.getByTestId('coding-game-summary').count()) break;
    const opts = page.locator('[data-testid^="cod-hacker-option-"]');
    const idx = await opts.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (idx >= 0 && !(await opts.nth(idx).isDisabled().catch(() => true))) {
      await opts.nth(idx).click();
      await page.waitForTimeout(400);
      if (!hackerShot) {
        await shot(page, 'qa_top_cod_hacker.png');
        hackerShot = true;
      }
    }
    await page.waitForTimeout(1100);
  }
  await page.getByTestId('coding-game-summary').waitFor({ timeout: 25000 });
  const granted = await page.getByTestId('cod-hacker-granted').count();
  results.push({ game: 'cod-hacker', summary: await summaryText(page), granted });
  log(`⑤ 해커 침투 클리어 (ACCESS GRANTED ${granted ? '표시' : '미표시'}) · ${await summaryText(page)}`);
  await shot(page, 'qa_games_cod_hacker_end.png');

  /* ------------------------------ 13. 공용 지갑 · 상한 ------------------------------ */
  const daily = await page.getByTestId('coding-daily-earned').innerText();
  log(`코딩 화면 오늘 적립(영어와 공용): ${daily.replace(/\n/g, ' ')}`);
  await page.getByTestId('subject-english').click();
  await page.getByTestId('game-daily-earned').waitFor();
  const dailyEng = await page.getByTestId('game-daily-earned').innerText();
  log(`영어 화면 오늘 적립: ${dailyEng.replace(/\n/g, ' ')}`);

  /* 상한 연동: 47원 상태에서 한 판 → 3원까지만 적립 */
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('rafine-voca-db-v1'));
    const today = new Date().toLocaleDateString('sv-SE');
    const w = raw.wallets.find((x) => x.student_id === 'stu-seoyeon');
    w.daily_cash_earned = 47;
    w.earned_date = today;
    localStorage.setItem('rafine-voca-db-v1', JSON.stringify(raw));
  });
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=blank`, { waitUntil: 'load' });
  await page.getByTestId('eng-blank-slot').waitFor();
  for (let guard = 0; guard < 10; guard += 1) {
    if (await page.getByTestId('game-summary').count()) break;
    const opts = page.locator('[data-testid^="eng-blank-option-"]');
    const idx = await opts.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (idx >= 0 && !(await opts.nth(idx).isDisabled().catch(() => true))) await opts.nth(idx).click();
    await page.waitForTimeout(1750);
  }
  await page.getByTestId('game-summary').waitFor();
  const capBody = await page.getByTestId('game-summary').innerText();
  log(`상한 연동 확인: ${capBody.includes('상한') ? '상한 안내 표시' : '상한 안내 없음'} · ${(await summaryText(page)).slice(0, 60)}`);

  /* ------------------------------ 14. 관리자 화면 회귀 ------------------------------ */
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    serviceWorkers: 'block',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  await serveDist(desktop);
  const admin = await desktop.newPage();
  admin.setDefaultTimeout(15000);
  attach(admin, 'admin');
  await admin.goto(BASE, { waitUntil: 'load' });
  await admin.getByRole('button', { name: '원장님', exact: true }).click();
  for (const d of '9999') await admin.getByTestId(`pin-${d}`).click();
  await admin.getByText('이번 주 학원 현황').waitFor();
  await admin.getByTestId('tab-coding').click();
  await admin.getByText('코딩 학습 현황').waitFor();
  await admin.waitForTimeout(500);
  const adminCash = await admin.getByTestId('admin-cash-table').count().catch(() => 0);
  log(`관리자 로그인·코딩 탭 정상 (캐시 표 ${adminCash})`);
  await shot(admin, 'qa_games_admin_coding.png');
} catch (e) {
  errors.push({ kind: 'exception', text: e?.stack || String(e) });
  console.log('✗ 예외:', e?.message || e);
} finally {
  await browser.close();
}

const report = {
  ok: errors.length === 0,
  errors,
  steps,
  results,
  shots,
  when: new Date().toISOString(),
};
fs.writeFileSync(path.join(OUT, 'qa_games10_report.json'), JSON.stringify(report, null, 2));
console.log(`\n=== 결과: ${errors.length ? `오류 ${errors.length}건` : '오류 0건'} ===`);
for (const e of errors.slice(0, 12)) console.log(` - [${e.kind}] ${e.tag ?? ''} ${String(e.text).slice(0, 220)}`);
process.exit(errors.length ? 1 : 0);
