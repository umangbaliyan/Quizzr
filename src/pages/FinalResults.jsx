import React from 'react';
import { useRoomFinalResults } from '../hooks/useRoomFinalResults.js';
import { Navbar } from '../components/ui/Navbar.jsx';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { GameBackground } from '../components/ui/GameBackground.jsx';
import { Confetti } from '../components/ui/Confetti.jsx';

/**
 * FinalResults component for Quizzr.
 * Appears ONLY ONCE after the entire quiz is completed.
 * Displays:
 * - Victory celebration header and winner announcement (supporting joint winners).
 * - Standard competition podium (1st, 2nd, 3rd places based on actual ranks).
 * - Complete final rankings table with nicknames, scores, and ranks (1, 2, 2, 4).
 * - Exit to Home action.
 */
export function FinalResults({ roomCode, session, onExit }) {
  const activeToken = session?.hostToken || session?.playerToken;
  const { winners, podium, leaderboard, loading, error } = useRoomFinalResults(
    roomCode,
    activeToken,
    session?.roomId
  );

  const isCurrentPlayerWinner = winners.some((w) => w.id === session?.playerId);
  const isJointWinner = winners.length > 1;

  return (
    <GameBackground>
      {/* Celebration Confetti */}
      {!loading && !error && leaderboard.length > 0 && <Confetti />}

      <Navbar roomCode={roomCode} isHost={session?.isHost} onExit={onExit} />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 flex flex-col gap-8">
        {/* Victory Header */}
        <div className="text-center flex flex-col items-center">
          <Badge variant="accent" className="mb-3 px-3.5 py-1 text-xs">
            QUIZ COMPLETE
          </Badge>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-2">
            Final Results
          </h1>

          {isCurrentPlayerWinner ? (
            <p className="text-base text-emerald-400 font-semibold">
              Congratulations! You {isJointWinner ? 'tied for 1st place' : 'won the quiz'}!
            </p>
          ) : (
            <p className="text-sm text-[#A5A6C2]">
              Thanks for playing! Here are the official final rankings.
            </p>
          )}

          {/* Winner Callout Banner */}
          {winners.length > 0 && (
            <div className="mt-4 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 shadow-lg shadow-amber-500/10 max-w-md w-full flex items-center justify-center gap-3">
              <span className="text-3xl">🏆</span>
              <div className="text-left">
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400/80 block">
                  {isJointWinner ? 'Joint Champions' : 'Champion'}
                </span>
                <span className="text-base font-extrabold text-amber-300">
                  {winners.map((w) => w.nickname).join(', ')}
                </span>
                <span className="text-xs text-amber-400 font-mono font-bold ml-2">
                  ({winners[0]?.score} pts)
                </span>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 text-xs text-red-300 rounded-xl bg-red-950/30 border border-red-500/30 text-center">
            Error loading final results: {error}
          </div>
        )}

        {loading && (
          <div className="py-12 text-center text-xs text-[#A5A6C2]">
            Calculating final standings and competition rankings...
          </div>
        )}

        {/* Podium Display (1st, 2nd, 3rd) */}
        {!loading && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4 items-end max-w-xl mx-auto w-full pt-4 pb-2">
            {/* 2nd Place - Silver */}
            <div className="flex flex-col items-center">
              {podium.second.length > 0 ? (
                <>
                  <div className="text-center mb-2 truncate max-w-full px-1">
                    <span className="text-xs sm:text-sm font-bold text-slate-200 block truncate">
                      {podium.second.map((p) => p.nickname).join(', ')}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-slate-400">
                      {podium.second[0]?.score} pts
                    </span>
                  </div>
                  <div className="w-full h-24 bg-gradient-to-t from-slate-800/80 to-slate-700/60 rounded-t-2xl border-t-2 border-l border-r border-slate-300/80 flex flex-col items-center justify-center shadow-lg shadow-slate-900/50">
                    <span className="font-mono text-2xl font-black text-slate-100">2</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">Silver</span>
                  </div>
                </>
              ) : (
                <div className="w-full h-24 bg-slate-900/30 rounded-t-2xl border-t border-l border-r border-slate-700/30 flex items-center justify-center">
                  <span className="text-xs text-slate-500">—</span>
                </div>
              )}
            </div>

            {/* 1st Place - Gold */}
            <div className="flex flex-col items-center">
              {podium.first.length > 0 && (
                <>
                  <div className="text-center mb-2 truncate max-w-full px-1">
                    <span className="text-sm sm:text-base font-extrabold text-amber-200 block truncate">
                      {podium.first.map((p) => p.nickname).join(', ')}
                    </span>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {podium.first[0]?.score} pts
                    </span>
                  </div>
                  <div className="w-full h-32 bg-gradient-to-t from-amber-950/80 to-amber-700/50 rounded-t-2xl border-t-2 border-l border-r border-amber-400 flex flex-col items-center justify-center shadow-xl shadow-amber-500/20">
                    <span className="font-mono text-3xl font-black text-amber-300">1</span>
                    <span className="text-[11px] uppercase tracking-wider text-amber-400 font-black">Gold</span>
                  </div>
                </>
              )}
            </div>

            {/* 3rd Place - Bronze */}
            <div className="flex flex-col items-center">
              {podium.third.length > 0 ? (
                <>
                  <div className="text-center mb-2 truncate max-w-full px-1">
                    <span className="text-xs sm:text-sm font-bold text-amber-600/90 block truncate">
                      {podium.third.map((p) => p.nickname).join(', ')}
                    </span>
                    <span className="text-[11px] font-mono font-semibold text-amber-700/80">
                      {podium.third[0]?.score} pts
                    </span>
                  </div>
                  <div className="w-full h-16 bg-gradient-to-t from-[#2A1608]/90 to-[#4A2610]/70 rounded-t-2xl border-t-2 border-l border-r border-amber-600/80 flex flex-col items-center justify-center shadow-lg shadow-amber-950/50">
                    <span className="font-mono text-xl font-black text-amber-500">3</span>
                    <span className="text-[10px] uppercase tracking-wider text-amber-500/90 font-bold">Bronze</span>
                  </div>
                </>
              ) : (
                <div className="w-full h-16 bg-[#2A1608]/30 rounded-t-2xl border-t border-l border-r border-amber-900/30 flex items-center justify-center">
                  <span className="text-xs text-amber-900/40">—</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Complete Final Leaderboard Table */}
        {!loading && leaderboard.length > 0 && (
          <Card variant="primary" className="p-5 sm:p-6">
            <div className="flex items-center justify-between border-b border-[#251A40] pb-3 mb-4">
              <h3 className="text-sm font-bold text-white tracking-wide">
                Complete Leaderboard
              </h3>
              <span className="text-xs text-[#A5A6C2]">Standard Competition Ranking</span>
            </div>

            <div className="flex flex-col gap-2.5">
              {leaderboard.map((p) => {
                const isCurrent = p.id === session?.playerId;

                // Color styling by rank
                let rankBadgeClass = 'text-[#A5A6C2] bg-white/5 border-white/10';
                let rowBgBorderClass = 'bg-[#18112C]/60 border-[#2E204E] hover:border-[#38265E]';
                let nameClass = 'text-white';
                let scoreClass = 'text-white';

                if (p.rank === 1) {
                  rankBadgeClass = 'text-amber-300 bg-amber-400/20 border-amber-400/40 shadow-sm shadow-amber-500/20';
                  rowBgBorderClass = 'bg-amber-950/20 border-amber-500/40 shadow-md shadow-amber-950/20';
                  nameClass = 'text-amber-200 font-bold';
                  scoreClass = 'text-amber-300 font-extrabold';
                } else if (p.rank === 2) {
                  rankBadgeClass = 'text-slate-200 bg-slate-400/20 border-slate-300/40 shadow-sm shadow-slate-500/10';
                  rowBgBorderClass = 'bg-slate-900/40 border-slate-400/30';
                  nameClass = 'text-slate-100 font-bold';
                  scoreClass = 'text-slate-200 font-extrabold';
                } else if (p.rank === 3) {
                  rankBadgeClass = 'text-amber-500 bg-amber-800/20 border-amber-600/40 shadow-sm shadow-amber-700/10';
                  rowBgBorderClass = 'bg-amber-950/15 border-amber-700/30';
                  nameClass = 'text-amber-500 font-bold';
                  scoreClass = 'text-amber-500 font-extrabold';
                }

                if (isCurrent) {
                  rowBgBorderClass += ' ring-1 ring-blue-400/50';
                }

                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-3 sm:p-3.5 rounded-xl border transition-all ${rowBgBorderClass}`}
                  >
                    <div className="flex items-center gap-3 truncate mr-2">
                      <span
                        className={`font-mono text-xs font-black min-w-7 h-7 flex items-center justify-center rounded-lg border ${rankBadgeClass}`}
                      >
                        #{p.rank}
                      </span>
                      <span className={`text-sm truncate ${nameClass}`}>
                        {p.nickname} {isCurrent && <span className="text-xs text-[#93C5FD] font-mono ml-1 font-semibold">(You)</span>}
                      </span>
                    </div>

                    <div className={`font-mono text-sm ${scoreClass}`}>
                      {p.score} pts
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {/* Actions */}
        <div className="flex justify-center pt-2">
          <Button variant="secondary" size="lg" onClick={onExit} className="min-w-[180px]">
            Exit to Home
          </Button>
        </div>
      </main>
    </GameBackground>
  );
}
