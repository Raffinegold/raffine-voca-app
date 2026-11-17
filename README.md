# 라피네 영단어 — TOSEL 연계 5단계 영단어 관리 앱 (MVP)

라피네코딩컴퓨터학원 두정점 · 설계서 `documents/rafine_voca_app_mvp_spec.md` 기반 1차 구현.
**웹 + PWA + Supabase 연동형**이며, Supabase 설정이 없으면 **LocalStorage 데모 모드**로 즉시 시연됩니다.

- 학생: 이름 + 4자리 PIN → 오늘의 미션(오답 먼저 + 신규) → 카드 암기 → 4지선다 → 스펠링 → 결과 → 스트릭·랭킹
- 학생 🃏 **단어 짝맞추기 게임**: 6쌍(12장)/8쌍(16장) 영단어↔한글 뜻 뒤집기, 콤보·효과음, 판당 보상, **하루 최대 50원** 캐시 적립(상한 후엔 연습 모드)
- 학생 🎁 **기프티콘 상점**: 보유 캐시로 츄파춥스·바나나맛 우유·CU 금액권 등 교환 신청 → 캐시 즉시 차감 · 신청 대기 내역
- 원장님: 대시보드 · 학생/PIN 발급 · TOSEL 진단 기반 레벨 배정 · CSV 단어장 · 금요일 학부모 요약 복사 · **상점·교환 관리(일일 상한 설정, 상품 CRUD, 발송 완료/취소 환불)**
- 학부모: `/r/:token` 읽기 전용 주간 리포트

## 빠른 실행

```bash
cd projects/rafine-voca-app
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc --noEmit && vite build → dist/
npm run preview      # http://localhost:4173 (빌드 결과 확인)
```

### 데모 계정 (LocalStorage 모드)

| 학생 | PIN | 레벨 |
|---|---|---|
| 김서연 | 1111 | Level 3 (Basic) |
| 박준우 | 2222 | Level 3 (Basic) |
| 이하은 | 3333 | Level 2 (Starter) |
| 정유진 | 5555 | Level 1 (Pre-Starter) |
| 최민준 | 4444 | Level 4 (Junior) |
| 원장님(관리자) | 9999 | – |

데모 데이터는 학생 5명 + Level 1~5 각 20단어(총 100단어) + 지난 10일 학습 기록이 자동 시드됩니다.
브라우저 저장소를 비우거나 관리자 화면의 콘솔에서 `localStorage.removeItem('rafine-voca-db-v1')` 후 새로고침하면 원래 데모로 돌아갑니다.

## 폴더 구조

```
rafine-voca-app/
├─ src/
│  ├─ data/seed.ts            # 학생 5명 · 100단어 시드 (뜻·예문 자체 작성)
│  ├─ lib/
│  │  ├─ store.ts             # 이중 모드 데이터 레이어 (LocalStorage / Supabase)
│  │  ├─ mission.ts           # 오늘의 미션 = 오답(최대 신규 50%) + 신규, 4지선다 보기 생성
│  │  ├─ stats.ts             # 주간 집계(첫 응답 기준 정답률) · 스트릭 · 랭킹
│  │  ├─ report.ts            # 학부모 요약 문구 · 링크 · 클립보드
│  │  ├─ csv.ts               # CSV 파싱·검증(빈칸·중복·오타 의심)
│  │  ├─ speech.ts            # Web Speech API 발음
│  │  ├─ sound.ts             # 짝맞추기 효과음(WebAudio, 무음 토글)
│  │  └─ util.ts              # 날짜·PIN 해시(데모)·문자열
│  ├─ pages/
│  │  ├─ LoginPage.tsx        # 학생 선택 + PIN / 원장님 모드 전환
│  │  ├─ StudentHome.tsx      # 오늘의 미션·오답노트·랭킹
│  │  ├─ StudyPage.tsx        # 카드 → 4지선다 → 스펠링 → 결과
│  │  ├─ GamePage.tsx         # 🃏 짝맞추기(카드 뒤집기·콤보·캐시 적립)
│  │  ├─ ShopPage.tsx         # 🎁 기프티콘 상점·교환 신청 내역
│  │  ├─ AdminPage.tsx        # 대시보드·학생·단어장·레벨 배정·상점·교환·금요일 리포트
│  │  └─ ParentReportPage.tsx # /r/:token 읽기 전용
│  └─ components/             # UI 키트 · 학생 하단 탭 · 학부모 리포트 카드
├─ supabase/schema.sql        # 테이블(학생·단어·로그·배정이력·세션·캐시지갑·상점·교환·게임) + RLS + RPC
├─ public/                    # 아이콘(PWA) · _redirects(SPA fallback) · favicon
├─ qa/capture.mjs             # Playwright 자동 점검 + 스크린샷(학습 흐름)
├─ qa/game-shop.mjs           # 게임·캐시 상한·상점 교환·관리자 승인 자동 점검
└─ .env.example
```

### 자동 점검 스크립트 (선택)

로컬에 Node·Chromium이 준비된 환경에서:

```bash
export PATH=~/.local/node/bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/pw-browsers
export LD_LIBRARY_PATH=/workspace/.cache/pw-libs/usr/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH
npm run build
npx vite preview --port 4173 &
QA_OUT=./qa-shots npm run qa     # 스크린샷 + 콘솔 오류 리포트
```

학생 로그인 → 18문항 풀이 → 결과 → 오답노트·랭킹 → 학부모 리포트 → 관리자 로그인/학생 추가/CSV/레벨 배정/금요일 복사까지 자동으로 확인합니다.

```bash
QA_BASE=http://127.0.0.1:4173/raffine-voca-app node qa/game-shop.mjs
```
짝맞추기 4판(퍼펙트·오답 포함)으로 **하루 50원 상한**과 연습 모드를 확인하고, 상점 교환 신청 → 관리자 발송 완료/취소(환불) → 상품 추가·삭제 → 학생 화면 반영까지 점검합니다.

## 짝맞추기 게임 · 캐시 · 상점 규칙 (2026-11-17 추가)

| 항목 | 내용 |
|---|---|
| 게임 | 학생 레벨 단어에서 6쌍(4×3, 12장) 또는 8쌍(4×4, 16장)을 뽑아 **영단어 카드 ↔ 한글 뜻 카드**를 뒤집어 짝짓기 |
| 판당 보상 | 기본 6쌍 10원 / 8쌍 15원 + 퍼펙트 5원 + 콤보 1~2원 + 스피드 3원 → **10~25원** |
| 일일 상한 | 학생 1인 **하루 50원**(관리자 설정에서 변경). 남은 한도만 적립되고, 다 채우면 **연습 모드**(0원)로 계속 플레이 |
| 오답 학습 | 틀렸던 단어는 결과 요약에서 **뜻과 함께** 다시 보여 줌 |
| 상점 | 초기 상품: 츄파춥스 300원 · 바나나맛 우유 1,500원 · CU 모바일금액권 3,000원 · 배스킨라빈스 싱글레귤러 3,900원 |
| 교환 | 보유 캐시가 충분할 때만 신청 버튼 활성화 → 신청 시 **즉시 차감** 후 ’신청 대기’ 기록 → 원장님 발송 완료 / 취소(환불) |
| 관리자 | PIN 9999 로그인 → 「상점·교환」 탭에서 일일 상한, 상품 추가·수정·숨김·삭제, 교환 처리 |
| 저장 | LocalStorage 데모 모드와 Supabase 모드 모두 같은 화면 코드. 실DB는 `cash_wallets`(cash_balance·daily_cash_earned) · `shop_items` · `redemption_requests` · `game_sessions` · `app_settings` 테이블과 `student_game_reward`/`student_redeem`/`admin_handle_redemption` RPC 사용 |

## Supabase 연결 (실시간 DB로 전환)

1. [supabase.com](https://supabase.com) → New project (무료).
2. **SQL Editor**에서 `supabase/schema.sql` 전문 실행. (학생·단어·로그·배정이력·세션 + `cash_wallets`·`shop_items`·`redemption_requests`·`game_sessions`·`app_settings` + RLS + RPC)
3. **Project Settings → API**에서 URL / anon key 복사 → `.env` 작성:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   VITE_PUBLIC_APP_URL=https://rafine-voca.pages.dev
   ```
4. **원장님 계정**: Authentication → Users → Add user 로 이메일/비밀번호 1개 생성 후, service_role 키로
   ```sql
   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
    where email = '원장님 이메일';
   ```
   → 앱의 「원장님」 탭이 PIN 대신 이메일/비밀번호 로그인으로 바뀝니다. TOTP 2단계 인증을 켜 두세요.
5. **학생 추가/PIN**: 관리자 화면의 「학생 추가」는 `admin_create_student` RPC를 호출하고, PIN은 서버에서 `crypt(pin, gen_salt('bf'))` bcrypt 해시로만 저장됩니다. PIN 재발급은 `admin_reset_pin`.
6. **학생 로그인**: anon 키로 `student_login(name, pin)` RPC 호출 → 12시간 세션 토큰 발급 → `student_bundle` / `student_answer` RPC로만 본인 데이터 접근. 테이블 직접 접근은 RLS로 차단됩니다.
7. **실시간**: 원장님 대시보드는 `study_logs`·`wrong_notes` Realtime 구독으로 새로고침 없이 갱신됩니다.

> 학부모 리포트(`/r/:token`)는 현재 앱이 `parent_token`으로 학생을 찾아 집계합니다. Supabase 모드에서 학부모 링크를 외부에 공개할 때는 `weekly_reports`만 service_role로 읽는 Edge Function(`parent-report`)으로 옮기는 것이 안전합니다(2차 작업). 그전까지 링크 공개 범위는 원장님 판단으로 제한하세요.

## 💻 영어 + 코딩 통합 (2026-11-17 업그레이드)

원장님(관리자, PIN 9999)이 학생별로 **수강 과목(영어만 / 코딩만 / 영어 + 코딩)** 과 **코딩 레벨(C1~C4)** 을 정하고,
학생은 상단 스위치로 `📚 영어` ↔ `💻 코딩`을 오갑니다. 기존 영어 기능(5단계 단어장·오답노트·랭킹·학부모 리포트)은 그대로입니다.

| 영역 | 내용 | 파일 |
|---|---|---|
| 과목 전환 | 두 과목을 모두 연 학생만 상단 `📚 영어 / 💻 코딩` 스위치 표시 · 한 과목만 열면 그 화면으로 고정 | `src/subject-context.tsx`, `src/components/SubjectSwitch.tsx`, `StudentHeader.tsx` |
| 코딩 커리큘럼 시드 | C1 블록·기초(스크래치·순서도) / C2 파이썬 / C3 C언어 / C4 유니티 C# — **38문제** (출력 14 · 빈칸 8 · 버그 8 · 블록 8) | `src/data/codingSeed.ts` |
| 코딩 `오늘` | 레벨별 일일 미션 5문제(오답 복습 최대 2 + 출력/빈칸), 틀린 문제는 해설과 함께 코딩 오답노트로 | `src/pages/CodingHome.tsx`, `src/lib/coding.ts` |
| 코딩 `게임` | 🐛 버그 찾기(5문제·콤보) / 🧩 블록 순서 맞추기(4문제) / ⚡ 출력 스피드 퀴즈(6문제·12초) | `src/pages/CodingGamePage.tsx` |
| 캐시 | 영어·코딩 **공용 지갑** — 하루 상한(기본 50원)을 나눠 씀. 상한을 채우면 연습 모드 | `store.grantCash` (기존 로직 그대로) |
| 관리자 | `💻 코딩` 탭 — 수강 과목·코딩 레벨 변경, 푼 문제·정답률·오답·게임 판수·오늘 적립, 최근 게임 기록 | `src/pages/AdminPage.tsx` |
| 실데이터 | 로컬 데모 완전 동작 + `supabase/schema.sql` **15) 코딩 확장** (students.coding_level·enabled_subjects, coding_logs·coding_wrong_notes·coding_sessions, `admin_set_subjects`·`student_coding_bundle` RPC) | `supabase/schema.sql`, `src/lib/store.ts` |

### 코딩 QA

```bash
npm run build
node qa/coding.mjs          # 과목 전환 · 코딩 미션 · 3게임 · 50원 상한 공용 연동 · 관리자 권한/레벨
node qa/english-smoke.mjs   # 영어 회귀 (로그인 → 카드 → 4지선다 → 스펠링 → 결과 → 오답노트 → 랭킹 → 상점)
```

두 스크립트 모두 `dist/` 를 Playwright 요청 인터셉트로 서빙하므로 로컬 서버 없이 실행됩니다.
스크린샷은 `attachments/2026-11-17/` 에 남습니다(`qa_coding_mission.png`, `qa_coding_game.png` 등).

### 데모 학생별 수강 과목 예시

| 학생 | PIN | 수강 과목 | 코딩 레벨 |
|---|---|---|---|
| 김서연 | 1111 | 영어 + 코딩 | C2 파이썬 |
| 박준우 | 2222 | 영어 + 코딩 | C3 C언어 |
| 이하은 | 3333 | 코딩만 | C1 블록·기초 |
| 최민준 | 4444 | 영어 + 코딩 | C4 유니티 C# |
| 정유진 | 5555 | 영어만 | C1 |

## GitHub Pages 배포 (현재 사용 중)

- 공개 주소: **https://Raffinegold.github.io/raffine-voca-app/**
- 저장소: https://github.com/Raffinegold/raffine-voca-app (public — 무료 플랜 Pages는 public 저장소에서만 동작)

배포 방식: `main` 은 소스, **`gh-pages` 브랜치는 빌드 결과(`dist/`)** 입니다. Pages 소스가 `gh-pages` 브랜치라서
소스를 고친 뒤에는 다시 빌드해 `gh-pages` 에 올려야 사이트가 바뀝니다.

```bash
npm run build
npx gh-pages -d dist          # 또는 아래 수동 스크립트
```

푸시할 때마다 자동 배포하려면 `docs/github-actions-deploy.md` 의 워크플로를 GitHub 웹에서 한 번 추가하세요
(Pickle 연결 권한에는 `workflows` 권한이 없어 워크플로 파일은 대신 푸시할 수 없습니다).

하위 경로 배포를 위한 설정은 이미 들어 있습니다.

| 항목 | 처리 |
|---|---|
| `base` | `vite.config.ts` — 프로덕션 빌드 시 `/raffine-voca-app/` (`VITE_BASE` 로 덮어쓰기 가능) |
| SPA 새로고침 404 | `npm run postbuild` → `dist/404.html` = `index.html` (`scripts/copy-404.mjs`) |
| 라우터 기준 경로 | `src/App.tsx` 의 `BrowserRouter basename` = `import.meta.env.BASE_URL` |
| 학부모 링크 | `src/lib/report.ts` — `origin + BASE_URL` 기준으로 `/r/토큰` 생성 |
| PWA | `start_url`·`scope`·아이콘 경로를 base 기준으로 생성 |

로컬에서 Pages와 같은 조건으로 확인하려면:

```bash
npm run build && node qa/pages-server.mjs 4180 & node qa/verify-pages.mjs
```

루트 도메인(Cloudflare Pages 등)으로 옮길 때는 `VITE_BASE=/ npm run build` 로 빌드하면 됩니다.

## Cloudflare Pages 배포 (대안)

1. GitHub에 이 폴더를 올립니다 (또는 `npx wrangler pages deploy dist`).
2. Cloudflare Pages → Create project → Framework preset: **Vite**, Build command `npm run build`, Output `dist`.
3. Environment variables에 `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_PUBLIC_APP_URL` 입력 후 재배포.
4. `public/_redirects`(`/* /index.html 200`)가 포함되어 있어 `/r/:token` 직접 접근도 동작합니다.
5. 안드로이드 앱은 PWA(홈 화면 추가) → 필요하면 `npx @bubblewrap/cli init`으로 TWA APK. (Play 등록은 계정 상태 확인 후)

## 8단계 규칙 구현 상태

| 설계서 규칙 | 구현 |
|---|---|
| 오늘 = 오답(최대 신규 50%) + 신규, 오답 먼저 | `lib/mission.ts` |
| 4지선다 오답 보기 = 같은 레벨·같은 품사 3개, 위치 랜덤 | `buildChoices` + `shuffle` |
| 간격 반복 box 0→1일→2일→4일→7일→졸업 | `store.applyWrongNote` |
| 완료 = 그날 배정 80% 이상 → 스트릭 1일 | `isCompletedToday` / `computeStreak` |
| 주간 집계 = 중복 제거 단어 수, **첫 응답 기준** 정답률 | `lib/stats.ts` |
| 카톡 문구는 쉼표·슬래시·줄바꿈만 | `lib/report.ts` |
| 랭킹은 닉네임만, 상위 5명 + 내 순위 | `weeklyRanking` |
| 공용 태블릿 5분 무입력 자동 저장 | 문항마다 즉시 저장(store) + 「나가기」 시 저장 안내 |
| 학생 PIN 평문 저장 금지 | 데모: salted 해시 / Supabase: bcrypt |

## 검증 결과 (2026-11-17)

- `npm install` 성공 (Node 22.14, 425 packages)
- `npm run build` 성공 — `dist/` 약 273KB JS(gzip 88KB) + PWA `sw.js`, `manifest.webmanifest`(아이콘 3종) 생성
- Playwright 실제 브라우저 점검 (`qa/capture.mjs`): 학생 로그인 → 18문항(카드/4지선다/스펠링) → 결과 94% → 오답노트·랭킹 → 학부모 리포트 → 관리자 로그인 → 학생 추가/PIN 발급 → CSV 검증·저장 → 레벨 배정 → 금요일 복사(클립보드 실제 확인) → 리포트 미리보기. **콘솔 오류 0건**, 스크린샷 `attachments/2026-11-17/qa_voca_*.png` 23장.

## 남은 작업 (2차)

- Supabase 모드 실계정 리허설(현재 코드·스키마·RPC 준비 완료, 실프로젝트 미연결)
- 학부모 리포트 Edge Function 이전, 토큰 90일 만료·학기 재발급
- PIN 5회 실패 잠금(서버 측 시도 제한), 관리자 자동 백업 Cron
- TWA(APK) 빌드와 Play 계정 상태 확인
- 레벨 승급 추천 배지(3일 연속 85% 이상)

## 데이터·저작권

단어는 교육부 기본 어휘 성격의 단어를 자체 선정하고, 뜻·예문은 학원·코딩 소재로 직접 작성했습니다(사전 문장 복제 없음). TOSEL 공식 교재·단어집은 사용하지 않았고, 화면 표기는 `Level 1~5`로 통일했습니다.
