import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/util';
import { useSubject } from '../subject-context';

export type StudentTabKey = 'today' | 'wrong' | 'rank' | 'game' | 'shop';

interface NavItem {
  key: StudentTabKey;
  label: string;
  icon: string;
  to: string;
}

/** 📚 영어 모드 하단 탭 (기존 그대로) */
const ENGLISH_ITEMS: NavItem[] = [
  { key: 'today', label: '오늘', icon: '📅', to: '/' },
  { key: 'wrong', label: '오답노트', icon: '🔁', to: '/?tab=wrong' },
  { key: 'rank', label: '랭킹', icon: '🏆', to: '/?tab=rank' },
  { key: 'game', label: '게임', icon: '🃏', to: '/game' },
  { key: 'shop', label: '상점', icon: '🎁', to: '/shop' },
];

/** 💻 코딩 모드 하단 탭 — 오늘 · 오답노트 · 게임 · 상점 */
const CODING_ITEMS: NavItem[] = [
  { key: 'today', label: '오늘', icon: '📅', to: '/' },
  { key: 'wrong', label: '오답노트', icon: '🔁', to: '/?tab=wrong' },
  { key: 'game', label: '코딩 게임', icon: '🎮', to: '/game' },
  { key: 'shop', label: '상점', icon: '🎁', to: '/shop' },
];

/** 학생 화면 공통 하단 탭 — 지금 보는 과목에 맞춰 항목이 바뀝니다 */
export default function StudentNav({ active }: { active: StudentTabKey }) {
  const navigate = useNavigate();
  const { subject } = useSubject();
  const items = subject === 'coding' ? CODING_ITEMS : ENGLISH_ITEMS;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white bg-white/90 backdrop-blur" data-testid="student-nav">
      <div className="mx-auto flex max-w-3xl items-stretch justify-around px-2 pb-safe pt-1.5">
        {items.map((item) => (
          <button
            key={item.key}
            data-testid={`nav-${item.key}`}
            onClick={() => navigate(item.to)}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-2 text-[11px] font-semibold transition',
              active === item.key ? 'text-brand-700' : 'text-slate-400'
            )}
          >
            <span className={cn('text-lg transition', active === item.key && 'scale-110')}>{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
