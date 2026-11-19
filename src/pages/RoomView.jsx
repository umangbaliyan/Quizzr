import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRoomContext } from '../context/RoomContext.jsx';
import { useRoomQuiz } from '../hooks/useRoomQuiz.js';
import { supabase } from '../lib/supabaseClient.js';
import { WaitingRoom } from './WaitingRoom.jsx';
import { QuizScreen } from './QuizScreen.jsx';
import { FinalResults } from './FinalResults.jsx';
import { Navbar } from '../components/ui/Navbar.jsx';
import { Card } from '../components/ui/Card.jsx';
import { Button } from '../components/ui/Button.jsx';

/**
 * RoomView orchestrates room screens based on authoritative server `quizState.roomStatus`:
 * - 'waiting' -> Renders WaitingRoom (lobby, player list, host start button)
 * - 'active' -> Renders QuizScreen (question prompt, options, answer reveal, no intermission)
 * - 'completed' -> Renders FinalResults (champion announcement, podium, complete final leaderboard)
 */
export function RoomView() {
  const { roomCode } = useParams();
  const navigate = useNavigate();
  const { session, clearSession, isRestored } = useRoomContext();

  // Authoritative token resolution: pass hostToken or playerToken
  const activeToken = session?.hostToken || session?.playerToken;

  // Consume live authoritative quiz state and countdown
  const { quizState, refreshQuizState, broadcastRoomChange } = useRoomQuiz(
    session?.roomId,
    roomCode,
    activeToken
  );

  // Handle leave/exit room
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
        // Clear session locally regardless
      }
    }
    clearSession();
    navigate('/');
  };

  // Missing session guard
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

  // Switch views based on authoritative roomStatus
  if (quizState.roomStatus === 'active') {
    return (
      <QuizScreen
        quizState={quizState}
        session={session}
        onExit={handleExit}
        onBroadcast={broadcastRoomChange}
      />
    );
  }

  if (quizState.roomStatus === 'completed') {
    return (
      <FinalResults
        roomCode={roomCode}
        session={session}
        onExit={handleExit}
      />
    );
  }

  // Default 'waiting' status -> WaitingRoom
  return (
    <WaitingRoom
      onExit={handleExit}
      onQuizStarted={async () => {
        if (typeof broadcastRoomChange === 'function') {
          broadcastRoomChange({ type: 'QUIZ_STARTED', roomCode });
        }
        await refreshQuizState();
      }}
      onBroadcast={broadcastRoomChange}
    />
  );
}
