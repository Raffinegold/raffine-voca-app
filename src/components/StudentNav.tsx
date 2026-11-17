import { useNavigate } from 'react-router-dom';
import { cn } from '../lib/util';

export type StudentTabKey = 'today' | 'wrong' | 'rank' | 'game' | 'shop';

const ITEMS: { key: StudentTabKey; label: string; icon: string; to: string }[] = [
  { key: 'today', label: '오늘', icon: '📅', to: '/' },
  { key: 'wrong', label: '오답노트', icon: '🔁', to: '/?tab=wrong' },
  { key: 'rank', label: '랭킹', icon: '🏆', to: '/?tab=rank' },
  { key: 'game', label: '게임', icon: '🃏', to: '/game' },
  { key: 'shop', label: '상점', icon: '🎁', to: '/shop' },
];

/** 학생 화면 공통 하단 탭 (오늘 · 오답노트 · 랭킹 · 게임 · 상점) */
export default function StudentNav({ active }: { active: StudentTabKey }) {
  const navigate = useNavigate();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-stretch justify-around px-2 pb-safe pt-1.5">
        {ITEMS.map((item) => (
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
