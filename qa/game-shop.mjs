/**
 * QA — 짝맞추기 게임 · 캐시 적립(하루 50원 상한) · 기프티콘 상점 · 관리자 교환 처리
 *
 * 실행:
 *   npm run build
 *   npx vite preview --port 4173 &
 *   node qa/game-shop.mjs
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
    if (r.status() >= 400) errors.push({ tag, kind: 'http', text: `${r.status()} ${r.url()}` });
  });
}

async function shot(page, name, fullPage = false) {
  const file = path.join(OUT, name);
  if (fullPage) {
    // sticky 헤더가 긴 페이지 캐처 중간에 끼어들지 않게 고정을 잠시 풉니다 (캐처 전용)
    await page.addStyleTag({ content: 'header{position:static !important}' });
    // 전체 높이를 한 번 그려 두어야 긴 페이지가 빈 영역 없이 저장됩니다
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(350);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
  }
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.screenshot({ path: file, fullPage });
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      console.log(`  (스크린샷 재시도 ${attempt}: ${err.message.split('\n')[0]})`);
      await page.waitForTimeout(700);
    }
  }
  shots.push(file);
  log(`스크린샷 ${name}`);
}

const num = (text) => Number(String(text).replace(/[^\d]/g, ''));

/** 카드 배열을 읽어 짝(pair)끼리 순서대로 뒤집습니다 */
async function readCards(page) {
  return page.$$eval('[data-testid^="game-card-"]', (els) =>
    els.map((el) => ({
      idx: Number((el.getAttribute('data-testid') ?? '').replace('game-card-', '')),
      pair: el.getAttribute('data-pair'),
      face: el.getAttribute('data-face'),
      word: el.getAttribute('data-word'),
    }))
  );
}

async function playRound(page, { missOnce = false } = {}) {
  const list = await readCards(page);
  const byPair = new Map();
  for (const c of list) {
    const arr = byPair.get(c.pair) ?? [];
    arr.push(c);
    byPair.set(c.pair, arr);
  }
  const pairs = [...byPair.values()].filter((p) => p.length === 2);
  let missed = false;

  for (let i = 0; i < pairs.length; i++) {
    const [a, b] = pairs[i];
    if (missOnce && !missed && i === 0) {
      const wrong = pairs[1][0];
      await page.getByTestId(`game-card-${a.idx}`).click();
      await page.waitForTimeout(200);
      await page.getByTestId(`game-card-${wrong.idx}`).click();
      await page.waitForTimeout(1000);
      missed = true;
      log('일부러 한 번 틀려서 오답 요약 확인 준비');
    }
    await page.getByTestId(`game-card-${a.idx}`).click();
    await page.waitForTimeout(170);
    await page.getByTestId(`game-card-${b.idx}`).click();
    await page.waitForTimeout(600);
  }
  await page.getByTestId('game-summary').waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
}

async function readGameResult(page) {
  const reward = await page.getByTestId('game-reward').innerText();
  const daily = await page.getByTestId('game-daily-earned').innerText();
  const balance = await page.getByTestId('game-balance').innerText();
  const stats = await page.getByTestId('game-stats').innerText();
  const summary = await page.getByTestId('game-summary').innerText();
  return {
    reward: num(reward),
    dailyEarned: num(daily.split('/')[0]),
    dailyLimit: num(daily.split('/')[1]),
    balance: num(balance),
    stats: stats.replace(/\s+/g, ' ').trim(),
    capped: summary.includes('오늘 적립 상한'),
    wrongWords: (await page.getByTestId('game-wrong-list').count()) > 0,
    summaryText: summary,
  };
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  /* --------------------------- 1. 학생 · 게임 (모바일) --------------------------- */
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const page = await mobile.newPage();
  page.setDefaultTimeout(15000);
  attach(page, 'student');

  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  const homeCash = num(await page.getByTestId('home-cash').innerText());
  log(`학생 로그인 OK · 홈 캐시 표시 ${homeCash}원`);

  await page.getByTestId('nav-game').click();
  await page.getByTestId('eng-game-menu').waitFor();
  await page.getByTestId('eng-pick-match').click();
  await page.getByTestId('game-board').waitFor();
  const cards = await readCards(page);
  const faces = new Set(cards.map((c) => c.face));
  const pairs = new Set(cards.map((c) => c.pair));
  log(`게임 탭 진입 · 카드 ${cards.length}장 / ${pairs.size}쌍 / 카드 종류 ${[...faces].join(',')}`);
  if (cards.length !== 12 || pairs.size !== 6 || faces.size !== 2) throw new Error('6쌍(12장) 보드 구성이 기대와 달라요');

  // (1) 퍼펙트 클리어 — 시작 전에 카드 한 장을 뒤집은 ’플레이 중’ 화면도 남깁니다
  await page.getByTestId(`game-card-${cards[0].idx}`).click();
  await page.waitForTimeout(300);
  await page.getByTestId('game-board').scrollIntoViewIfNeeded();
  await shot(page, 'qa_voca_game_play.png');
  await playRound(page);
  const r1 = await readGameResult(page);
  log(`1판 결과: 보상 +${r1.reward}원 · 오늘 적립 ${r1.dailyEarned}/${r1.dailyLimit}원 · 잔액 ${r1.balance}원 · ${r1.stats}`);
  if (r1.reward <= 0) throw new Error('1판 보상이 0원이에요');
  if (r1.dailyEarned !== r1.reward) throw new Error('오늘 적립과 보상이 어긋나요');
  if (r1.capped) throw new Error('첫 판부터 상한에 걸렸어요');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, 'qa_voca_game.png');

  // (2) 한 번 틀린 판 → 오답 요약 확인
  await page.getByTestId('game-restart').click();
  await page.getByTestId('game-summary').waitFor({ state: 'detached' });
  await playRound(page, { missOnce: true });
  const r2 = await readGameResult(page);
  log(`2판(1회 오답) 결과: 보상 +${r2.reward}원 · 오늘 적립 ${r2.dailyEarned}/${r2.dailyLimit}원 · 오답 단어 표시 ${r2.wrongWords}`);
  if (!r2.wrongWords) throw new Error('틀린 단어 요약이 보이지 않아요');
  if (!r2.summaryText.includes('헷갈린 단어')) throw new Error('헷갈린 단어 제목이 없어요');

  // (3) 상한까지 채우기 — 남은 금액만 적립되는지
  await page.getByTestId('game-restart').click();
  await page.getByTestId('game-summary').waitFor({ state: 'detached' });
  await playRound(page);
  const r3 = await readGameResult(page);
  log(`3판 결과: 보상 +${r3.reward}원 · 오늘 적립 ${r3.dailyEarned}/${r3.dailyLimit}원 · 상한 문구 ${r3.capped}`);
  if (r3.dailyEarned !== r3.dailyLimit) throw new Error(`하루 상한(${r3.dailyLimit}원)까지 차오르지 않았어요`);
  if (!r3.capped) throw new Error('상한에 닿았는데 안내 문구가 없어요');

  // (4) 상한 이후 = 연습 모드 (0원)
  await page.getByTestId('game-restart').click();
  await page.getByTestId('game-summary').waitFor({ state: 'detached' });
  const practiceBadge = await page.getByText('연습 모드').first().isVisible();
  await playRound(page);
  const r4 = await readGameResult(page);
  log(`4판(연습 모드 ${practiceBadge}) 결과: 보상 +${r4.reward}원 · 오늘 적립 ${r4.dailyEarned}/${r4.dailyLimit}원`);
  if (r4.reward !== 0) throw new Error('상한 이후에도 캐시가 적립됐어요');
  if (r4.balance !== r3.balance) throw new Error('연습 모드에서 잔액이 변했어요');

  // 8쌍(16장) 난이도 전환 확인
  await page.getByTestId('game-pairs-8').click();
  await page.waitForTimeout(500);
  const cards8 = await readCards(page);
  const pairs8 = new Set(cards8.map((c) => c.pair)).size;
  log(`8쌍 모드 전환 · 카드 ${cards8.length}장 / ${pairs8}쌍`);
  if (cards8.length !== 16 || pairs8 !== 8) throw new Error('8쌍 보드가 16장(8쌍)이 아니에요');

  /* --------------------------- 2. 상점 교환 신청 --------------------------- */
  await page.getByTestId('nav-shop').click();
  await page.getByText('기프티콘 상점').first().waitFor();
  const shopBalanceBefore = num(await page.getByTestId('shop-balance').innerText());
  const shopDaily = await page.getByTestId('shop-daily-earned').innerText();
  log(`상점 진입 · 보유 ${shopBalanceBefore}원 · 오늘 ${shopDaily.replace(/\s+/g, '')}`);
  if (shopBalanceBefore !== r4.balance) throw new Error('상점 잔액이 게임 잔액과 달라요');

  const itemNames = await page.$$eval('[data-testid^="shop-item-"]', (els) => els.map((e) => e.innerText.replace(/\n/g, ' ')));
  log(`상품 ${itemNames.length}개: ${itemNames.join(' | ')}`);

  const giftPrice = 300;
  await page.getByTestId('shop-redeem-item-chupachups').click();
  await page.getByRole('dialog').waitFor();
  await shot(page, 'qa_voca_shop_confirm.png');
  await page.getByTestId('shop-confirm').click();
  await page.getByText(/교환을 신청했어요/).waitFor();
  await page.waitForTimeout(500);
  const shopBalanceAfter = num(await page.getByTestId('shop-balance').innerText());
  log(`교환 신청 후 잔액 ${shopBalanceAfter}원 (차감 ${shopBalanceBefore - shopBalanceAfter}원)`);
  if (shopBalanceBefore - shopBalanceAfter !== giftPrice) throw new Error('교환 금액만큼 차감되지 않았어요');
  const requestList = await page.getByTestId('shop-request-list').innerText();
  if (!requestList.includes('신청 대기')) throw new Error('신청 대기 내역이 없어요');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot(page, 'qa_voca_shop.png');

  /* --------------------------- 3. 관리자 교환 처리 --------------------------- */
  // LocalStorage 데모 모드에서는 학생·원장님이 같은 브라우저 저장소를 공유합니다.
  // 실제 학원(실DB)에서도 같은 흐름이 되도록, 같은 컨텍스트에서 데스크톱 화면을 열어 확인합니다.
  const admin = await mobile.newPage();
  await admin.setViewportSize({ width: 1280, height: 900 });
  admin.setDefaultTimeout(15000);
  attach(admin, 'admin');

  await admin.goto(`${BASE}/`, { waitUntil: 'load' });
  await admin.getByText('안녕, 김서연!').waitFor();
  await admin.evaluate(() => localStorage.removeItem('rafine-voca-session-v1'));
  await admin.reload({ waitUntil: 'load' });
  await admin.getByRole('button', { name: '원장님', exact: true }).click();
  for (const d of '9999') await admin.getByTestId(`pin-${d}`).click();
  await admin.getByText('이번 주 학원 현황').waitFor();
  log('관리자 로그인 OK (PIN 9999)');

  await admin.getByTestId('tab-shop').click();
  await admin.getByText('상점 · 교환 관리').waitFor();
  const pendingCount = num(await admin.getByTestId('admin-pending-count').innerText());
  log(`상점·교환 관리 진입 · 대기 ${pendingCount}건`);

  // 상태가 바뀐 뒤에도 행이 남아 있도록 ’전체’ 필터로 전환
  await admin.getByRole('button', { name: /^전체 \d+$/ }).click();
  await admin.waitForTimeout(300);

  // 관리자 화면 스크린샷 — 교환 대기 건과 처리 버튼이 보이는 상태로 남깁니다.
  // (고정 헤더가 긴 캐처 중간에 겹치지 않도록 헤더 고정만 잠시 풉니다)
  await admin.setViewportSize({ width: 1280, height: 1560 });
  await admin.addStyleTag({ content: 'header{position:static !important}' });
  await admin.waitForTimeout(600);
  await shot(admin, 'qa_voca_admin_shop.png');
  await admin.reload({ waitUntil: 'load' });
  await admin.getByText('이번 주 학원 현황').waitFor();
  await admin.getByTestId('tab-shop').click();
  await admin.getByText('상점 · 교환 관리').waitFor();
  await admin.getByRole('button', { name: /^전체 \d+$/ }).click();
  await admin.setViewportSize({ width: 1280, height: 900 });
  await admin.waitForTimeout(400);
  log('관리자 화면 새로고침 후에도 교환 대기 상태 유지 확인');

  // 일일 상한 설정 변경 → 복원
  await admin.getByTestId('admin-cash-limit').fill('60');
  await admin.getByTestId('admin-cash-limit-save').click();
  await admin.getByText(/하루 적립 상한을 60원으로/).waitFor();
  log('일일 상한 60원으로 변경 확인');
  await admin.getByTestId('admin-cash-limit').fill('50');
  await admin.getByTestId('admin-cash-limit-save').click();
  await admin.getByText(/하루 적립 상한을 50원으로/).waitFor();
  log('일일 상한 50원으로 복원 확인');

  // 학생이 신청한 건 → 발송 완료
  const newReqRow = admin.locator('[data-testid^="admin-redeem-row-"]', { hasText: '츄파춥스' }).filter({ hasText: '김서연' }).first();
  await newReqRow.waitFor();
  const newReqId = (await newReqRow.getAttribute('data-testid'))?.replace('admin-redeem-row-', '') ?? '';
  await newReqRow.getByTestId(`admin-redeem-send-${newReqId}`).click();
  await admin.getByText(/발송 완료로 표시했어요/).waitFor();
  await admin.waitForTimeout(400);
  const sentRowText = await newReqRow.innerText();
  log(`김서연 츄파춥스 신청 → 발송 완료 처리 (${newReqId})`);
  if (!sentRowText.includes('발송 완료')) throw new Error('발송 완료 상태로 바뀌지 않았어요');

  // 데모 대기 건 → 취소(환불)
  const demoRow = admin.locator('[data-testid^="admin-redeem-row-"]', { hasText: '박준우' }).first();
  if (await demoRow.count()) {
    const demoId = (await demoRow.getAttribute('data-testid'))?.replace('admin-redeem-row-', '') ?? '';
    await demoRow.getByTestId(`admin-redeem-cancel-${demoId}`).click();
    await admin.getByText(/원을 박준우에게 돌려줬어요/).waitFor();
    await admin.waitForTimeout(400);
    const canceledText = await demoRow.innerText();
    log('박준우 데모 신청 → 취소(환불) 처리');
    if (!canceledText.includes('취소')) throw new Error('취소 상태로 바뀌지 않았어요');
  }

  // 상품 추가 → 삭제 (CRUD)
  await admin.getByTestId('admin-shop-add').click();
  await admin.getByTestId('admin-item-name').waitFor();
  await admin.getByTestId('admin-item-name').fill('QA 테스트 간식');
  await admin.getByTestId('admin-item-price').fill('500');
  await admin.getByTestId('admin-item-save').click();
  await admin.waitForTimeout(900);
  const afterAddText = await admin.locator('body').innerText();
  if (!afterAddText.includes('QA 테스트 간식 상품을 추가했어요')) {
    console.log('DEBUG tail:', afterAddText.slice(-500).replace(/\n/g, ' | '));
    await shot(admin, 'dbg_admin_add_fail.png', true);
    throw new Error('상품 추가 토스트가 보이지 않아요');
  }
  log('상품 추가 확인');
  const addedRow = admin.locator('[data-testid^="admin-item-row-"]', { hasText: 'QA 테스트 간식' }).first();
  await addedRow.waitFor();
  const addedId = (await addedRow.getAttribute('data-testid'))?.replace('admin-item-row-', '') ?? '';
  log(`상품 행 확인 (${addedId})`);
  await admin.getByTestId(`admin-item-delete-${addedId}`).click();
  await admin.getByText(/상품을 삭제했어요/).waitFor();
  await admin.waitForTimeout(300);
  if (await addedRow.count()) throw new Error('상품이 삭제되지 않았어요');
  log('상품 삭제 확인');



  // 학생 화면 새로고침 후 발송 완료 상태 반영 확인 (같은 저장소를 쓰므로 그대로 보입니다)
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('rafine-voca-session-v1'));
  await page.reload({ waitUntil: 'load' });
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  await page.getByTestId('nav-shop').click();
  await page.getByTestId('shop-request-list').waitFor();
  const afterReload = await page.getByTestId('shop-request-list').innerText();
  const balanceAfterAdmin = num(await page.getByTestId('shop-balance').innerText());
  log(`학생 재로그인 후 신청 내역: ${afterReload.replace(/\n/g, ' / ')} · 잔액 ${balanceAfterAdmin}원`);
  if (!afterReload.includes('발송 완료')) throw new Error('학생 화면에 발송 완료가 반영되지 않았어요');

  const summary = {
    base: BASE,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    rounds: [r1, r2, r3, r4].map(({ summaryText, ...rest }) => rest),
    game: { startBalance: homeCash, finalBalance: r4.balance, dailyLimit: r4.dailyLimit },
    shop: { items: itemNames, balanceBefore: shopBalanceBefore, balanceAfter: shopBalanceAfter, giftPrice },
    admin: { pendingCount, newReqId, requestAfterReload: afterReload.replace(/\n/g, ' / ') },
    steps,
    shots,
    errors,
  };
  fs.writeFileSync(path.join(OUT, 'qa_voca_game_shop_summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify({ steps: steps.length, shots: shots.length, errors }, null, 2));
} catch (err) {
  const summary = { base: BASE, steps, shots, errors, fatal: String(err && err.stack ? err.stack : err) };
  fs.writeFileSync(path.join(OUT, 'qa_voca_game_shop_summary.json'), JSON.stringify(summary, null, 2));
  console.error('QA FAILED:', err);
  process.exitCode = 1;
} finally {
  await browser.close();
}
