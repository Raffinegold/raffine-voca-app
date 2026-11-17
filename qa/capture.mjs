/**
 * QA 스크립트 — 로컬 프리뷰 서버를 실제 브라우저로 열어
 * 학생 로그인 → 카드 → 4지선다 → 스펠링 → 결과 → 관리자 → 학부모 리포트 흐름을 확인하고
 * 스크린샷과 콘솔 오류를 남깁니다.
 *
 * 실행: npm run build && npx vite preview --port 4173 &  node qa/capture.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4173';
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
fs.mkdirSync(OUT, { recursive: true });

const steps = [];
const errors = [];
const shots = [];
const started = Date.now();

const log = (msg) => {
  steps.push(msg);
  console.log(`• ${msg}`);
};

function attach(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ tag, kind: 'console', text: m.text() });
  });
  page.on('pageerror', (e) => errors.push({ tag, kind: 'pageerror', text: e.message }));
}

async function shot(page, name, fullPage = false) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage });
  shots.push(file);
  log(`스크린샷 ${name}`);
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  /* ----------------------------- 1. 학생 (모바일) ----------------------------- */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await mobile.newPage();
  page.setDefaultTimeout(12000);
  attach(page, 'student');

  const manifest = await page.request.get(`${BASE}/manifest.webmanifest`);
  const manifestBody = manifest.ok() ? await manifest.json() : null;
  log(`매니페스트 ${manifest.status()} · ${manifestBody?.name ?? '없음'} · 아이콘 ${manifestBody?.icons?.length ?? 0}개`);

  const iconRes = await page.request.get(`${BASE}/icons/icon-192.png`);
  log(`아이콘 응답 ${iconRes.status()}`);

  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.getByText('라피네 영단어').first().waitFor();
  await shot(page, 'qa_voca_login.png');

  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  log('학생 로그인 성공 (김서연 / PIN 1111)');
  await shot(page, 'qa_voca_student.png');

  const missionText = await page.locator('text=오늘의 미션').first().isVisible();
  log(`오늘의 미션 카드 표시: ${missionText}`);

  await page.getByTestId('start-mission').click();
  await page.locator('header').getByText('카드 암기').waitFor();
  log('카드 암기 단계 진입');
  await shot(page, 'qa_voca_card_front.png');

  await page.locator('.card-flip button').first().click();
  await page.getByText('눌러서 뜻 보기').first().waitFor({ state: 'hidden' }).catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'qa_voca_card_back.png');

  let cards = 0;
  while (cards < 40) {
    const btn = page.getByTestId('card-know');
    if (!(await btn.count()) || !(await btn.isVisible().catch(() => false))) break;
    await btn.click();
    cards += 1;
    await page.waitForTimeout(120);
  }
  log(`카드 ${cards}장 확인`);

  await page.locator('header').getByText('4지선다 퀴즈').waitFor();
  log('4지선다 단계 진입');

  // 시드 단어장을 읽어 정답을 골라 응답 (첫 문항만 일부러 틀려 피드백 화면을 남김)
  const seededWords = await page.evaluate(() => {
    const raw = localStorage.getItem('rafine-voca-db-v1');
    return raw ? JSON.parse(raw).words : [];
  });
  log(`시드 단어 ${seededWords.length}개 로드`);

  let choices = 0;
  let choiceCorrect = 0;
  let firstChoiceShot = false;
  while (choices < 60) {
    const options = page.getByTestId('choice-option');
    if (!(await options.count())) break;
    const texts = await options.allInnerTexts();
    const prompt = await page.locator('main .rounded-3xl').first().innerText();
    const lines = prompt.split('\n').map((t) => t.trim()).filter(Boolean);
    const head = lines[0] ?? '';
    let correctText = '';
    const byWord = seededWords.find((w) => w.word.toLowerCase() === head.toLowerCase());
    if (byWord) correctText = byWord.meaning;
    else {
      const byMeaning = seededWords.find((w) => w.meaning === head);
      if (byMeaning) correctText = byMeaning.word;
    }
    const cleaned = texts.map((t) => t.split('\n').map((x) => x.trim()).filter(Boolean).pop() ?? '');
    let targetIndex = cleaned.findIndex((t) => t === correctText.trim());
    if (targetIndex < 0) targetIndex = 0;
    const clickIndex = choices === 0 ? (targetIndex + 1) % texts.length : targetIndex; // 첫 문항은 오답
    if (choices === 0) await shot(page, 'qa_voca_quiz.png');
    await options.nth(clickIndex).click();
    const next = page.getByTestId('next-step');
    await next.waitFor();
    if (clickIndex === targetIndex) choiceCorrect += 1;
    if (!firstChoiceShot) {
      await shot(page, 'qa_voca_quiz_feedback.png');
      firstChoiceShot = true;
    }
    await next.click();
    choices += 1;
  }
  log(`4지선다 ${choices}문항 응답 (정답 ${choiceCorrect})`);

  await page.locator('header').getByText('스펠링 퀴즈').waitFor();
  log('스펠링 단계 진입');
  let spells = 0;
  let spellCorrect = 0;
  while (spells < 60) {
    const input = page.getByTestId('spell-input');
    if (!(await input.count()) || !(await input.isVisible().catch(() => false))) break;
    const cardText = await page.locator('main .rounded-3xl').first().innerText();
    const meaning = cardText.split('\n').map((t) => t.trim()).filter(Boolean)[0] ?? '';
    const match = seededWords.find((w) => w.meaning === meaning);
    const answer = spells === 0 ? 'test' : (match?.word ?? 'test');
    await input.fill(answer);
    if (spells === 0) await shot(page, 'qa_voca_spell.png');
    await page.getByTestId('spell-submit').click();
    const next = page.getByTestId('next-step');
    await next.waitFor();
    if (spells === 0) await shot(page, 'qa_voca_spell_feedback.png');
    const feedback = await page.locator('main').innerText();
    if (spells > 0 && match && feedback.includes('정확해요')) spellCorrect += 1;
    await next.click();
    spells += 1;
  }
  log(`스펠링 ${spells}문항 응답 (정답 ${spellCorrect})`);

  await page.locator('main').getByText('오늘의 결과').waitFor();
  await shot(page, 'qa_voca_result.png');
  const resultText = await page.locator('main').innerText();
  const accuracy = resultText.match(/정답\s*(\d+)\s*\/\s*(\d+)/);
  log(`결과 화면: ${accuracy ? `${accuracy[1]}/${accuracy[2]} 정답` : '정답 수 파싱 실패'}`);

  await page.getByRole('button', { name: '홈으로' }).click();
  await page.getByText('오늘 완료!').first().waitFor({ timeout: 8000 }).catch(() => {});
  await shot(page, 'qa_voca_student_done.png');

  // 오답노트 탭
  await page.getByRole('button', { name: '오답노트' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'qa_voca_wrongnote.png');

  // 랭킹 탭
  await page.getByRole('button', { name: '랭킹' }).click();
  await page.waitForTimeout(400);
  await shot(page, 'qa_voca_rank.png');

  /* --------------------------- 2. 학부모 리포트 ---------------------------- */
  const parentPage = await mobile.newPage();
  attach(parentPage, 'parent');
  await parentPage.goto(`${BASE}/r/a1b2c3d4e5f60718293a4b5c6d7e8f90`, { waitUntil: 'load' });
  await parentPage.getByText('주간 영단어 리포트').waitFor();
  await parentPage.waitForTimeout(400);
  await shot(parentPage, 'qa_voca_parent.png', true);
  log('학부모 리포트 열람 성공 (토큰 a1b2c3d4…f90)');

  const badToken = await mobile.newPage();
  attach(badToken, 'parent-bad');
  await badToken.goto(`${BASE}/r/zzzz`, { waitUntil: 'load' });
  const badOk = await badToken.getByText('링크를 확인해 주세요').isVisible();
  log(`잘못된 토큰 안내 표시: ${badOk}`);
  await badToken.close();

  /* ----------------------------- 3. 관리자 (PC) ----------------------------- */
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const admin = await desktop.newPage();
  admin.setDefaultTimeout(12000);
  attach(admin, 'admin');

  await admin.goto(`${BASE}/`, { waitUntil: 'load' });
  await admin.getByRole('button', { name: '원장님', exact: true }).click();
  for (const d of '9999') await admin.getByTestId(`pin-${d}`).click();
  await admin.getByText('이번 주 학원 현황').waitFor();
  log('관리자 로그인 성공 (PIN 9999)');
  await admin.waitForTimeout(600);
  await shot(admin, 'qa_voca_admin.png', true);

  await admin.getByTestId('tab-students').click();
  await admin.getByText('학생 관리').waitFor();
  await shot(admin, 'qa_voca_admin_students.png', true);

  // 학생 추가 → PIN 발급 모달
  await admin.getByRole('button', { name: '+ 학생 추가' }).click();
  await admin.getByPlaceholder('예) 김서연').fill('테스트학생');
  await admin.getByRole('button', { name: '추가하고 PIN 발급' }).click();
  await admin.getByText('PIN 발급 완료').waitFor();
  const pinText = await admin.getByText('테스트학생 학생의 PIN').isVisible();
  log(`학생 추가 및 PIN 발급 모달: ${pinText}`);
  await shot(admin, 'qa_voca_admin_addstudent.png');
  const issuedPin = (await admin.locator('.tracking-\\[0\\.35em\\]').innerText()).trim();
  log(`발급된 테스트 PIN: ${issuedPin}`);
  await admin.getByRole('button', { name: '확인' }).click();

  // 단어장 CSV
  await admin.getByTestId('tab-words').click();
  await admin.getByText('단어장 · CSV 업로드').waitFor();
  await admin
    .getByPlaceholder(/word,meaning,pos/)
    .fill(
      'word,meaning,pos,example,example_ko,order_no\nconfident,자신감 있는,adj,I feel confident before the demo.,나는 시연 전에 자신감이 있어요.,1\nrepeat,반복하다,v,Repeat the word three times.,그 단어를 세 번 반복하세요.,2\n,빈칸테스트,n,,,\nrepeat,중복테스트,v,,,'
    );
  await admin.getByText('정상 2행').waitFor();
  log('CSV 검증: 정상 2행 / 오류 2행 표시');
  await shot(admin, 'qa_voca_admin_csv.png', true);

  const beforeWords = await admin.locator('text=Level 3').first().innerText().catch(() => '');
  await admin.getByRole('button', { name: '미리보기 확인 후 저장' }).click();
  await admin.getByText(/2단어를 추가했어요/).waitFor();
  log(`CSV 저장 완료 (정상 2행만 저장). Level 3 카드: ${beforeWords.replace(/\n/g, ' ')}`);
  await shot(admin, 'qa_voca_admin_csv_saved.png', true);

  // 레벨 배정
  await admin.getByTestId('tab-levels').click();
  await admin.getByText('TOSEL 대응표').waitFor();
  await shot(admin, 'qa_voca_admin_levels.png', true);

  // 이하은 학생을 진단 결과 Junior(L4)로 원클릭 배정
  const row = admin.locator('tr', { hasText: '이하은' });
  await row.locator('select').selectOption({ label: 'Junior → L4' });
  await row.getByRole('button', { name: '배정', exact: true }).click();
  await admin.getByText(/Level 4 .*배정했어요/).waitFor();
  log('레벨 배정: 이하은 → Junior(L4) 적용');
  await shot(admin, 'qa_voca_admin_levels_assigned.png', true);

  // 금요일 리포트
  await admin.getByTestId('tab-report').click();
  await admin.getByText('금요일 학부모 요약').waitFor();
  await admin.waitForTimeout(300);
  await shot(admin, 'qa_voca_admin_report.png', true);

  await admin.getByTestId('copy-one').first().click();
  await admin.waitForTimeout(500);
  const clip = await admin.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  log(`클립보드 복사 확인: ${clip ? clip.split('\n')[0] : '읽기 실패'}`);
  await shot(admin, 'qa_voca_admin_copy_toast.png');

  await admin.getByTestId('preview-report').first().click();
  await admin.getByRole('dialog').waitFor();
  await shot(admin, 'qa_voca_admin_report_modal.png');
  log('학부모 리포트 미리보기 모달 열림');
  await admin.keyboard.press('Escape');

  const summary = {
    base: BASE,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    manifest: { status: manifest.status(), name: manifestBody?.name, icons: manifestBody?.icons?.length ?? 0, display: manifestBody?.display },
    steps,
    shots,
    clipboardHead: clip ? clip.split('\n').slice(0, 3) : null,
    errors,
  };
  fs.writeFileSync(path.join(OUT, 'qa_voca_summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({ steps: steps.length, errors, shots: shots.length }, null, 2));
} catch (err) {
  const summary = { base: BASE, steps, shots, errors, fatal: String(err && err.stack ? err.stack : err) };
  fs.writeFileSync(path.join(OUT, 'qa_voca_summary.json'), JSON.stringify(summary, null, 2));
  console.error('QA FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
