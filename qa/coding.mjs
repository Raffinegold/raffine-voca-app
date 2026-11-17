/**
 * QA — 💻 코딩 모드 (과목 전환 · 코딩 미션 · 3가지 코딩 게임 · 공용 캐시 상한 · 관리자 권한/레벨)
 *
 * 실행:
 *   npm run build
 *   (로컬 서버 없이 dist/ 를 Playwright 요청 인터셉트로 서빙합니다)
 *   node qa/coding.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.env.QA_DIST || 'dist');
const ORIGIN = 'http://rafine-voca-app.local';
const PREFIX = '/raffine-voca-app';
const BASE = process.env.QA_BASE || 'http://rafine-voca-app.local/raffine-voca-app/';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** dist/ 를 서버 없이 그대로 서빙 (GitHub Pages 하위 경로와 같은 조건) */
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
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
fs.mkdirSync(OUT, { recursive: true });

const steps = [];
const errors = [];
const shots = [];
const started = Date.now();
const log = (m) => {
  steps.push(m);
  console.log(`• ${m}`);
};

function attach(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ tag, kind: 'console', text: m.text() });
  });
  page.on('pageerror', (e) => errors.push({ tag, kind: 'pageerror', text: e.message }));
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/r/')) errors.push({ tag, kind: 'http', text: `${r.status()} ${r.url()}` });
  });
}

async function shot(page, name, fullPage = false) {
  const file = path.join(OUT, name);
  if (fullPage) {
    await page.addStyleTag({ content: 'header{position:static !important}' });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
  }
  await page.screenshot({ path: file, fullPage });
  shots.push(file);
  log(`스크린샷 ${name}`);
}

async function loginStudent(page, studentId, pin) {
  await page.getByTestId(`student-${studentId}`).click();
  await page.getByRole('dialog').waitFor();
  for (const d of pin) await page.getByTestId(`pin-${d}`).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 8000 });
}

async function logout(page) {
  await page.getByRole('button', { name: '나가기' }).first().click();
  await page.getByText('라피네 영단어').first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
}

async function loginAdmin(page) {
  await page.getByRole('button', { name: '원장님', exact: true }).click();
  for (const d of '9999') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('이번 주 학원 현황').waitFor();
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  /* ------------------------------ 1. 학생 (모바일) ------------------------------ */
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

  const switchCount = await page.getByTestId('subject-switch').count();
  const codingBtn = await page.getByTestId('subject-coding').isVisible();
  log(`과목 전환 스위치 표시: ${switchCount === 1} · 💻 코딩 버튼 보임: ${codingBtn}`);
  await shot(page, 'qa_coding_switch_english.png');
  await page.getByTestId('subject-coding').click();
  await page.getByTestId('coding-home').waitFor();
  log('📚 영어 → 💻 코딩 전환 성공');

  const pledge = await page.getByTestId('coding-level-pill').innerText();
  log(`코딩 레벨 배지: ${pledge.replace(/\n/g, ' ')}`);
  const homeSwitch = await page.getByTestId('subject-switch').isVisible();
  log(`코딩 홈에서도 전환 스위치 유지: ${homeSwitch}`);
  await shot(page, 'qa_coding_home.png');

  /* ------------------------------ 2. 코딩 미션 ------------------------------ */
  await page.getByTestId('coding-start-mission').click();
  await page.getByTestId('coding-mission-progress').waitFor();
  const progressText = await page.getByTestId('coding-mission-progress').innerText();
  log(`오늘의 코딩 미션 시작 (${progressText.replace(/\n/g, ' ')})`);

  let answered = 0;
  let missionCorrect = 0;
  let missionShot = false;
  for (let guard = 0; guard < 12; guard += 1) {
    if (await page.getByTestId('coding-result').count()) break;
    const choices = page.locator('[data-testid^="coding-choice-"]');
    const n = await choices.count();
    if (!n) break;
    const correctIdx = await choices.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    // 첫 문제는 일부러 틀려서 해설·오답노트 저장 흐름을 확인
    const pick = answered === 0 ? (correctIdx === 0 ? 1 : 0) : correctIdx;
    await choices.nth(pick).click();
    await page.getByTestId('coding-feedback').waitFor();
    const feedback = await page.getByTestId('coding-feedback').innerText();
    const explanation = await page.getByTestId('coding-explanation').innerText();
    if (!missionShot) {
      log(`미션 피드백: ${feedback.split('\n')[0]} · 해설 길이 ${explanation.length}자`);
      await shot(page, 'qa_coding_mission.png');
      missionShot = true;
    }
    if (pick === correctIdx) missionCorrect += 1;
    answered += 1;
    await page.getByTestId('coding-next').click();
    await page.waitForTimeout(250);
  }

  await page.getByTestId('coding-result').waitFor();
  const resultScore = await page.getByTestId('coding-result-score').innerText();
  log(`코딩 미션 완료: 정답 ${resultScore} / ${answered} (의도한 오답 1개 포함)`);

  /* ------------------------------ 3. 코딩 오답노트 ------------------------------ */
  await page.getByTestId('coding-result-home').click();
  await page.getByTestId('nav-wrong').click();
  await page.getByText('코딩 오답노트').first().waitFor();
  const wrongItems = await page.getByTestId('coding-wrong-item').count();
  const wrongExplain = await page.getByTestId('coding-wrong-explain').first().innerText().catch(() => '');
  log(`코딩 오답노트 항목 ${wrongItems}개 · 해설 표시: ${wrongExplain.includes('해설')}`);
  await shot(page, 'qa_coding_wrongnote.png');

  /* ------------------------------ 4. 코딩 게임 메뉴 ------------------------------ */
  /* 게임 10종 상세 플레이 검증은 qa/games10.mjs 가 담당합니다. 여기서는 메뉴 진입과 5종 구성을 확인합니다. */
  await page.getByTestId('nav-game').click();
  await page.getByTestId('coding-game-menu').waitFor();
  const gameCards = await page.locator('[data-testid^="coding-pick-"]').count();
  log(`코딩 게임 메뉴 진입 · 5종 카드 ${gameCards}개`);
  await shot(page, 'qa_coding_game_menu.png');

  /* --------------------- 5. 공용 지갑 · 하루 50원 상한 연동 --------------------- */
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('rafine-voca-db-v1'));
    const today = new Date().toLocaleDateString('sv-SE');
    const w = raw.wallets.find((x) => x.student_id === 'stu-seoyeon');
    w.daily_cash_earned = 47;
    w.earned_date = today;
    localStorage.setItem('rafine-voca-db-v1', JSON.stringify(raw));
  });
  await page.goto(`${BASE.replace(/\/$/, '')}/game?g=debug`, { waitUntil: 'load' });
  await page.getByTestId('cod-debug-arena').waitFor();
  log('영어에서 47원 적립한 상태를 재현 (localStorage 지갑) → 남은 상한 3원');

  for (let q = 0; q < 8; q += 1) {
    if (await page.getByTestId('coding-game-summary').count()) break;
    const lines = page.locator('[data-testid^="cod-debug-line-"]');
    if (!(await lines.count())) break;
    const bugIdx = await lines.evaluateAll((els) => els.findIndex((el) => el.dataset.correct === '1'));
    if (bugIdx >= 0 && !(await lines.nth(bugIdx).isDisabled().catch(() => true))) await lines.nth(bugIdx).click();
    await page.waitForTimeout(1300);
  }
  await page.getByTestId('coding-game-summary').waitFor();
  const cappedReward = await page.getByTestId('coding-game-reward').innerText();
  const cappedBody = await page.getByTestId('coding-game-summary').innerText();
  const dailyAfter = await page.getByTestId('coding-daily-earned').innerText();
  log(
    `상한 연동 확인: 이번 판 적립 ${cappedReward} (50원 상한) · 오늘 ${dailyAfter.replace(/\n/g, ' ')} · 연습 모드/상한 안내 ${cappedBody.includes('상한') || cappedBody.includes('연습')}`
  );
  await shot(page, 'qa_coding_cap.png');

  // 영어 화면에서도 같은 지갑(오늘 적립)이 보이는지
  await page.getByTestId('subject-english').click();
  await page.waitForTimeout(400);
  await page.getByTestId('nav-game').click();
  await page.getByTestId('game-daily-earned').waitFor();
  const englishDaily = await page.getByTestId('game-daily-earned').innerText();
  log(`영어 게임 화면의 오늘 적립(공용 지갑): ${englishDaily}`);

  /* -------------------------- 6. 관리자 — 권한 · 코딩 레벨 -------------------------- */
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
  await loginAdmin(admin);
  log('관리자 로그인 성공 (PIN 9999)');
  await admin.getByTestId('tab-coding').click();
  await admin.getByText('코딩 학습 현황').waitFor();
  await admin.waitForTimeout(400);
  await shot(admin, 'qa_coding_admin.png', true);

  const studentCount = await admin.getByTestId('admin-coding-students').innerText();
  log(`관리자 코딩 탭: 코딩 수강생 ${studentCount}`);

  // 1) 김서연 → 영어만
  await admin.getByTestId('admin-subjects-stu-seoyeon').selectOption('english');
  await admin.waitForTimeout(400);
  log('관리자: 김서연 수강 과목 → 영어만 저장');

  await logout(admin);
  await loginStudent(admin, 'stu-seoyeon', '1111');
  await admin.getByText('안녕, 김서연!').waitFor();
  const afterEnglishOnly = {
    switch: await admin.getByTestId('subject-switch').count(),
    codingBtn: await admin.getByTestId('subject-coding').count(),
    rank: await admin.getByTestId('nav-rank').count(),
    navLabels: (await admin.getByTestId('student-nav').innerText()).replace(/\n/g, ' '),
  };
  log(
    `영어만 권한 학생 화면: 전환 스위치 ${afterEnglishOnly.switch}개 · 코딩 버튼 ${afterEnglishOnly.codingBtn}개 · 탭 [${afterEnglishOnly.navLabels}]`
  );
  await shot(admin, 'qa_coding_admin_englishonly.png');

  // 2) 다시 영어 + 코딩, 코딩 레벨 C4로 변경
  await logout(admin);
  await loginAdmin(admin);
  await admin.getByTestId('tab-coding').click();
  await admin.getByTestId('admin-subjects-stu-seoyeon').selectOption('both');
  await admin.getByTestId('admin-coding-level-stu-seoyeon').selectOption('C4');
  await admin.waitForTimeout(400);
  log('관리자: 김서연 → 영어+코딩, 코딩 레벨 C4');

  await logout(admin);
  await loginStudent(admin, 'stu-seoyeon', '1111');
  await admin.getByText('안녕, 김서연!').waitFor();
  await admin.getByTestId('subject-coding').click();
  await admin.getByTestId('coding-home').waitFor();
  const levelAfter = await admin.getByTestId('coding-level-pill').innerText();
  await admin.getByTestId('coding-start-mission').click();
  await admin.getByTestId('coding-mission-progress').waitFor();
  const missionBody = await admin.locator('main').innerText();
  log(`권한 복구 후: 코딩 레벨 배지 "${levelAfter.replace(/\n/g, ' ')}" · 미션 문제 레벨 C4 표시 ${missionBody.includes('C4')}`);
  await shot(admin, 'qa_coding_admin_level_c4.png');

  // 3) 코딩만 수강하는 학생(이하은)은 로그인 즉시 코딩 화면
  await logout(admin);
  await loginStudent(admin, 'stu-haeun', '3333');
  await admin.getByTestId('coding-home').waitFor();
  const haeun = {
    home: await admin.getByTestId('coding-home').count(),
    switch: await admin.getByTestId('subject-switch').count(),
    nav: (await admin.getByTestId('student-nav').innerText()).replace(/\n/g, ' '),
  };
  log(`코딩만 권한(이하은): 코딩 홈 표시 ${haeun.home} · 전환 스위치 ${haeun.switch}개 · 탭 [${haeun.nav}]`);
  await shot(admin, 'qa_coding_codingonly.png');

  const summary = {
    base: BASE,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    steps,
    shots,
    mission: { answered, missionCorrect },
    games: { menuCards: gameCards },
    cap: { cappedReward, dailyAfter, englishDaily },
    permissions: { afterEnglishOnly, haeun },
    errors,
  };
  fs.writeFileSync(path.join(OUT, 'qa_coding_summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({ steps: steps.length, errors, shots: shots.length }, null, 2));
} catch (err) {
  const summary = { base: BASE, steps, shots, errors, fatal: String(err && err.stack ? err.stack : err) };
  fs.writeFileSync(path.join(OUT, 'qa_coding_summary.json'), JSON.stringify(summary, null, 2));
  console.error('QA FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
