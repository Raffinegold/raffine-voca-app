import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession, useVocaStore } from '../app-context';
import StudentNav from '../components/StudentNav';
import { Badge, Bar, Button, Card, LevelPill } from '../components/ui';
import { isSoundMuted, setSoundMuted, sfx } from '../lib/sound';
import { cn, shuffle } from '../lib/util';
import type { Level, Word } from '../types';
import { LEVEL_META } from '../types';

type Face = 'en' | 'ko';

interface Cell {
  key: string;
  pairId: string;
  face: Face;
  wordId: string;
}

interface Reward {
  raw: number;
  earned: number;
  rows: { label: string; value: number }[];
  capped: boolean;
}

const PAIR_OPTIONS: { pairs: number; label: string }[] = [
  { pairs: 6, label: '6쌍 · 12장' },
  { pairs: 8, label: '8쌍 · 16장' },
];

/** 단어 풀에서 pairs 만큼 뽑아 영단어/한글 뜻 카드를 섞어 만듭니다 */
function buildDeck(pool: Word[], pairs: number): Cell[] {
  const picked = shuffle(pool).slice(0, Math.min(pairs, pool.length));
  const cells: Cell[] = [];
  picked.forEach((w) => {
    cells.push({ key: `${w.id}-en`, pairId: w.id, face: 'en', wordId: w.id });
    cells.push({ key: `${w.id}-ko`, pairId: w.id, face: 'ko', wordId: w.id });
  });
  return shuffle(cells);
}

function defaultPairs(level: Level): number {
  return level >= 4 ? 8 : 6;
}

export default function GamePage() {
  const store = useVocaStore();
  const navigate = useNavigate();
  const { student } = useSession();

  const [pairs, setPairs] = useState<number>(() => (student ? defaultPairs(student.level) : 6));
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'playing' | 'done'>('playing');
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<string[]>([]);
  const [attempts, setAttempts] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [reward, setReward] = useState<Reward | null>(null);
  const [comboFlash, setComboFlash] = useState(0);
  const [muted, setMuted] = useState(() => isSoundMuted());

  const startRef = useRef<number | null>(null);
  const lockedRef = useRef(false);
  const finishedRef = useRef(false);

  const pool = useMemo(() => {
    if (!student) return [];
    const mine = store.wordsOfStudent(student);
    return mine.length >= 8 ? mine : store.wordsForLevel(student.level);
  }, [student, store, store.version]);

  const poolKey = `${pool.length}:${pool[0]?.id ?? ''}:${pool[pool.length - 1]?.id ?? ''}`;
  const deck = useMemo(() => buildDeck(pool, pairs), [poolKey, pairs, round]);

  const wordOf = useCallback((id: string) => pool.find((w) => w.id === id), [pool]);
  const limit = store.cashDailyLimit();
  const earnedToday = student ? store.todayCashEarned(student.id) : 0;
  const remaining = Math.max(0, limit - earnedToday);

  /* 카드 두 장이 모두 뒤집히면 짝 판정 — 판정 중에는 다른 카드를 막습니다 */
  const flip = (index: number) => {
    if (!student || phase !== 'playing' || lockedRef.current) return;
    const cell = deck[index];
    if (!cell || matched.includes(cell.pairId) || flipped.includes(index)) return;
    if (flipped.length >= 2) return;

    if (!startRef.current) startRef.current = Date.now();
    sfx.flip();
    const next = [...flipped, index];
    setFlipped(next);
    if (next.length < 2) return;

    const [a, b] = next.map((i) => deck[i]);
    setAttempts((n) => n + 1);

    if (a && b && a.pairId === b.pairId) {
      const nextCombo = combo + 1;
      setCombo(nextCombo);
      setMaxCombo((m) => Math.max(m, nextCombo));
      if (nextCombo >= 2) {
        setComboFlash(nextCombo);
        window.setTimeout(() => setComboFlash(0), 900);
      }
      sfx.match(nextCombo);
      window.setTimeout(() => {
        setMatched((m) => (m.includes(a.pairId) ? m : [...m, a.pairId]));
        setFlipped([]);
      }, 360);
    } else {
      lockedRef.current = true;
      setCombo(0);
      sfx.miss();
      setWrongIds((prev) => Array.from(new Set([...prev, a.wordId, b.wordId])));
      window.setTimeout(() => {
        setFlipped([]);
        lockedRef.current = false;
      }, 800);
    }
  };

  /* 타이머 */
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = window.setInterval(() => {
      if (startRef.current) setElapsed(Date.now() - startRef.current);
    }, 250);
    return () => window.clearInterval(id);
  }, [phase]);

  /* 클리어 판정 → 보상 계산 및 적립 (하루 상한 적용) */
  useEffect(() => {
    if (!student || phase !== 'playing' || finishedRef.current) return;
    if (!deck.length || matched.length < pairs) return;
    finishedRef.current = true;

    const durationMs = startRef.current ? Date.now() - startRef.current : 0;
    const base = pairs >= 8 ? 15 : 10;
    const perfect = attempts <= pairs ? 5 : 0;
    const comboBonus = maxCombo >= pairs ? 2 : maxCombo >= 3 ? 1 : 0;
    const speedBonus = durationMs > 0 && durationMs <= pairs * 7000 ? 3 : 0;
    const raw = base + perfect + comboBonus + speedBonus;
    const earned = store.grantCash(student.id, raw);
    store.recordGameSession(student.id, {
      pairs,
      attempts,
      durationMs,
      cashEarned: earned,
      wrongWordIds: wrongIds,
    });
    setElapsed(durationMs);
    setReward({
      raw,
      earned,
      capped: earned < raw,
      rows: [
        { label: pairs >= 8 ? '8쌍 클리어' : '6쌍 클리어', value: base },
        { label: '퍼펙트 보너스', value: perfect },
        { label: '콤보 보너스', value: comboBonus },
        { label: '스피드 보너스', value: speedBonus },
      ],
    });
    setPhase('done');
    sfx.win();
    window.setTimeout(() => sfx.reward(), 420);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched, attempts, phase, pairs, maxCombo]);

  const restart = (nextPairs = pairs) => {
    setPairs(nextPairs);
    setRound((r) => r + 1);
    setPhase('playing');
    setFlipped([]);
    setMatched([]);
    setAttempts(0);
    setCombo(0);
    setMaxCombo(0);
    setWrongIds([]);
    setElapsed(0);
    setReward(null);
    setComboFlash(0);
    startRef.current = null;
    lockedRef.current = false;
    finishedRef.current = false;
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setSoundMuted(next);
  };

  if (!student) return null;

  const total = pairs * 2;
  const cleared = matched.length;
  const wrongWords = wrongIds.map((id) => wordOf(id)).filter((w): w is Word => !!w);
  const columns = 4;

  return (
    <div className="min-h-screen pb-safe">
      <header className="sticky top-0 z-20 border-b border-white/60 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-brand-600 text-base text-white shadow-soft">🃏</span>
            <div>
              <p className="text-[11px] font-semibold text-slate-400">단어 짝맞추기</p>
              <p className="text-sm font-bold leading-tight text-slate-900">{student.name}의 게임</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700" data-testid="game-balance">
              💰 {store.cashBalance(student.id).toLocaleString()}원
            </span>
            <button
              data-testid="game-mute"
              onClick={toggleMute}
              aria-label={muted ? '소리 켜기' : '소리 끄기'}
              className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">
        {/* 오늘 적립 현황 */}
        <div className="rounded-3xl border border-white bg-white/90 p-4 shadow-soft">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold text-slate-800">오늘 적립</p>
              <span className="text-xs font-semibold text-slate-500" data-testid="game-daily-earned">
                {earnedToday} / {limit}원
              </span>
            </div>
            {remaining === 0 ? (
              <Badge tone="sun">연습 모드</Badge>
            ) : (
              <Badge tone="mint">오늘 {remaining}원 더 모을 수 있어요</Badge>
            )}
          </div>
          <div className="mt-2">
            <Bar ratio={limit > 0 ? earnedToday / limit : 1} tone={earningTone(earnedToday, limit)} />
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            하루 최대 {limit}원까지 쌓여요. 다 채운 뒤에도 연습으로 계속 플레이할 수 있어요.
          </p>
        </div>

        {/* 결과 요약 */}
        {reward ? (
          <Card className="mt-4 border-brand-100 bg-gradient-to-br from-brand-50 via-white to-amber-50" data-testid="game-summary">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-extrabold text-slate-900">짝맞추기 성공! 🎉</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {pairs}쌍 · 시도 {attempts}회 · 콤보 최대 {maxCombo} · {formatDuration(elapsed)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-semibold text-slate-400">이번 판 적립</p>
                <p className="text-2xl font-extrabold text-brand-700" data-testid="game-reward">
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

            {wrongWords.length ? (
              <div className="mt-3">
                <p className="text-xs font-bold text-slate-700">이번 판에서 헷갈린 단어</p>
                <ul className="mt-2 space-y-1.5" data-testid="game-wrong-list">
                  {wrongWords.map((w) => (
                    <li key={w.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm">
                      <span className="font-bold text-slate-900">{w.word}</span>
                      <span className="text-[11px] text-slate-400">{w.ipa}</span>
                      <span className="ml-auto text-xs text-slate-600">{w.meaning}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11px] text-slate-400">뜻을 다시 읽어 보고, 오답노트에서 한 번 더 만나요.</p>
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
                한 번도 틀리지 않았어요. 완벽해요! ✨
              </p>
            )}

            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button data-testid="game-restart" className="flex-1" onClick={() => restart()}>
                한 판 더
              </Button>
              <Button data-testid="game-shop-link" variant="sun" className="flex-1" onClick={() => navigate('/shop')}>
                상점에서 교환하기
              </Button>
            </div>
          </Card>
        ) : null}

        {/* 난이도 · 진행 정보 */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {PAIR_OPTIONS.map((opt) => (
            <button
              key={opt.pairs}
              data-testid={`game-pairs-${opt.pairs}`}
              onClick={() => restart(opt.pairs)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs font-bold transition',
                pairs === opt.pairs ? 'bg-brand-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'
              )}
            >
              {opt.label}
            </button>
          ))}
          <span className="flex-1" />
          <span className="text-xs font-semibold text-slate-500" data-testid="game-stats">
            ⏱ {formatDuration(elapsed)} · 시도 {attempts}회 · {cleared}/{pairs}쌍
          </span>
        </div>

        {/* 카드 판 */}
        <div className="relative mt-3">
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            data-testid="game-board"
          >
            {deck.map((cell, index) => {
              const word = wordOf(cell.wordId);
              const isMatched = matched.includes(cell.pairId);
              const isFlipped = flipped.includes(index) || isMatched;
              return (
                <button
                  key={cell.key}
                  data-testid={`game-card-${index}`}
                  data-pair={cell.pairId}
                  data-face={cell.face}
                  data-word={word?.word ?? ''}
                  aria-label={isFlipped ? (cell.face === 'en' ? word?.word : word?.meaning) : '뒤집히지 않은 카드'}
                  onClick={() => flip(index)}
                  disabled={isMatched || phase === 'done'}
                  className={cn(
                    'card-flip relative aspect-[4/5] w-full select-none rounded-2xl outline-none transition',
                    isMatched ? 'opacity-60' : 'active:scale-[0.97]'
                  )}
                >
                  <div className={cn('card-inner relative h-full w-full', isFlipped && 'flipped')}>
                    {/* 뒷면 */}
                    <div className="card-face absolute inset-0 grid place-items-center rounded-2xl bg-gradient-to-br from-brand-500 via-brand-600 to-indigo-700 text-white shadow-soft">
                      <span className="text-xl opacity-90">{cell.face === 'en' ? '🃏' : '🃏'}</span>
                    </div>
                    {/* 앞면 */}
                    <div
                      className={cn(
                        'card-face card-back absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-2xl px-1.5 text-center shadow-soft',
                        isMatched
                          ? 'bg-emerald-50 ring-2 ring-emerald-300'
                          : cell.face === 'en'
                            ? 'bg-white ring-1 ring-slate-200'
                            : 'bg-amber-50 ring-1 ring-amber-200'
                      )}
                    >
                      <span
                        className={cn(
                          'break-keep font-bold leading-tight',
                          cell.face === 'en' ? 'text-[13px] text-slate-900' : 'text-[12px] text-amber-900'
                        )}
                      >
                        {cell.face === 'en' ? word?.word : word?.meaning}
                      </span>
                      {isMatched ? <span className="text-[10px] font-bold text-emerald-600">✓</span> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {comboFlash >= 2 ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="animate-pop rounded-2xl bg-slate-900/85 px-4 py-2 text-lg font-extrabold text-white shadow-card">
                {comboFlash}콤보! 🔥
              </span>
            </div>
          ) : null}
        </div>

        <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
          영단어 카드와 한글 뜻 카드를 짝지어 뒤집어요. {LEVEL_META[student.level].grades} · Level {student.level} 단어에서{' '}
          {pairs}쌍이 나옵니다.
        </p>

        <div className="mt-3 flex items-center justify-center gap-2">
          <LevelPill level={student.level} />
          <span className="text-[11px] text-slate-400">틀린 단어는 결과 화면에서 뜻과 함께 다시 보여 줘요.</span>
        </div>
      </main>

      <StudentNav active="game" />
    </div>
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}분 ${String(s).padStart(2, '0')}초` : `${s}초`;
}

function earningTone(earned: number, limit: number): 'brand' | 'mint' | 'sun' {
  if (limit > 0 && earned >= limit) return 'sun';
  return earned > 0 ? 'mint' : 'brand';
}
