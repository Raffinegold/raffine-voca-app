import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSession, useVocaStore } from '../app-context';
import StudentNav from '../components/StudentNav';
import StudentHeader from '../components/StudentHeader';
import { Badge, Bar, Button, Card, SectionTitle } from '../components/ui';
import { buildGameProblems, CODING_GAME_META, shuffleChoices } from '../lib/coding';
import { sfx } from '../lib/sound';
import { cn, shuffle } from '../lib/util';
import { CODING_LEVEL_META, type CodingGameKey, type CodingProblem, type Student } from '../types';

const SPEED_LIMIT_MS = 12000;
const FAST_BONUS_MS = 5000;

const GAMES: CodingGameKey[] = ['bug', 'order', 'speed'];

/**
 * 💻 코딩 게임 — 🐛 버그 찾기 · 🧩 블록 순서 맞추기 · ⚡ 출력 스피드 퀴즈.
 * 캐시는 영어 게임과 같은 지갑(하루 상한)을 함께 씁니다.
 */
export default function CodingGamePage() {
  const store = useVocaStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { student } = useSession();
  const initial = params.get('g');
  const [game, setGame] = useState<CodingGameKey | null>(
    initial === 'bug' || initial === 'order' || initial === 'speed' ? initial : null
  );
  const [round, setRound] = useState(0);

  if (!student) return null;

  const limit = store.cashDailyLimit();
  const earnedToday = store.todayCashEarned(student.id);
  const remaining = Math.max(0, limit - earnedToday);

  const play = (key: CodingGameKey) => {
    setGame(key);
    setRound((r) => r + 1);
  };

  return (
    <div className="min-h-screen pb-safe">
      <StudentHeader
        icon="🎮"
        brand="코딩 게임"
        title={`${student.name}의 코딩 놀이터`}
        accent="dark"
        right={
          <span
            className="whitespace-nowrap rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-700"
            data-testid="coding-game-balance"
          >
            💰 {store.cashBalance(student.id).toLocaleString()}원
          </span>
        }
      />

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">
        {/* 오늘 적립 (영어·코딩 공용) */}
        <div className="rounded-3xl border border-white bg-white/90 p-4 shadow-soft">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-800">오늘 적립</p>
              <span className="text-xs font-semibold text-slate-500" data-testid="coding-daily-earned">
                {earnedToday} / {limit}원
              </span>
            </div>
            {remaining === 0 ? <Badge tone="sun">연습 모드</Badge> : <Badge tone="mint">오늘 {remaining}원 더 모을 수 있어요</Badge>}
          </div>
          <div className="mt-2">
            <Bar ratio={limit > 0 ? earnedToday / limit : 1} tone={remaining === 0 ? 'sun' : earnedToday > 0 ? 'mint' : 'brand'} />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            영어 게임과 코딩 게임이 같은 지갑을 써요. 하루 최대 {limit}원까지 쌓이고, 다 채우면 연습 모드로 계속 놀 수 있어요.
          </p>
        </div>

        <div className="mt-4">
          {game ? (
            <GameRunner
              key={`${game}-${round}`}
              game={game}
              student={student}
              onPick={play}
              onExit={() => setGame(null)}
              onShop={() => navigate('/shop')}
            />
          ) : (
            <GamePicker student={student} onPick={play} />
          )}
        </div>
      </main>

      <StudentNav active="game" />
    </div>
  );
}

/* --------------------------------- 게임 선택 -------------------------------- */

function GamePicker({ student, onPick }: { student: Student; onPick: (g: CodingGameKey) => void }) {
  const store = useVocaStore();
  const sessions = store.codingSessionsFor(student.id, 5);
  return (
    <div className="space-y-4">
      <div>
        <p className="text-lg font-extrabold text-slate-900">오늘은 어떤 게임을 할까요?</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {CODING_LEVEL_META[student.coding_level].label} 문제로 진행돼요. 한 판마다 캐시를 적립해요.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {GAMES.map((key) => {
          const meta = CODING_GAME_META[key];
          return (
            <button
              key={key}
              data-testid={`coding-pick-${key}`}
              onClick={() => onPick(key)}
              className="group flex flex-col items-start gap-1 rounded-3xl border border-white bg-white p-4 text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-card active:scale-[0.99]"
            >
              <span className="text-3xl">{meta.icon}</span>
              <span className="mt-1 text-[15px] font-extrabold text-slate-900">{meta.label}</span>
              <span className="text-[11px] leading-relaxed text-slate-500">{meta.desc}</span>
              <span className="mt-2 rounded-full bg-slate-900 px-2.5 py-1 text-[10px] font-bold text-white">
                {meta.rounds}문제 플레이
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <SectionTitle sub="틀린 문제는 해설과 함께 오답노트로">캐시 적립 규칙</SectionTitle>
        <ul className="mt-3 space-y-1.5 text-[12px] text-slate-600">
          <li className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
            <span>🐛 버그 찾기</span>
            <span className="font-bold">정답당 2원 · 콤보 보너스 · 만점 3원</span>
          </li>
          <li className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
            <span>🧩 블록 순서</span>
            <span className="font-bold">정답당 3원 · 만점 2원</span>
          </li>
          <li className="flex justify-between rounded-xl bg-slate-50 px-3 py-2">
            <span>⚡ 스피드 퀴즈</span>
            <span className="font-bold">정답당 1원 · 5초 이내 +1원 · 만점 2원</span>
          </li>
        </ul>
      </Card>

      {sessions.length ? (
        <Card>
          <SectionTitle sub="최근 플레이">나의 코딩 게임 기록</SectionTitle>
          <ul className="mt-3 space-y-1.5">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                <span>{CODING_GAME_META[s.game].icon}</span>
                <span className="flex-1 font-semibold text-slate-600">{CODING_GAME_META[s.game].label}</span>
                <span className="text-slate-500">
                  {s.score}/{s.total}
                </span>
                <span className="font-bold text-amber-700">+{s.cash_earned}원</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/* --------------------------------- 게임 진행 -------------------------------- */

interface Reward {
  raw: number;
  earned: number;
  rows: { label: string; value: number }[];
  capped: boolean;
}

function GameRunner({
  game,
  student,
  onPick,
  onExit,
  onShop,
}: {
  game: CodingGameKey;
  student: Student;
  onPick: (g: CodingGameKey) => void;
  onExit: () => void;
  onShop: () => void;
}) {
  const store = useVocaStore();
  const meta = CODING_GAME_META[game];
  const problems = useMemo(() => buildGameProblems(game, student.coding_level), [game, student.coding_level]);

  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [fastCount, setFastCount] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [picked, setPicked] = useState<number | null>(null); // 버그 줄 / 스피드 선택지
  const [orderPicked, setOrderPicked] = useState<number[]>([]);
  const [orderResult, setOrderResult] = useState<boolean | null>(null);
  const [reward, setReward] = useState<Reward | null>(null);
  const [deadline, setDeadline] = useState(() => Date.now() + SPEED_LIMIT_MS);
  const [now, setNow] = useState(() => Date.now());

  const problem = problems[index];
  const isLast = index + 1 >= problems.length;
  const limit = store.cashDailyLimit();
  const finished = reward !== null;

  /* 스피드 퀴즈 타이머 */
  useEffect(() => {
    if (game !== 'speed' || finished || picked !== null) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [game, finished, picked, index]);

  useEffect(() => {
    if (game !== 'speed') return;
    setDeadline(Date.now() + SPEED_LIMIT_MS);
    setNow(Date.now());
  }, [game, index]);

  const answerProblem = useCallback(
    (correct: boolean, opts?: { fast?: boolean }) => {
      if (!problem) return;
      if (correct) {
        setScore((s) => s + 1);
        setCombo((c) => {
          const next = c + 1;
          setMaxCombo((m) => Math.max(m, next));
          return next;
        });
        if (opts?.fast) setFastCount((n) => n + 1);
        sfx.match(combo + 1);
      } else {
        setCombo(0);
        setWrongIds((prev) => (prev.includes(problem.id) ? prev : [...prev, problem.id]));
        sfx.miss();
      }
      store.recordCodingAnswer(student, problem, correct, 'game');
    },
    [problem, combo, store, student]
  );

  const finish = useCallback(
    (finalScore: number, finalMaxCombo: number, finalFast: number) => {
      const total = problems.length;
      const rows: { label: string; value: number }[] = [];
      if (game === 'bug') {
        rows.push({ label: `정답 ${finalScore} × 2원`, value: finalScore * 2 });
        rows.push({ label: '콤보 보너스', value: finalMaxCombo >= 4 ? 2 : finalMaxCombo >= 2 ? 1 : 0 });
        rows.push({ label: '만점 보너스', value: finalScore === total ? 3 : 0 });
      } else if (game === 'order') {
        rows.push({ label: `정답 ${finalScore} × 3원`, value: finalScore * 3 });
        rows.push({ label: '만점 보너스', value: finalScore === total ? 2 : 0 });
      } else {
        rows.push({ label: `정답 ${finalScore} × 1원`, value: finalScore });
        rows.push({ label: '빠른 정답 보너스', value: finalFast });
        rows.push({ label: '만점 보너스', value: finalScore === total ? 2 : 0 });
      }
      const raw = rows.reduce((sum, r) => sum + r.value, 0);
      const earned = store.grantCash(student.id, raw);
      store.recordCodingSession(student.id, {
        game,
        score: finalScore,
        total,
        cashEarned: earned,
        wrongProblemIds: wrongIds,
      });
      setReward({ raw, earned, rows, capped: earned < raw });
    },
    [game, problems.length, store, student, wrongIds]
  );

  const advance = useCallback(() => {
    if (isLast) {
      finish(score, maxCombo, fastCount);
      return;
    }
    setIndex((i) => i + 1);
    setPicked(null);
    setOrderPicked([]);
    setOrderResult(null);
  }, [finish, fastCount, isLast, maxCombo, score]);

  /* 스피드 퀴즈: 시간이 다 되면 오답 처리 후 자동으로 다음 문제 */
  useEffect(() => {
    if (game !== 'speed' || finished || picked !== null) return;
    if (now >= deadline) {
      setPicked(-1);
      answerProblem(false);
    }
  }, [now, deadline, game, finished, picked, answerProblem]);

  useEffect(() => {
    if (game !== 'speed' || picked === null) return;
    const t = window.setTimeout(() => advance(), 1300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, game]);

  if (!problem) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-slate-500">이 게임에 쓸 문제가 아직 없어요.</p>
      </Card>
    );
  }

  const remainDaily = Math.max(0, limit - store.todayCashEarned(student.id));

  /* ------------------------------- 결과 화면 ------------------------------- */
  if (reward) {
    return (
      <Card className="border-brand-100 bg-gradient-to-br from-brand-50 via-white to-amber-50" data-testid="coding-game-summary">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-extrabold text-slate-900">
              {meta.icon} {meta.label} 끝! 🎉
            </p>
            <p className="mt-1 text-xs font-semibold text-slate-500" data-testid="coding-game-score">
              {score} / {problems.length} 정답 · 콤보 최대 {maxCombo}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold text-slate-400">이번 판 적립</p>
            <p className="text-2xl font-extrabold text-brand-700" data-testid="coding-game-reward">
              +{reward.earned}원
            </p>
          </div>
        </div>

        <ul className="mt-3 space-y-1 rounded-2xl bg-white/70 p-3 text-xs text-slate-600">
          {reward.rows.map((row) => (
            <li key={row.label} className="flex items-center justify-between">
              <span>{row.label}</span>
              <span className={cn('font-bold', row.value ? 'text-slate-800' : 'text-slate-300')}>
                {row.value ? `+${row.value}원` : '—'}
              </span>
            </li>
          ))}
          <li className="flex items-center justify-between border-t border-slate-100 pt-1.5 font-bold text-slate-800">
            <span>합계</span>
            <span>+{reward.raw}원</span>
          </li>
        </ul>

        {reward.capped ? (
          <p className="mt-2 rounded-xl bg-amber-100/70 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
            오늘 적립 상한({limit}원)에 닿아서 {reward.earned}원만 적립했어요. 남은 판은 연습 모드로 기록됩니다.
          </p>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" data-testid="coding-game-restart" onClick={() => onPick(game)}>
            한 판 더
          </Button>
          <Button variant="sun" className="flex-1" data-testid="coding-game-other" onClick={onExit}>
            다른 게임 고르기
          </Button>
          <Button variant="ghost" className="flex-1" onClick={onShop}>
            상점 가기
          </Button>
        </div>
      </Card>
    );
  }

  /* -------------------------------- 진행 화면 ------------------------------- */
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={onExit} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
          ← 다른 게임
        </button>
        <span className="text-xs font-bold text-slate-500" data-testid="coding-game-progress">
          {meta.icon} {meta.label} · {index + 1} / {problems.length} · 콤보 {combo}
        </span>
      </div>
      <Bar ratio={(index + (picked !== null || orderResult !== null ? 1 : 0)) / problems.length} />

      <Card>
        <div className="flex items-center gap-1.5">
          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-bold', CODING_LEVEL_META[problem.level].badge)}>
            {problem.level}
          </span>
          <span className="text-[10px] font-semibold text-slate-400">{problem.topic}</span>
          {game === 'speed' ? (
            <span className="ml-auto rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-bold text-white" data-testid="coding-speed-timer">
              ⏱ {Math.max(0, Math.ceil((deadline - now) / 1000))}초
            </span>
          ) : null}
        </div>

        <p className="mt-2 text-[15px] font-bold leading-snug text-slate-900">{problem.prompt}</p>

        {game === 'bug' ? (
          <BugBoard problem={problem} picked={picked} onPick={(i) => {
            if (picked !== null) return;
            const correct = i === problem.answerLine;
            setPicked(i);
            answerProblem(correct);
          }} />
        ) : null}

        {game === 'order' ? (
          <OrderBoard
            problem={problem}
            picked={orderPicked}
            result={orderResult}
            onTap={(correctIndex) => {
              if (orderResult !== null) return;
              if (orderPicked.includes(correctIndex)) return;
              const next = [...orderPicked, correctIndex];
              setOrderPicked(next);
              if (next.length === (problem.blocks?.length ?? 0)) {
                const ok = next.every((v, i) => v === i);
                setOrderResult(ok);
                answerProblem(ok);
              }
            }}
            onReset={() => {
              setOrderPicked([]);
              setOrderResult(null);
            }}
          />
        ) : null}

        {game === 'speed' ? (
          <SpeedBoard problem={problem} picked={picked} onPick={(i, correct) => {
            if (picked !== null) return;
            setPicked(i);
            answerProblem(correct, { fast: Date.now() - (deadline - SPEED_LIMIT_MS) <= FAST_BONUS_MS });
          }} />
        ) : null}

        {picked !== null || orderResult !== null ? (
          <div className="mt-3" data-testid="coding-game-feedback">
            <p className={cn('text-sm font-bold', answerLooksRight(game, problem, picked, orderResult) ? 'text-emerald-600' : 'text-rose-500')}>
              {answerLooksRight(game, problem, picked, orderResult) ? '정답이에요! 🎯' : picked === -1 ? '시간 초과! ⏰' : '아쉬워요. 해설을 읽어 봐요.'}
            </p>
            <p className="mt-1 rounded-xl bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-slate-600">
              {problem.explanation}
            </p>
            {game !== 'speed' ? (
              <Button className="mt-3 w-full" data-testid="coding-game-next" onClick={advance}>
                {isLast ? '결과 보기' : '다음 문제'}
              </Button>
            ) : (
              <p className="mt-2 text-center text-[11px] text-slate-400">다음 문제로 넘어갑니다…</p>
            )}
          </div>
        ) : null}
      </Card>

      <p className="text-center text-[11px] text-slate-400">
        오늘 {store.todayCashEarned(student.id)} / {limit}원 적립 · 남은 {remainDaily}원
      </p>
    </div>
  );
}

function answerLooksRight(
  game: CodingGameKey,
  problem: CodingProblem,
  picked: number | null,
  orderResult: boolean | null
): boolean {
  if (game === 'order') return orderResult === true;
  if (game === 'bug') return picked !== null && picked === problem.answerLine;
  if (picked === null) return false;
  const answerText = problem.choices?.[problem.answer ?? 0];
  return pickText(problem, picked) === answerText;
}

/** 섞인 선택지의 텍스트 (화면에 보이는 순서 기준) */
const speedOptionCache = new WeakMap<CodingProblem, { choices: string[]; answer: number }>();

function speedOptions(problem: CodingProblem) {
  let cached = speedOptionCache.get(problem);
  if (!cached) {
    cached = shuffleChoices(problem);
    speedOptionCache.set(problem, cached);
  }
  return cached;
}

function pickText(problem: CodingProblem, index: number): string {
  return speedOptions(problem).choices[index] ?? '';
}

/* ------------------------------- 게임 별 보드 ------------------------------- */

function BugBoard({ problem, picked, onPick }: { problem: CodingProblem; picked: number | null; onPick: (i: number) => void }) {
  const lines = problem.lines ?? [];
  return (
    <div className="mt-2 overflow-hidden rounded-xl bg-slate-900 py-1.5">
      {lines.map((line, i) => {
        const isBug = i === problem.answerLine;
        const state = picked === null ? 'idle' : isBug ? 'right' : picked === i ? 'wrong' : 'dim';
        return (
          <button
            key={i}
            data-testid={`coding-bug-line-${i}`}
            data-correct={isBug ? '1' : '0'}
            onClick={() => onPick(i)}
            disabled={picked !== null}
            className={cn(
              'flex w-full items-start gap-2 border-l-2 border-transparent px-3 py-1 text-left font-mono text-[12px] leading-snug transition',
              state === 'idle' && 'text-slate-100 hover:bg-white/10',
              state === 'right' && 'border-emerald-300 bg-emerald-500 font-semibold text-white',
              state === 'wrong' && 'border-rose-300 bg-rose-500 font-semibold text-white',
              state === 'dim' && 'text-slate-500'
            )}
          >
            <span className="w-3 shrink-0 select-none text-right text-slate-500">{i + 1}</span>
            <span className="whitespace-pre">{line}</span>
          </button>
        );
      })}
    </div>
  );
}

function OrderBoard({
  problem,
  picked,
  result,
  onTap,
  onReset,
}: {
  problem: CodingProblem;
  picked: number[];
  result: boolean | null;
  onTap: (correctIndex: number) => void;
  onReset: () => void;
}) {
  const blocks = problem.blocks ?? [];
  const shuffled = useMemo(() => shuffle(blocks.map((text, i) => ({ text, correctIndex: i }))), [problem.id]);

  return (
    <div className="mt-2">
      <div className="rounded-xl bg-slate-50 p-2">
        <p className="px-1 text-[10px] font-bold text-slate-500">내 순서 ({picked.length}/{blocks.length})</p>
        <div className="mt-1 space-y-1">
          {picked.length === 0 ? <p className="px-1 py-2 text-[12px] text-slate-400">아래 블록을 실행 순서대로 탭하세요.</p> : null}
          {picked.map((correctIndex, i) => (
            <div key={`${correctIndex}-${i}`} className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-[12px] font-semibold text-slate-700 ring-1 ring-slate-200">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-slate-900 text-[9px] font-bold text-white">{i + 1}</span>
              <span className="flex-1">{blocks[correctIndex]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        {shuffled.map((b, displayIndex) => {
          const used = picked.includes(b.correctIndex);
          const correctPlace = picked.indexOf(b.correctIndex) === b.correctIndex;
          return (
            <button
              key={`${b.correctIndex}-${displayIndex}`}
              data-testid={`coding-block-${displayIndex}`}
              data-order={b.correctIndex}
              onClick={() => onTap(b.correctIndex)}
              disabled={used || result !== null}
              className={cn(
                'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] font-semibold transition',
                !used && 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
                used && 'bg-slate-100 text-slate-400',
                result !== null && used && correctPlace && 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                result !== null && used && !correctPlace && 'bg-rose-50 text-rose-600 ring-1 ring-rose-200'
              )}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-slate-900 text-[10px] font-bold text-white">
                {b.correctIndex + 1}
              </span>
              <span className="flex-1">{b.text}</span>
            </button>
          );
        })}
      </div>

      {picked.length > 0 && result === null ? (
        <button onClick={onReset} className="mt-2 text-[11px] font-semibold text-slate-400 hover:text-slate-600">
          다시 고르기
        </button>
      ) : null}

      {result !== null ? (
        <div className="mt-2 rounded-xl bg-white p-2 ring-1 ring-slate-200">
          <p className="text-[11px] font-bold text-slate-500">정답 순서</p>
          <ol className="mt-1 space-y-0.5">
            {blocks.map((text, i) => (
              <li key={i} className="text-[12px] text-slate-700">
                {i + 1}. {text}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function SpeedBoard({
  problem,
  picked,
  onPick,
}: {
  problem: CodingProblem;
  picked: number | null;
  onPick: (displayIndex: number, correct: boolean) => void;
}) {
  const opts = speedOptions(problem);
  return (
    <>
      <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 px-3 py-2.5 text-[12px] leading-relaxed text-slate-100 thin-scroll">
        <code>{problem.code}</code>
      </pre>
      <div className="mt-3 space-y-2">
        {opts.choices.map((choice, i) => {
          const isAnswer = i === opts.answer;
          const state = picked === null ? 'idle' : isAnswer ? 'right' : picked === i ? 'wrong' : 'dim';
          return (
            <button
              key={i}
              data-testid={`coding-speed-option-${i}`}
              data-correct={isAnswer ? '1' : '0'}
              onClick={() => onPick(i, isAnswer)}
              disabled={picked !== null}
              className={cn(
                'flex w-full items-start gap-2 rounded-2xl px-3.5 py-3 text-left text-[13px] font-semibold transition',
                state === 'idle' && 'bg-slate-50 text-slate-700 ring-1 ring-slate-200 hover:bg-white',
                state === 'right' && 'bg-emerald-50 text-emerald-800 ring-2 ring-emerald-300',
                state === 'wrong' && 'bg-rose-50 text-rose-700 ring-2 ring-rose-300',
                state === 'dim' && 'bg-slate-50 text-slate-400 ring-1 ring-slate-100'
              )}
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/80 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
                {i + 1}
              </span>
              <span className="whitespace-pre-line">{choice}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

/** 게임 찾아가기용 (영어 게임 페이지에서 쓰지 않지만 타입 참고) */
export const CODING_GAME_KEYS = GAMES;
