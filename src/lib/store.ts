import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Assignment,
  DailyProgress,
  Level,
  LevelHistory,
  Student,
  StudyLog,
  StudyMode,
  WeeklyReport,
  Word,
  WordSet,
  WrongNote,
} from '../types';
import { LEVEL_META, LEVEL_TO_TOSEL } from '../types';
import { SEED_ADMIN_PIN, SEED_STUDENTS, SEED_WORD_SETS, SEED_WORDS } from '../data/seed';
import { addDays, hashPin, mulberry32, randomPin, randomToken, todayStr, uid, verifyPin } from './util';

const LS_KEY = 'rafine-voca-db-v1';

interface DB {
  students: Student[];
  sets: WordSet[];
  words: Word[];
  assignments: Assignment[];
  logs: StudyLog[];
  wrong_notes: WrongNote[];
  progress: DailyProgress[];
  reports: WeeklyReport[];
  history: LevelHistory[];
}

const emptyDB = (): DB => ({
  students: [],
  sets: [],
  words: [],
  assignments: [],
  logs: [],
  wrong_notes: [],
  progress: [],
  reports: [],
  history: [],
});

export type StoreMode = 'local' | 'supabase';

export interface CsvRow {
  word: string;
  meaning: string;
  pos?: string;
  example?: string;
  example_ko?: string;
  order_no?: number;
}

export interface NewStudentInput {
  name: string;
  grade: number;
  class_name: string;
  nickname?: string;
  level?: Level;
}

/**
 * 앱의 단일 데이터 레이어.
 * - VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 있으면 Supabase 모드 (실시간 DB)
 * - 없으면 LocalStorage 데모 모드 (샘플 학생 5명 + 100단어 시드, 즉시 시연 가능)
 * 화면 코드는 모드를 신경 쓰지 않고 같은 메서드를 사용한다.
 */
class VocaStore {
  mode: StoreMode = 'local';
  version = 0;
  students: Student[] = [];
  sets: WordSet[] = [];
  words: Word[] = [];
  assignments: Assignment[] = [];
  logs: StudyLog[] = [];
  wrongNotes: WrongNote[] = [];
  progress: DailyProgress[] = [];
  reports: WeeklyReport[] = [];
  history: LevelHistory[] = [];
  ready: Promise<void>;
  adminEmail: string | null = null;
  studentToken: string | null = null;

  private client: SupabaseClient | null = null;
  private listeners = new Set<() => void>();
  private persistTimer: number | null = null;
  private cloudWarnings = 0;

  constructor() {
    this.ready = this.init();
  }

  /* ---------------------------------- 초기화 --------------------------------- */

  private async init() {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

    if (url && key) {
      try {
        this.client = createClient(url, key, { auth: { persistSession: true } });
        this.mode = 'supabase';
        const session = await this.client.auth.getSession();
        this.adminEmail = session.data.session?.user?.email ?? null;
        await this.loadCloud();
        this.watchCloud();
        this.emit();
        return;
      } catch (err) {
        console.warn('[voca] Supabase 연결 실패 → 로컬 데모 모드로 전환', err);
        this.client = null;
        this.mode = 'local';
      }
    }

    this.loadLocal();
    if (this.students.length === 0) {
      this.seedLocal();
    }
    this.emit();
  }

  private loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const db = JSON.parse(raw) as DB;
      this.students = db.students ?? [];
      this.sets = db.sets ?? [];
      this.words = db.words ?? [];
      this.assignments = db.assignments ?? [];
      this.logs = db.logs ?? [];
      this.wrongNotes = db.wrong_notes ?? [];
      this.progress = db.progress ?? [];
      this.reports = db.reports ?? [];
      this.history = db.history ?? [];
    } catch (err) {
      console.warn('[voca] 로컬 저장소 읽기 실패, 새로 시작합니다', err);
    }
  }

  private persistLocal() {
    if (this.mode !== 'local') return;
    if (this.persistTimer) window.clearTimeout(this.persistTimer);
    this.persistTimer = window.setTimeout(() => {
      const db: DB = {
        students: this.students,
        sets: this.sets,
        words: this.words,
        assignments: this.assignments,
        logs: this.logs,
        wrong_notes: this.wrongNotes,
        progress: this.progress,
        reports: this.reports,
        history: this.history,
      };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(db));
      } catch (err) {
        console.warn('[voca] 로컬 저장 실패', err);
      }
    }, 120);
  }

  /** 데모 시드: 학생 5명 + 100단어 + 지난 10일 학습 기록 */
  private seedLocal() {
    const now = new Date();
    const students: Student[] = SEED_STUDENTS.map((s) => ({
      ...s,
      pin: hashPin(s.id, s.pin),
    }));
    const sets = SEED_WORD_SETS.map((s) => ({ ...s }));
    const words = SEED_WORDS.map((w) => ({ ...w }));
    const assignments: Assignment[] = [];
    for (const st of students) {
      for (const set of sets.filter((s) => s.level === st.level && s.active)) {
        assignments.push({
          id: uid('asg'),
          student_id: st.id,
          set_id: set.id,
          assigned_on: addDays(todayStr(), -12),
        });
      }
    }

    const rand = mulberry32(20261117);
    const logs: StudyLog[] = [];
    const wrong: WrongNote[] = [];
    const progress: DailyProgress[] = [];
    const accuracyBase: Record<string, number> = {
      'stu-seoyeon': 0.92,
      'stu-junwoo': 0.86,
      'stu-haeun': 0.78,
      'stu-minjun': 0.9,
      'stu-yujin': 0.74,
    };

    const today = todayStr();
    for (let back = 10; back >= 1; back--) {
      const date = addDays(today, -back);
      for (const st of students) {
        // 김서연은 5일 연속, 유진이는 중간에 하루 쉼
        if (st.id === 'stu-yujin' && back === 3) continue;
        if (st.id === 'stu-haeun' && back === 8) continue;

        const levelWords = words.filter((w) => this.levelOfSet(sets, w.set_id) === st.level);
        if (!levelWords.length) continue;
        const dailyNew = Math.min(LEVEL_META[st.level].dailyNew, levelWords.length);
        const start = ((11 - back) * dailyNew) % levelWords.length;
        const dayWords: Word[] = [];
        for (let i = 0; i < dailyNew; i++) dayWords.push(levelWords[(start + i) % levelWords.length]);

        const accuracy = accuracyBase[st.id] ?? 0.8;
        let answered = 0;
        dayWords.forEach((w, i) => {
          const firstCorrect = rand() < accuracy;
          const at = new Date(`${date}T17:${String(10 + Math.floor(i * 1.4)).padStart(2, '0')}:00+09:00`);
          answered++;
          logs.push({
            id: uid('log'),
            student_id: st.id,
            word_id: w.id,
            set_id: w.set_id,
            is_correct: firstCorrect,
            mode: rand() < 0.55 ? 'choice' : 'spell',
            elapsed_ms: 4200 + Math.floor(rand() * 5200),
            answered_at: at.toISOString(),
          });
          if (!firstCorrect) {
            const again = new Date(at.getTime() + 25000);
            logs.push({
              id: uid('log'),
              student_id: st.id,
              word_id: w.id,
              set_id: w.set_id,
              is_correct: true,
              mode: 'choice',
              elapsed_ms: 3000 + Math.floor(rand() * 3000),
              answered_at: again.toISOString(),
            });
            const existing = wrong.find((n) => n.student_id === st.id && n.word_id === w.id);
            if (existing) {
              existing.miss_count += 1;
              existing.box = Math.max(0, existing.box - 1);
              existing.due_date = addDays(today, -1);
            } else {
              wrong.push({
                id: uid('wn'),
                student_id: st.id,
                word_id: w.id,
                box: rand() < 0.4 ? 0 : 1,
                due_date: rand() < 0.5 ? today : addDays(today, 1 + Math.floor(rand() * 3)),
                miss_count: 1 + Math.floor(rand() * 2),
                cleared_at: null,
              });
            }
          }
        });
        progress.push({ student_id: st.id, date, target: dailyNew, answered });
      }
    }

    // 오늘 접속 기록 (대시보드 접속 인원)
    students.forEach((st, i) => {
      if (i < 2) st.last_seen_at = new Date(`${today}T09:${20 + i * 7}:00+09:00`).toISOString();
      else if (i === 2) st.last_seen_at = new Date(`${addDays(today, -1)}T18:40:00+09:00`).toISOString();
      else st.last_seen_at = new Date(`${addDays(today, -3)}T17:10:00+09:00`).toISOString();
    });

    this.students = students;
    this.sets = sets;
    this.words = words;
    this.assignments = assignments;
    this.logs = logs;
    this.wrongNotes = wrong;
    this.progress = progress;
    this.reports = [];
    this.history = students.map((s) => ({
      id: uid('lh'),
      student_id: s.id,
      from_level: null,
      to_level: s.level,
      tosel_level: s.tosel_level,
      changed_at: s.created_at,
    }));
    this.persistLocal();
  }

  private levelOfSet(sets: WordSet[], setId: string): Level | null {
    return sets.find((s) => s.id === setId)?.level ?? null;
  }

  /* --------------------------------- 구독/알림 -------------------------------- */

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getVersion = () => this.version;

  private emit() {
    this.version += 1;
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (err) {
        console.warn(err);
      }
    });
  }

  private commit() {
    this.persistLocal();
    this.emit();
  }

  /* ---------------------------------- 학생 ---------------------------------- */

  listStudents(includeInactive = false): Student[] {
    return this.students
      .filter((s) => includeInactive || s.active)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  getStudent(id: string): Student | undefined {
    return this.students.find((s) => s.id === id);
  }

  verifyStudentPin(studentId: string, pin: string): boolean {
    if (this.mode === 'supabase') return false; // Supabase 모드에서는 Edge Function pin-login 사용
    const st = this.getStudent(studentId);
    if (!st) return false;
    return verifyPin(st.id, pin, st.pin);
  }

  async loginStudentCloud(name: string, pin: string): Promise<Student | null> {
    if (!this.client || this.mode !== 'supabase') return null;
    const { data, error } = await this.client.rpc('student_login', { p_name: name, p_pin: pin });
    if (error) {
      if (/PIN_MISMATCH|STUDENT_NOT_FOUND/.test(error.message)) return null;
      throw new Error(error.message);
    }
    const token = (data as any)?.token as string | undefined;
    const student = (data as any)?.student as Student | undefined;
    if (!token || !student) return null;
    this.studentToken = token;
    try {
      localStorage.setItem('rafine-voca-student-token', token);
    } catch {
      /* ignore */
    }
    await this.loadStudentBundle();
    return this.getStudent(student.id) ?? student;
  }

  /** 학생 세션 토큰으로 자기 데이터만 받아옵니다 (student_bundle RPC) */
  private async loadStudentBundle() {
    if (!this.client || !this.studentToken) return;
    const { data, error } = await this.client.rpc('student_bundle', { p_token: this.studentToken });
    if (error) {
      console.warn('[voca] student_bundle 실패', error);
      return;
    }
    const bundle = data as any;
    if (!bundle?.student) return;
    const student = bundle.student as Student;
    this.students = [student];
    this.sets = (bundle.sets ?? []) as WordSet[];
    this.words = (bundle.words ?? []) as Word[];
    this.assignments = [];
    this.wrongNotes = ((bundle.wrong_notes ?? []) as any[]).map((n) => ({ ...n, id: String(n.id) }));
    this.logs = ((bundle.logs ?? []) as any[]).map((l) => ({ ...l, id: String(l.id) }));
    this.progress = ((bundle.progress ?? []) as any[]).map((p) => ({
      student_id: student.id,
      date: p.date,
      target: Math.max(LEVEL_META[student.level].dailyNew, p.answered ?? 0),
      answered: p.answered ?? 0,
    }));
    this.emit();
  }

  async addStudent(input: NewStudentInput): Promise<{ student: Student; pin: string }> {
    const pin = randomPin();
    const level = input.level ?? 1;
    const newId = uid('stu');
    const student: Student = {
      id: newId,
      name: input.name.trim(),
      class_name: input.class_name.trim() || '미지정',
      grade: input.grade,
      level,
      tosel_level: LEVEL_TO_TOSEL[level],
      pin: hashPin(newId, pin),
      nickname: (input.nickname ?? input.name.trim()).slice(0, 12),
      parent_token: randomToken(32),
      active: true,
      created_at: new Date().toISOString(),
      last_seen_at: null,
    };

    if (this.mode === 'supabase' && this.client) {
      const { data, error } = await this.client.rpc('admin_create_student', {
        p_name: student.name,
        p_grade: student.grade,
        p_class_name: student.class_name,
        p_nickname: student.nickname,
        p_level: student.level,
        p_pin: pin,
      });
      if (error) throw new Error(error.message);
      const created = (data as any)?.student as Student | undefined;
      await this.loadCloud();
      const saved = created ? this.getStudent(created.id) ?? created : null;
      if (saved) return { student: saved, pin };
    }

    this.students = [...this.students, student];
    this.ensureAssignments(student);
    this.history = [
      ...this.history,
      {
        id: uid('lh'),
        student_id: student.id,
        from_level: null,
        to_level: level,
        tosel_level: student.tosel_level,
        changed_at: student.created_at,
      },
    ];
    this.commit();
    return { student, pin };
  }

  async resetPin(studentId: string): Promise<string> {
    const pin = randomPin();
    const st = this.getStudent(studentId);
    if (!st) throw new Error('학생을 찾을 수 없어요');
    if (this.mode === 'supabase' && this.client) {
      const { error } = await this.client.rpc('admin_reset_pin', { p_student_id: studentId, p_pin: pin });
      if (error) throw new Error(error.message);
      await this.loadCloud();
      return pin;
    }
    st.pin = hashPin(studentId, pin);
    this.commit();
    return pin;
  }

  setStudentActive(studentId: string, active: boolean) {
    const st = this.getStudent(studentId);
    if (!st) return;
    st.active = active;
    if (this.mode === 'supabase' && this.client) {
      this.cloud(`students update ${studentId}`, () =>
        this.client!.from('students').update({ active }).eq('id', studentId)
      );
    }
    this.commit();
  }

  setStudentLevel(studentId: string, level: Level) {
    const st = this.getStudent(studentId);
    if (!st) return;
    if (st.level === level) return;
    const prev = st.level;
    st.level = level;
    st.tosel_level = LEVEL_TO_TOSEL[level];
    this.history = [
      ...this.history,
      {
        id: uid('lh'),
        student_id: studentId,
        from_level: prev,
        to_level: level,
        tosel_level: st.tosel_level,
        changed_at: new Date().toISOString(),
      },
    ];
    this.ensureAssignments(st);
    if (this.mode === 'supabase' && this.client) {
      this.cloud(`students level ${studentId}`, () =>
        this.client!.from('students').update({ level, tosel_level: st.tosel_level }).eq('id', studentId)
      );
      this.cloud(`level history ${studentId}`, () =>
        this.client!.from('level_history').insert({
          student_id: studentId,
          from_level: prev,
          to_level: level,
          tosel_level: st.tosel_level,
        })
      );
    }
    this.commit();
  }

  listLevelHistory(studentId?: string): LevelHistory[] {
    return this.history
      .filter((h) => !studentId || h.student_id === studentId)
      .slice()
      .sort((a, b) => b.changed_at.localeCompare(a.changed_at));
  }

  private ensureAssignments(student: Student) {
    const today = todayStr();
    for (const set of this.sets.filter((s) => s.level === student.level && s.active)) {
      if (!this.assignments.some((a) => a.student_id === student.id && a.set_id === set.id)) {
        const asg: Assignment = {
          id: uid('asg'),
          student_id: student.id,
          set_id: set.id,
          assigned_on: today,
        };
        this.assignments = [...this.assignments, asg];
        if (this.mode === 'supabase' && this.client) {
          this.cloud(`assign ${student.id}/${set.id}`, () =>
            this.client!.from('assignments').insert({ student_id: student.id, set_id: set.id })
          );
        }
      }
    }
  }

  /* ---------------------------------- 단어장 --------------------------------- */

  listWordSets(level?: Level): WordSet[] {
    return this.sets
      .filter((s) => s.active && (!level || s.level === level))
      .slice()
      .sort((a, b) => a.level - b.level || a.day_index - b.day_index);
  }

  wordsForLevel(level: Level): Word[] {
    const setIds = new Set(this.sets.filter((s) => s.level === level && s.active).map((s) => s.id));
    return this.words
      .filter((w) => setIds.has(w.set_id))
      .slice()
      .sort((a, b) => a.set_id.localeCompare(b.set_id) || a.order_no - b.order_no);
  }

  wordById(id: string): Word | undefined {
    return this.words.find((w) => w.id === id);
  }

  wordsOfStudent(student: Student): Word[] {
    const setIds = new Set(
      this.assignments
        .filter((a) => a.student_id === student.id)
        .map((a) => a.set_id)
        .filter((id) => this.sets.some((s) => s.id === id && s.active))
    );
    const levelSetIds = new Set(this.sets.filter((s) => s.level === student.level && s.active).map((s) => s.id));
    const ids = setIds.size ? setIds : levelSetIds;
    return this.words
      .filter((w) => ids.has(w.set_id))
      .slice()
      .sort((a, b) => a.set_id.localeCompare(b.set_id) || a.order_no - b.order_no);
  }

  addWordsFromCsv(level: Level, dayIndex: number, rows: CsvRow[]): { set: WordSet; added: number } {
    const clean = rows
      .filter((r) => r.word?.trim() && r.meaning?.trim())
      .map((r, i) => ({ ...r, word: r.word.trim(), meaning: r.meaning.trim(), order_no: r.order_no ?? i + 1 }));

    let set = this.sets.find((s) => s.level === level && s.day_index === dayIndex && s.active);
    if (!set) {
      set = {
        id: uid('set'),
        name: `Level ${level} · Day ${String(dayIndex).padStart(2, '0')}`,
        level,
        day_index: dayIndex,
        active: true,
        created_at: new Date().toISOString(),
      };
      this.sets = [...this.sets, set];
      if (this.mode === 'supabase' && this.client) {
        this.cloud(`insert set ${set.id}`, () =>
          this.client!.from('word_sets').insert({ id: set!.id, name: set!.name, level, day_index: dayIndex })
        );
      }
    }

    const existing = new Set(this.words.filter((w) => w.set_id === set!.id).map((w) => w.word.toLowerCase()));
    const newWords: Word[] = [];
    for (const r of clean) {
      if (existing.has(r.word.toLowerCase())) continue;
      existing.add(r.word.toLowerCase());
      newWords.push({
        id: uid('w'),
        set_id: set.id,
        word: r.word,
        meaning: r.meaning,
        pos: r.pos?.trim() || 'n',
        example: r.example?.trim() || '',
        example_ko: r.example_ko?.trim() || '',
        order_no: r.order_no ?? newWords.length + 1,
      });
    }
    this.words = [...this.words, ...newWords];
    for (const st of this.students.filter((s) => s.level === level && s.active)) {
      this.ensureAssignments(st);
    }
    if (this.mode === 'supabase' && this.client && newWords.length) {
      this.cloud(`insert words ${set.id}`, () =>
        this.client!.from('words').insert(
          newWords.map((w) => ({
            id: w.id,
            set_id: w.set_id,
            word: w.word,
            meaning: w.meaning,
            pos: w.pos,
            example: w.example,
            example_ko: w.example_ko,
            order_no: w.order_no,
          }))
        )
      );
    }
    this.commit();
    return { set, added: newWords.length };
  }

  /* ---------------------------------- 학습 ---------------------------------- */

  logsFor(studentId: string): StudyLog[] {
    return this.logs.filter((l) => l.student_id === studentId);
  }

  allLogs(): StudyLog[] {
    return this.logs;
  }

  recordAnswer(student: Student, word: Word, isCorrect: boolean, mode: StudyMode, elapsedMs: number) {
    const log: StudyLog = {
      id: uid('log'),
      student_id: student.id,
      word_id: word.id,
      set_id: word.set_id,
      is_correct: isCorrect,
      mode,
      elapsed_ms: Math.max(0, Math.round(elapsedMs)),
      answered_at: new Date().toISOString(),
    };
    this.logs = [...this.logs, log];
    this.applyWrongNote(student.id, word.id, isCorrect);
    this.bumpProgress(student.id, 1);
    student.last_seen_at = new Date().toISOString();

    if (this.mode === 'supabase' && this.client) {
      if (this.studentToken) {
        this.cloud(`answer ${student.id}`, () =>
          this.client!.rpc('student_answer', {
            p_token: this.studentToken,
            p_word_id: word.id,
            p_correct: isCorrect,
            p_mode: mode,
            p_elapsed_ms: Math.round(elapsedMs),
          })
        );
      } else {
        this.cloud(`log ${student.id}`, () =>
          this.client!.from('study_logs').insert({
            student_id: student.id,
            word_id: word.id,
            set_id: word.set_id,
            is_correct: isCorrect,
            mode,
            elapsed_ms: Math.round(elapsedMs),
          })
        );
      }
    }
    this.commit();
  }

  private applyWrongNote(studentId: string, wordId: string, isCorrect: boolean) {
    const idx = this.wrongNotes.findIndex((n) => n.student_id === studentId && n.word_id === wordId);
    const today = todayStr();
    if (isCorrect) {
      if (idx < 0) return;
      const note = { ...this.wrongNotes[idx] };
      if (note.cleared_at) return;
      note.box = Math.min(4, note.box + 1);
      if (note.box >= 4) {
        note.cleared_at = new Date().toISOString();
      } else {
        const gap = note.box === 1 ? 1 : note.box === 2 ? 2 : note.box === 3 ? 4 : 7;
        note.due_date = addDays(today, gap);
      }
      this.wrongNotes = this.wrongNotes.map((n, i) => (i === idx ? note : n));
      this.cloudWrongNote(note);
    } else {
      if (idx >= 0) {
        const note = {
          ...this.wrongNotes[idx],
          box: 0,
          due_date: addDays(today, 1),
          miss_count: this.wrongNotes[idx].miss_count + 1,
          cleared_at: null,
        };
        this.wrongNotes = this.wrongNotes.map((n, i) => (i === idx ? note : n));
        this.cloudWrongNote(note);
      } else {
        const note: WrongNote = {
          id: uid('wn'),
          student_id: studentId,
          word_id: wordId,
          box: 0,
          due_date: addDays(today, 1),
          miss_count: 1,
          cleared_at: null,
        };
        this.wrongNotes = [...this.wrongNotes, note];
        this.cloudWrongNote(note);
      }
    }
  }

  private cloudWrongNote(note: WrongNote) {
    if (this.mode !== 'supabase' || !this.client) return;
    // 학생 모드에서는 student_answer RPC가 서버에서 오답 노트를 갱신합니다.
    if (this.studentToken) return;
    this.cloud(`wrong note ${note.id}`, () =>
      this.client!
        .from('wrong_notes')
        .upsert(
          {
            student_id: note.student_id,
            word_id: note.word_id,
            box: note.box,
            due_date: note.due_date,
            miss_count: note.miss_count,
            cleared_at: note.cleared_at,
          },
          { onConflict: 'student_id,word_id' }
        )
    );
  }

  wrongNotesFor(studentId: string): WrongNote[] {
    return this.wrongNotes
      .filter((n) => n.student_id === studentId && !n.cleared_at)
      .slice()
      .sort((a, b) => a.due_date.localeCompare(b.due_date) || b.miss_count - a.miss_count);
  }

  allWrongNotes(): WrongNote[] {
    return this.wrongNotes;
  }

  /* --------------------------------- 진행률 --------------------------------- */

  progressFor(studentId: string): DailyProgress[] {
    return this.progress.filter((p) => p.student_id === studentId);
  }

  getProgress(studentId: string, date = todayStr()): DailyProgress | undefined {
    return this.progress.find((p) => p.student_id === studentId && p.date === date);
  }

  startMission(studentId: string, target: number) {
    const date = todayStr();
    const idx = this.progress.findIndex((p) => p.student_id === studentId && p.date === date);
    if (idx >= 0) {
      const cur = this.progress[idx];
      const updated = { ...cur, target: Math.max(cur.target, target) };
      this.progress = this.progress.map((p, i) => (i === idx ? updated : p));
    } else {
      this.progress = [...this.progress, { student_id: studentId, date, target, answered: 0 }];
    }
    this.persistLocal();
    this.emit();
  }

  private bumpProgress(studentId: string, delta: number) {
    const date = todayStr();
    const idx = this.progress.findIndex((p) => p.student_id === studentId && p.date === date);
    if (idx >= 0) {
      const updated = { ...this.progress[idx], answered: this.progress[idx].answered + delta };
      this.progress = this.progress.map((p, i) => (i === idx ? updated : p));
    } else {
      this.progress = [...this.progress, { student_id: studentId, date, target: 1, answered: delta }];
    }
  }

  isCompletedToday(studentId: string): boolean {
    const p = this.getProgress(studentId);
    return !!p && p.target > 0 && p.answered >= Math.ceil(p.target * 0.8);
  }

  /* --------------------------------- 리포트 --------------------------------- */

  listReports(): WeeklyReport[] {
    return this.reports.slice().sort((a, b) => b.week_start.localeCompare(a.week_start));
  }

  saveReport(report: Omit<WeeklyReport, 'id'>) {
    const existing = this.reports.find(
      (r) => r.student_id === report.student_id && r.week_start === report.week_start
    );
    const row: WeeklyReport = {
      ...report,
      id: existing?.id ?? uid('rep'),
      opened_at: existing?.opened_at ?? report.opened_at ?? null,
    };
    this.reports = existing
      ? this.reports.map((r) => (r.id === row.id ? { ...r, ...row } : r))
      : [...this.reports, row];
    if (this.mode === 'supabase' && this.client) {
      this.cloud(`report ${row.student_id}`, () =>
        this.client!
          .from('weekly_reports')
          .upsert(
            {
              student_id: row.student_id,
              week_start: row.week_start,
              words_done: row.words_done,
              accuracy: row.accuracy,
              streak_days: row.streak_days,
              message: row.message,
              opened_at: row.opened_at,
            },
            { onConflict: 'student_id,week_start' }
          )
      );
    }
    this.commit();
  }

  markReportOpened(token: string) {
    const st = this.students.find((s) => s.parent_token === token);
    if (!st) return;
    const latest = this.listReports().find((r) => r.student_id === st.id);
    if (!latest || latest.opened_at) return;
    latest.opened_at = new Date().toISOString();
    if (this.mode === 'supabase' && this.client) {
      this.cloud(`report opened ${st.id}`, () =>
        this.client!
          .from('weekly_reports')
          .update({ opened_at: latest.opened_at })
          .eq('student_id', st.id)
          .eq('week_start', latest.week_start)
      );
    }
    this.commit();
  }

  studentByToken(token: string): Student | undefined {
    return this.students.find((s) => s.parent_token === token);
  }

  /* ------------------------------- 관리자 인증 ------------------------------- */

  verifyAdminPin(pin: string): boolean {
    return this.mode === 'local' && pin === SEED_ADMIN_PIN;
  }

  async adminSignIn(email: string, password: string): Promise<boolean> {
    if (!this.client || this.mode !== 'supabase') return email.trim() !== '' && password !== '' && this.verifyAdminPin(password);
    this.studentToken = null;
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    this.adminEmail = data.user?.email ?? null;
    await this.loadCloud();
    this.emit();
    return true;
  }

  async adminSignOut() {
    if (this.mode === 'supabase' && this.client) {
      await this.client.auth.signOut();
      this.adminEmail = null;
    }
  }

  /* --------------------------------- 백업/CSV -------------------------------- */

  backupStudentsCsv(): string {
    const header = 'name,grade,class_name,level,tosel_level,nickname,parent_token,active,created_at';
    const rows = this.students.map((s) =>
      [s.name, s.grade, s.class_name, s.level, s.tosel_level, s.nickname, s.parent_token, s.active ? 'Y' : 'N', s.created_at]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
    return '\uFEFF' + [header, ...rows].join('\n');
  }

  wordsCsv(level: Level): string {
    const header = 'word,meaning,pos,example,example_ko,order_no';
    const rows = this.wordsForLevel(level).map((w) =>
      [w.word, w.meaning, w.pos, w.example, w.example_ko, w.order_no]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
    return '\uFEFF' + [header, ...rows].join('\n');
  }

  /* --------------------------------- Supabase -------------------------------- */

  private async loadCloud() {
    if (!this.client) return;
    const c = this.client;
    const [students, sets, words, asgs, logs, notes, reports, hist] = await Promise.all([
      c.from('students').select('*'),
      c.from('word_sets').select('*'),
      c.from('words').select('*'),
      c.from('assignments').select('*'),
      c.from('study_logs').select('*').order('answered_at', { ascending: false }).limit(5000),
      c.from('wrong_notes').select('*'),
      c.from('weekly_reports').select('*'),
      c.from('level_history').select('*').limit(500),
    ]);
    const firstError = [students, sets, words, asgs, logs, notes, reports, hist].find((r) => r.error);
    if (firstError?.error) throw firstError.error;

    this.students = (students.data ?? []) as any;
    this.sets = (sets.data ?? []) as any;
    this.words = (words.data ?? []) as any;
    this.assignments = (asgs.data ?? []) as any;
    this.logs = ((logs.data ?? []) as any).map((l: any) => ({ ...l, id: String(l.id) }));
    this.wrongNotes = (notes.data ?? []) as any;
    this.reports = (reports.data ?? []) as any;
    this.history = (hist.data ?? []) as any;
  }

  private watchCloud() {
    if (!this.client) return;
    const c = this.client;
    c.channel('voca-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'study_logs' }, async () => {
        await this.loadCloud();
        this.emit();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'wrong_notes' }, async () => {
        await this.loadCloud();
        this.emit();
      })
      .subscribe();
  }

  private cloud(label: string, run: () => PromiseLike<any>) {
    if (!this.client) return;
    Promise.resolve(run()).then(
      (res: any) => {
        if (res?.error && this.cloudWarnings < 5) {
          this.cloudWarnings += 1;
          console.warn(`[voca] Supabase 쓰기 실패 (${label})`, res.error);
        }
      },
      (err) => {
        if (this.cloudWarnings < 5) {
          this.cloudWarnings += 1;
          console.warn(`[voca] Supabase 쓰기 실패 (${label})`, err);
        }
      }
    );
  }

  /** 데모 데이터를 처음 상태로 되돌립니다 (로컬 모드 전용) */
  resetDemo() {
    if (this.mode !== 'local') return;
    localStorage.removeItem(LS_KEY);
    this.students = [];
    this.sets = [];
    this.words = [];
    this.assignments = [];
    this.logs = [];
    this.wrongNotes = [];
    this.progress = [];
    this.reports = [];
    this.history = [];
    this.seedLocal();
    this.emit();
  }
}

export const store = new VocaStore();
