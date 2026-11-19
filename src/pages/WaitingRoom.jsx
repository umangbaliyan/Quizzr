import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoomContext } from '../context/RoomContext.jsx';
import { useRoomPlayers } from '../hooks/useRoomPlayers.js';
import { supabase } from '../lib/supabaseClient.js';
import { Navbar } from '../components/ui/Navbar.jsx';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { GameBackground } from '../components/ui/GameBackground.jsx';

/**
 * WaitingRoom component for Stage 3B.
 * Replaces the temporary placeholder on `/room/:roomCode`.
 * Provides:
 * - Live real-time participant list via `useRoomPlayers(roomId)`
 * - Prominent room code with copy-to-clipboard functionality
 * - Host controls: kick player via `remove-player`, start quiz via `start-room`
 * - Player view: waiting indicator until host launches the game
 * - Clean leave/exit handling
 */
export function WaitingRoom({ onQuizStarted, onBroadcast }) {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { session, clearSession, isRestored } = useRoomContext();

  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [isStarting, setIsStarting] = useState(false);
  const [removingPlayerId, setRemovingPlayerId] = useState(null);

  // Consume live players hook using roomId from session
  const { players, loading: playersLoading, error: playersError } = useRoomPlayers(session?.roomId);

  // Realtime subscription on room status transitions (e.g. host clicks start)
  useEffect(() => {
    if (!session?.roomId) return;

    const channelName = `waiting_room_status_${session.roomId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${session.roomId}`,
        },
        (payload) => {
          if (payload.new && payload.new.status === 'active') {
            // Room started: Stage 4/5 quiz gameplay screen will mount here.
            // For Stage 3B, room status update is captured in state.
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.roomId]);

  // Handle kick/removal: check if current player was removed
  useEffect(() => {
    if (!playersLoading && session?.playerId && players.length > 0) {
      const stillInRoom = players.some((p) => p.id === session.playerId);
      if (!stillInRoom && !session.isHost) {
        clearSession();
        navigate('/', { replace: true });
      }
    }
  }, [players, playersLoading, session?.playerId, session?.isHost, clearSession, navigate]);

  // Copy room code to clipboard
  const handleCopyCode = async () => {
    if (!roomCode) return;
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      setCopied(false);
    }
  };

  // Exit room handler
  const handleExit = async () => {
    if (session?.roomId && session?.playerToken && session?.playerId && !session?.isHost) {
      try {
        await supabase.functions.invoke('remove-player', {
          body: {
            room_id: session.roomId,
            player_token: session.playerToken,
            player_id: session.playerId,
          },
        });
      } catch {
        // Continue clearing session locally regardless
      }
    }
    clearSession();
    navigate('/');
  };

  // Host action: Kick participant
  const handleKickPlayer = async (targetPlayerId) => {
    if (!session?.isHost || !session?.hostToken || !session?.roomId) return;
    setActionError(null);
    setRemovingPlayerId(targetPlayerId);

    try {
      const { error: kickErr } = await supabase.functions.invoke('remove-player', {
        body: {
          room_id: session.roomId,
          host_token: session.hostToken,
          player_id: targetPlayerId,
        },
      });

      if (kickErr) {
        let msg = kickErr.message || 'Failed to remove player';
        if (kickErr.context && typeof kickErr.context.json === 'function') {
          try {
            const body = await kickErr.context.json();
            if (body?.error) msg = body.error;
          } catch {
            // Keep default
          }
        }
        throw new Error(msg);
      }
    } catch (err) {
      setActionError(err.message || 'Error removing player');
    } finally {
      setRemovingPlayerId(null);
    }
  };

  // Host action: Start quiz
  const handleStartQuiz = async () => {
    if (!session?.isHost || !session?.hostToken || !session?.roomId || isStarting) return;
    setActionError(null);
    setIsStarting(true);

    try {
      const { error: startErr } = await supabase.functions.invoke('start-room', {
        body: {
          room_id: session.roomId,
          host_token: session.hostToken,
        },
      });

      if (startErr) {
        let msg = startErr.message || 'Failed to start quiz';
        if (startErr.context && typeof startErr.context.json === 'function') {
          try {
            const body = await startErr.context.json();
            if (body?.error) msg = body.error;
          } catch {
            // Keep default
          }
        }
        throw new Error(msg);
      }

      // Quiz started successfully on backend:
      // Notify parent RoomView immediately and broadcast to all connected participant browsers
      if (typeof onQuizStarted === 'function') {
        await onQuizStarted();
      } else if (typeof onBroadcast === 'function') {
        onBroadcast({ type: 'QUIZ_STARTED', room_id: session.roomId });
      }
    } catch (err) {
      setActionError(err.message || 'Failed to start quiz room');
    } finally {
      setIsStarting(false);
    }
  };

  // Missing session check
  if (isRestored && (!session || session.roomCode !== roomCode)) {
    return (
      <div className="min-h-screen flex flex-col bg-[#111315] text-[#F4F3EF]">
        <Navbar onExit={() => navigate('/')} />
        <main className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full text-center p-8">
            <h2 className="text-lg font-semibold text-[#F4F3EF] mb-2">
              No Active Session Found
            </h2>
            <p className="text-xs text-[#A1A6AD] mb-6">
              You are not registered in room <span className="font-mono text-[#F4F3EF]">{roomCode}</span>. Please join or create a game to participate.
            </p>
            <Button variant="primary" onClick={() => navigate('/')} className="w-full">
              Go to Home
            </Button>
          </Card>
        </main>
      </div>
    );
  }

  const isHost = Boolean(session?.isHost);
  const totalCount = players.length;

  return (
    <GameBackground>
      {/* Header */}
      <Navbar
        roomCode={roomCode}
        isHost={isHost}
        onExit={handleExit}
      />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        {/* Top Status Bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="accent">WAITING</Badge>
            <span className="text-xs text-[#A1A6AD] hidden sm:inline">•</span>
            <span className="text-xs text-[#A1A6AD] hidden sm:inline">Lobby Active</span>
          </div>

          <div className="text-xs text-[#A1A6AD]">
            Playing as: <span className="font-semibold text-[#F4F3EF]">{session?.nickname}</span>
          </div>
        </div>

        {actionError && (
          <div
            role="alert"
            className="p-3 text-xs rounded border border-[#D96868]/40 bg-[#D96868]/10 text-[#D96868] flex items-center justify-between"
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="text-[#D96868] hover:text-[#F4F3EF] ml-2 text-sm font-semibold"
            >
              ×
            </button>
          </div>
        )}

        {/* Room Code Showcase Card */}
        <Card variant="primary" className="p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="text-center sm:text-left">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#A1A6AD] block mb-1">
              Room Code
            </span>
            <div className="flex items-center justify-center sm:justify-start gap-3">
              <span className="text-4xl sm:text-5xl font-mono font-bold tracking-widest text-[#F4F3EF]">
                {roomCode}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCopyCode}
                className="font-mono text-xs"
              >
                {copied ? 'Copied!' : 'Copy Code'}
              </Button>
            </div>
            <p className="text-xs text-[#A1A6AD] mt-2">
              Share this code with your friends to join the quiz.
            </p>
          </div>

          {/* Host Controls */}
          {isHost ? (
            <div className="flex flex-col items-center sm:items-end gap-2 w-full sm:w-auto">
              <Button
                variant="primary"
                size="lg"
                onClick={handleStartQuiz}
                disabled={isStarting || totalCount === 0}
                className="w-full sm:w-auto min-w-[200px]"
              >
                {isStarting ? 'Starting Quiz...' : 'Start Quiz'}
              </Button>
              <span className="text-xs text-[#A1A6AD]">
                {totalCount} {totalCount === 1 ? 'player' : 'players'} ready
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-4 py-3 rounded bg-[#22262A] border border-[#30353A] text-xs text-[#A1A6AD]">
              <span className="inline-block w-2 h-2 rounded-full bg-[#6C9AE8] animate-pulse"></span>
              Waiting for host to start the game...
            </div>
          )}
        </Card>

        {/* Players Section */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-[#30353A] pb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[#F4F3EF]">
                Players in Room
              </h2>
              <Badge variant="neutral">{totalCount}</Badge>
            </div>
            <span className="text-xs text-[#A1A6AD]">Live synchronization</span>
          </div>

          {playersLoading && (
            <div className="py-12 text-center text-xs text-[#A1A6AD]">
              Loading room participants...
            </div>
          )}

          {playersError && (
            <div className="p-4 text-xs text-[#D96868] rounded bg-[#D96868]/10 border border-[#D96868]/30">
              Error syncing players: {playersError}
            </div>
          )}

          {!playersLoading && players.length === 0 && (
            <div className="py-12 text-center rounded border border-[#30353A] bg-[#1A1D20]/50 p-6">
              <p className="text-sm text-[#F4F3EF] mb-1 font-medium">No players yet</p>
              <p className="text-xs text-[#A1A6AD]">
                Give friends the room code <span className="font-mono text-[#6C9AE8]">{roomCode}</span> to start joining!
              </p>
            </div>
          )}

          {/* Players Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {players.map((p) => {
              const isCurrentUser = p.id === session?.playerId;
              const isPlayerHost = Boolean(p.is_host || p.isHost);

              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-3.5 rounded-lg border transition-colors ${
                    isCurrentUser
                      ? 'bg-[#22262A] border-[#6C9AE8]/40'
                      : 'bg-[#1A1D20] border-[#30353A]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate mr-2">
                    {/* Minimal Avatar Circle */}
                    <div className="w-8 h-8 rounded-full bg-[#22262A] border border-[#30353A] flex items-center justify-center text-xs font-semibold text-[#F4F3EF] shrink-0">
                      {p.nickname.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="truncate">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-sm font-medium text-[#F4F3EF] truncate">
                          {p.nickname}
                        </span>
                        {isCurrentUser && (
                          <span className="text-[10px] text-[#A1A6AD] font-mono shrink-0">(You)</span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {isPlayerHost && (
                      <Badge variant="accent">Host</Badge>
                    )}

                    {/* Host Kick Action (Host cannot kick themselves) */}
                    {isHost && !isPlayerHost && (
                      <button
                        type="button"
                        onClick={() => handleKickPlayer(p.id)}
                        disabled={removingPlayerId === p.id}
                        className="text-xs text-[#A1A6AD] hover:text-[#D96868] p-1 transition-colors disabled:opacity-50"
                        title={`Kick ${p.nickname}`}
                        aria-label={`Kick ${p.nickname}`}
                      >
                        {removingPlayerId === p.id ? '...' : 'Kick'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>
    </GameBackground>
  );
}

