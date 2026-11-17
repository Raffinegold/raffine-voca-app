/**
 * GitHub Pages 하위 경로(/rafine-voca-app/) 배포 검증.
 * pages-server.mjs 로 실제 Pages 와 같은 라우팅(루트 302, 미존재 경로 404.html)을 띄운 뒤
 *  - 첫 진입 · 새로고침 · 딥링크(/r/토큰) · PWA 매니페스트를 실제 브라우저로 확인합니다.
 *
 * 실행: npm run build && node qa/pages-server.mjs 4180 & node qa/verify-pages.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = process.env.QA_ORIGIN ?? 'http://127.0.0.1:4180';
const PREFIX = '/rafine-voca-app';
const OUT = process.env.QA_OUT ?? '/workspace/attachments/2026-11-17';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const badResponses = [];
const log = (m) => console.log(`• ${m}`);

function attach(page, tag) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push({ tag, text: m.text() });
  });
  page.on('pageerror', (e) => errors.push({ tag, text: e.message }));
  page.on('response', (r) => {
    const status = r.status();
    const u = r.url();
    if (status >= 400 && !u.includes('/r/') && !u.startsWith('https://cdn.jsdelivr.net')) {
      badResponses.push({ tag, status, url: u });
    }
  });
}

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });

try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  attach(page, 'main');

  /* 1) 루트 진입 → 하위 경로로 이동하며 로그인 화면 표시 */
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  await page.getByText('라피네 영단어').first().waitFor();
  log(`첫 진입 URL: ${page.url()}`);
  await page.screenshot({ path: path.join(OUT, 'qa_pages_login.png') });

  /* 2) PWA 자원 */
  const mf = await page.request.get(`${ORIGIN}${PREFIX}/manifest.webmanifest`);
  const mfBody = mf.ok() ? await mf.json() : null;
  log(`매니페스트 ${mf.status()} · start_url=${mfBody?.start_url} · scope=${mfBody?.scope}`);
  const swRes = await page.request.get(`${ORIGIN}${PREFIX}/sw.js`);
  log(`sw.js ${swRes.status()}`);
  const iconRes = await page.request.get(`${ORIGIN}${PREFIX}/icons/icon-192.png`);
  log(`icon-192 ${iconRes.status()}`);

  /* 3) 학생 로그인 → 새로고침 후에도 유지 */
  await page.getByTestId('student-stu-seoyeon').click();
  await page.getByRole('dialog').waitFor();
  for (const d of '1111') await page.getByTestId(`pin-${d}`).click();
  await page.getByText('안녕, 김서연!').waitFor();
  log('학생 로그인 성공 (김서연 / 1111)');
  await page.screenshot({ path: path.join(OUT, 'qa_pages_student.png') });

  await page.reload({ waitUntil: 'load' });
  await page.getByText('안녕, 김서연!').waitFor();
  log('새로고침 후 세션 유지 확인');

  /* 4) 미션 1문항 진입 (하위 경로 라우팅 확인: /study) */
  await page.getByTestId('start-mission').click();
  await page.locator('header').getByText('카드 암기').waitFor();
  log(`미션 진입 URL: ${page.url()}`);
  await page.screenshot({ path: path.join(OUT, 'qa_pages_study.png') });

  /* 5) 학부모 딥링크 — 서버는 404 상태 + 404.html 을 주지만 앱이 렌더돼야 함 */
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  });
  const parent = await ctx2.newPage();
  parent.setDefaultTimeout(15000);
  attach(parent, 'parent');
  const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const resp = await parent.goto(`${ORIGIN}${PREFIX}/r/${token}`, { waitUntil: 'load' });
  await parent.getByText('김서연').first().waitFor();
  const reportVisible = await parent
    .getByText(/주간|이번 주|리포트/)
    .first()
    .isVisible()
    .catch(() => false);
  log(`딥링크 /r/${token.slice(0, 6)}… → HTTP ${resp?.status()} · 리포트 렌더 ${reportVisible}`);
  await parent.screenshot({ path: path.join(OUT, 'qa_pages_parent.png'), fullPage: true });

  /* 6) 새로고침해도 딥링크 유지 */
  await parent.reload({ waitUntil: 'load' });
  await parent.getByText('김서연').first().waitFor();
  log('딥링크 새로고침 후에도 리포트 유지');

  /* 7) 없는 경로 → 로그인 화면으로 */
  const ctx3 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR' });
  const p3 = await ctx3.newPage();
  attach(p3, 'fallback');
  await p3.goto(`${ORIGIN}${PREFIX}/does-not-exist`, { waitUntil: 'load' });
  await p3.getByText('라피네 영단어').first().waitFor();
  log(`미존재 경로 → 앱 표시 · URL ${p3.url()}`);
} finally {
  await browser.close();
}

console.log('\n=== 결과 ===');
console.log(`콘솔/페이지 오류: ${errors.length}건`);
for (const e of errors.slice(0, 10)) console.log(`  ! [${e.tag}] ${e.text}`);
console.log(`예상 밖 4xx/5xx 응답: ${badResponses.length}건`);
for (const b of badResponses.slice(0, 10)) console.log(`  ! [${b.tag}] ${b.status} ${b.url}`);
process.exit(errors.length || badResponses.length ? 1 : 0);
