import React from 'react';

export const AVATAR_LIST = [
  { id: 'cat-detective', emoji: '🕵️', label: 'Detective', bg: 'bg-amber-500/20 border-amber-500/40' },
  { id: 'cat-wizard', emoji: '🧙', label: 'Wizard', bg: 'bg-purple-500/20 border-purple-500/40' },
  { id: 'cat-ninja', emoji: '🥷', label: 'Ninja', bg: 'bg-slate-500/20 border-slate-500/40' },
  { id: 'cat-astronaut', emoji: '🧑‍🚀', label: 'Cosmonaut', bg: 'bg-blue-500/20 border-blue-500/40' },
  { id: 'cat-robot', emoji: '🤖', label: 'Cyborg', bg: 'bg-cyan-500/20 border-cyan-500/40' },
  { id: 'cat-gamer', emoji: '🎮', label: 'Gamer', bg: 'bg-indigo-500/20 border-indigo-500/40' },
  { id: 'cat-crown', emoji: '👑', label: 'Monarch', bg: 'bg-yellow-500/20 border-yellow-500/40' },
  { id: 'cat-alien', emoji: '👾', label: 'Invader', bg: 'bg-emerald-500/20 border-emerald-500/40' },
];

/**
 * Visual avatar selector matching reference video style
 */
export function AvatarSelector({ selectedId, onSelect, className = '' }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-300/70">
        Choose Avatar
      </span>
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
        {AVATAR_LIST.map((av) => {
          const isSelected = selectedId === av.id;
          return (
            <button
              key={av.id}
              type="button"
              onClick={() => onSelect(av.id)}
              title={av.label}
              className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all duration-150 border ${
                isSelected
                  ? 'bg-purple-600/30 border-purple-400 ring-2 ring-purple-400/50 scale-105 shadow-md shadow-purple-500/20'
                  : 'bg-[#18122B]/70 border-purple-900/40 hover:border-purple-600/60 hover:bg-[#201838]'
              }`}
            >
              <span className="transform transition-transform hover:scale-110">{av.emoji}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

