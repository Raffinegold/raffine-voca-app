/**
 * 실제 배포된 GitHub Pages 주소를 모바일 뷰포트로 점검 (배포 후 최종 확인용).
 * 실행: node qa/live-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.QA_LIVE ?? 'https://raffinegold.github.io/raffine-voca-app';
const errors = [];
const bad = [];

const b = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: 'ko-KR',
  timezoneId: 'Asia/Seoul',
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
});
const p = await ctx.newPage();
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
p.on('response', (r) => {
  if (r.status() >= 400 && !r.url().includes('/r/') && !r.url().includes('jsdelivr')) {
    bad.push(`${r.status()} ${r.url()}`);
  }
});

await p.goto(`${BASE}/`, { waitUntil: 'load' });
await p.getByText('라피네 영단어').first().waitFor();
console.log('로그인 화면 OK ·', p.url());
await p.screenshot({ path: '/workspace/attachments/2026-11-17/qa_live_mobile_login.png' });

await p.getByTestId('student-stu-seoyeon').click();
await p.getByRole('dialog').waitFor();
for (const d of '1111') await p.getByTestId(`pin-${d}`).click();
await p.getByText('안녕, 김서연!').waitFor();
console.log('학생 로그인 OK');
await p.screenshot({ path: '/workspace/attachments/2026-11-17/qa_live_mobile_student.png' });

await p.reload({ waitUntil: 'load' });
await p.getByText('안녕, 김서연!').waitFor();
console.log('새로고침 후 세션 유지 OK');

await p.getByTestId('start-mission').click();
await p.locator('header').getByText('카드 암기').waitFor();
console.log('미션 진입 OK ·', p.url());
await p.screenshot({ path: '/workspace/attachments/2026-11-17/qa_live_mobile_study.png' });

const p2 = await ctx.newPage();
p2.on('console', (m) => {
  if (m.type() === 'error') errors.push('[parent] ' + m.text());
});
await p2.goto(`${BASE}/r/a1b2c3d4e5f60718293a4b5c6d7e8f90`, { waitUntil: 'load' });
await p2.getByText('김서연').first().waitFor();
console.log('학부모 딥링크 OK');
await p2.screenshot({ path: '/workspace/attachments/2026-11-17/qa_live_mobile_parent.png', fullPage: true });

await p2.reload({ waitUntil: 'load' });
await p2.getByText('김서연').first().waitFor();
console.log('딥링크 새로고침 OK');

const sw = await p2.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return r ? 'registered: ' + r.scope : 'none';
});
console.log('서비스워커', sw);

await b.close();
console.log('콘솔 오류:', errors.length);
errors.slice(0, 6).forEach((e) => console.log(' !', e));
console.log('4xx/5xx:', bad.length);
bad.slice(0, 6).forEach((x) => console.log(' !', x));
