export type Level = 1 | 2 | 3 | 4 | 5;

export interface Student {
  id: string;
  name: string;
  class_name: string;
  grade: number;
  level: Level;
  tosel_level: string;
  pin: string;
  nickname: string;
  parent_token: string;
  active: boolean;
  created_at: string;
  last_seen_at?: string | null;
}

export interface WordSet {
  id: string;
  name: string;
  level: Level;
  day_index: number;
  active: boolean;
  created_at?: string;
}

export interface Word {
  id: string;
  set_id: string;
  word: string;
  meaning: string;
  pos: string;
  ipa?: string;
  example: string;
  example_ko: string;
  order_no: number;
}

export interface Assignment {
  id: string;
  student_id: string;
  set_id: string;
  assigned_on: string;
}

export type StudyMode = 'card' | 'choice' | 'spell';

export interface StudyLog {
  id: string;
  student_id: string;
  word_id: string;
  set_id: string;
  is_correct: boolean;
  mode: StudyMode;
  elapsed_ms: number;
  answered_at: string;
}

export interface WrongNote {
  id: string;
  student_id: string;
  word_id: string;
  box: number;
  due_date: string;
  miss_count: number;
  cleared_at: string | null;
}

export interface WeeklyReport {
  id: string;
  student_id: string;
  week_start: string;
  words_done: number;
  accuracy: number;
  streak_days: number;
  message: string;
  opened_at: string | null;
}

export interface DailyProgress {
  student_id: string;
  date: string;
  target: number;
  answered: number;
}

export interface LevelHistory {
  id: string;
  student_id: string;
  from_level: Level | null;
  to_level: Level;
  tosel_level: string;
  changed_at: string;
}

export type ToselLevel = 'Pre-Starter' | 'Starter' | 'Basic' | 'Junior' | 'High Junior';

export const LEVEL_META: Record<Level, { label: string; grades: string; tosel: ToselLevel; dailyNew: number; dailyReview: number; cumulative: number; quiz: string }> = {
  1: { label: 'Level 1', grades: '초1~2', tosel: 'Pre-Starter', dailyNew: 8, dailyReview: 4, cumulative: 300, quiz: '뜻 4지선다 → 알파벳 타일' },
  2: { label: 'Level 2', grades: '초3~4', tosel: 'Starter', dailyNew: 10, dailyReview: 5, cumulative: 600, quiz: '뜻→단어 4지선다, 철자 빈칸' },
  3: { label: 'Level 3', grades: '초5~6', tosel: 'Basic', dailyNew: 12, dailyReview: 6, cumulative: 1000, quiz: '4지선다 + 직접 입력(오타 1자 허용)' },
  4: { label: 'Level 4', grades: '중1~3', tosel: 'Junior', dailyNew: 15, dailyReview: 7, cumulative: 1800, quiz: '예문 빈칸, 4지선다' },
  5: { label: 'Level 5', grades: '고1~2', tosel: 'High Junior', dailyNew: 20, dailyReview: 10, cumulative: 3000, quiz: '문맥 빈칸, 유의어 고르기' },
};

export const TOSEL_TO_LEVEL: Record<ToselLevel, Level> = {
  'Pre-Starter': 1,
  Starter: 2,
  Basic: 3,
  Junior: 4,
  'High Junior': 5,
};

export const LEVEL_TO_TOSEL: Record<Level, ToselLevel> = {
  1: 'Pre-Starter',
  2: 'Starter',
  3: 'Basic',
  4: 'Junior',
  5: 'High Junior',
};

export interface Session {
  role: 'student' | 'admin';
  studentId?: string;
  name?: string;
}
