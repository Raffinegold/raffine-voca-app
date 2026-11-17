import { CODING_PROBLEMS, problemById, problemsOfKind } from '../data/codingSeed';
import type { CodingGameKey, CodingLevel, CodingProblem, Student } from '../types';
import { CODING_LEVELS } from '../types';
import { store } from './store';
import { mulberry32, shuffle, todayStr } from './util';

/** 오늘의 코딩 미션 — 오답 복습(최대 2) + 출력/빈칸 문제로 5문제 */
export const CODING_MISSION_SIZE = 5;

/** 오늘 미션에 쓸 수 있는 종류 (선택지가 있는 문제만) */
const MISSION_KINDS: CodingProblem['kind'][] = ['output', 'blank'];

export interface CodingMissionItem {
  problem: CodingProblem;
  kind: 'review' | 'new';
}

export interface CodingMission {
  items: CodingMissionItem[];
  reviewCount: number;
  target: number;
  level: CodingLevel;
}

function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function levelDistance(a: CodingLevel, b: CodingLevel): number {
  return Math.abs(CODING_LEVELS.indexOf(a) - CODING_LEVELS.indexOf(b));
}

/** 학생 레벨 → 가까운 레벨 순서 (같은 레벨 문제가 모자랄 때 채웁니다) */
function levelsByProximity(level: CodingLevel): CodingLevel[] {
  return [...CODING_LEVELS].sort((a, b) => levelDistance(level, a) - levelDistance(level, b));
}

/** 레벨별 문제를 가까운 레벨 순서로 모아 최대 count 개 (중복 없이) */
function collect(kind: CodingProblem['kind'], level: CodingLevel, count: number): CodingProblem[] {
  const out: CodingProblem[] = [];
  for (const lv of levelsByProximity(level)) {
    for (const p of shuffle(problemsOfKind(lv, kind))) {
      if (out.length >= count) break;
      if (!out.some((x) => x.id === p.id)) out.push(p);
    }
    if (out.length >= count) break;
  }
  return out;
}

/** 하루 한 번, 학생·날짜로 고정되는 오늘의 코딩 미션 (새로고침해도 같은 문제) */
export function buildCodingMission(student: Student, date = todayStr()): CodingMission {
  const level = student.coding_level ?? 'C1';
  const rand = mulberry32(hashSeed(`${student.id}:${date}:coding`));

  const wrongIds = store
    .codingWrongNotesFor(student.id)
    .filter((n) => problemById(n.problem_id)?.level === level)
    .map((n) => n.problem_id);
  const review = wrongIds
    .map((id) => problemById(id))
    .filter((p): p is CodingProblem => !!p && MISSION_KINDS.includes(p.kind))
    .slice(0, 2);

  const pools = [...shuffle(problemsOfKind(level, 'output'), rand), ...shuffle(problemsOfKind(level, 'blank'), rand)];
  const picked: CodingProblem[] = [...review];
  for (const p of pools) {
    if (picked.length >= CODING_MISSION_SIZE) break;
    if (picked.some((x) => x.id === p.id)) continue;
    picked.push(p);
  }
  // 출력·빈칸이 모자라면 다른 종류로 채웁니다 (C4처럼 문제 수가 적은 레벨 대비)
  if (picked.length < CODING_MISSION_SIZE) {
    for (const p of collect('output', level, CODING_MISSION_SIZE * 2)) {
      if (picked.length >= CODING_MISSION_SIZE) break;
      if (picked.some((x) => x.id === p.id)) continue;
      picked.push(p);
    }
  }

  const items: CodingMissionItem[] = picked.map((p) => ({
    problem: p,
    kind: review.some((r) => r.id === p.id) ? 'review' : 'new',
  }));

  return { items, reviewCount: review.length, target: items.length, level };
}

/** 오답노트 복습 — 틀린 문제만 모아 미션으로 */
export function buildCodingReview(student: Student, limit = 5): CodingMission {
  const notes = store.codingWrongNotesFor(student.id).slice(0, limit);
  const items: CodingMissionItem[] = notes
    .map((n) => problemById(n.problem_id))
    .filter((p): p is CodingProblem => !!p && MISSION_KINDS.includes(p.kind))
    .map((p) => ({ problem: p, kind: 'review' as const }));
  return { items, reviewCount: items.length, target: items.length, level: student.coding_level ?? 'C1' };
}

/** 선택지를 섞고 정답 위치를 다시 계산합니다 (정답은 항상 화면마다 달라짐) */
export function shuffleChoices(problem: CodingProblem): { choices: string[]; answer: number } {
  const choices = problem.choices ?? [];
  const answerText = choices[problem.answer ?? 0];
  const mixed = shuffle(choices);
  return { choices: mixed, answer: Math.max(0, mixed.indexOf(answerText)) };
}

export const CODING_GAME_META: Record<CodingGameKey, { label: string; icon: string; desc: string; rounds: number }> = {
  bug: {
    label: '버그 찾기',
    icon: '🐛',
    desc: '4~6줄 코드에서 잘못된 1줄을 찾아 터치',
    rounds: 5,
  },
  order: {
    label: '블록 순서 맞추기',
    icon: '🧩',
    desc: '뒤섞인 블록 4~5개를 실행 순서대로 조립',
    rounds: 4,
  },
  speed: {
    label: '출력 스피드 퀴즈',
    icon: '⚡',
    desc: '제한시간 12초 안에 코드의 실행 결과 맞히기',
    rounds: 6,
  },
};

/** 게임 한 판에 쓸 문제 목록 */
export function buildGameProblems(game: CodingGameKey, level: CodingLevel): CodingProblem[] {
  const rounds = CODING_GAME_META[game].rounds;
  if (game === 'bug') return collect('bug', level, rounds);
  if (game === 'order') return collect('order', level, rounds);
  return collect('output', level, rounds);
}

export function allCodingProblems(): CodingProblem[] {
  return CODING_PROBLEMS;
}
