import React from 'react';
import { Badge } from './Badge.jsx';
import { Button } from './Button.jsx';

/**
 * Top navigation bar with branding, optional room code badge, and exit button.
 */
export function Navbar({
  roomCode,
  isHost,
  onExit,
  className = '',
}) {
  return (
    <header className={`w-full border-b border-[#251A40]/80 bg-[#090614]/85 backdrop-blur-md sticky top-0 z-40 ${className}`}>
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <a href="/" className="flex items-center gap-2.5 group">
          {/* Gaming Logo Icon */}
          <img
            src="/logo.png"
            alt="Quizzr logo"
            className="w-8 h-8 object-contain select-none transition-transform group-hover:scale-105"
          />
          <span className="font-extrabold tracking-wider text-base text-white group-hover:text-purple-300 transition-colors">
            QUIZZR
          </span>
          {isHost && (
            <Badge variant="accent" className="hidden sm:inline-flex ml-1.5">
              HOST
            </Badge>
          )}
        </a>

        {roomCode && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#A5A6C2] hidden sm:inline">Room</span>
            <span className="font-mono text-sm font-bold tracking-widest text-purple-200 px-3 py-1 rounded-xl bg-[#18112C] border border-purple-500/30 shadow-inner">
              {roomCode}
            </span>
          </div>
        )}

        {onExit && (
          <Button variant="ghost" size="sm" onClick={onExit} className="hover:text-red-400">
            Exit
          </Button>
        )}
      </div>
    </header>
  );
}
