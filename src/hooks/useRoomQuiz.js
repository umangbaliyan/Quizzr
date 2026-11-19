import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * Custom React hook for live quiz synchronization in a room.
 * Subscribes to Realtime UPDATE events on the rooms table, synchronizes the countdown
 * with question_deadline, and fetches authoritative server state on connect/reconnect.
 *
 * @param {string} roomId - UUID of the room
 * @param {string} roomCode - 6-character room code
 * @param {string} token - Host or Player authentication token
 * @returns {{
 *   quizState: {
 *     roomStatus: string,
 *     currentQuestionIndex: number,
 *     totalQuestions: number,
 *     questionDeadline: string|null,
 *     questionDurationSeconds: number,
 *     remainingSeconds: number,
 *     question: Object|null
 *   },
 *   loading: boolean,
 *   error: string|null,
 *   refreshQuizState: () => Promise<void>
 * }}
 */
export function useRoomQuiz(roomId, roomCode, token) {
  const [quizState, setQuizState] = useState({
    roomStatus: 'waiting',
    currentQuestionIndex: 0,
    totalQuestions: 0,
    questionDeadline: null,
    questionDurationSeconds: 20,
    remainingSeconds: 0,
    question: null,
    totalPlayers: 0,
    totalAnswers: 0,
    allPlayersAnswered: false,
    userSubmission: {
      hasSubmitted: false,
      selectedOptionIndex: null,
      isCorrect: null,
      pointsAwarded: null,
    },
  });
  const [loading, setLoading] = useState(Boolean(roomId || roomCode));
  const [error, setError] = useState(null);
  const channelRef = useRef(null);
  const timerRef = useRef(null);
  const pollTimerRef = useRef(null);

  // Authoritative server state fetch
  const fetchQuizState = useCallback(async () => {
    if ((!roomId && !roomCode) || !token) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('get-current-question', {
        body: {
          room_id: roomId || undefined,
          room_code: roomCode || undefined,
          player_token: token,
          host_token: token,
        },
      });

      if (fnErr) throw fnErr;

      setQuizState({
        roomStatus: data.roomStatus,
        currentQuestionIndex: data.currentQuestionIndex,
        totalQuestions: data.totalQuestions,
        questionDeadline: data.questionDeadline,
        questionDurationSeconds: data.questionDurationSeconds,
        remainingSeconds: data.remainingSeconds,
        question: data.question,
        totalPlayers: data.totalPlayers || 0,
        totalAnswers: data.totalAnswers || 0,
        allPlayersAnswered: Boolean(data.allPlayersAnswered),
        userSubmission: data.userSubmission || {
          hasSubmitted: false,
          selectedOptionIndex: null,
          isCorrect: null,
          pointsAwarded: null,
        },
      });
      setError(null);
    } catch (err) {
      console.error('Failed to fetch quiz state:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roomId, roomCode, token]);

  // Client-side synchronized countdown calculated against authoritative server deadline
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (quizState.roomStatus !== 'active' || !quizState.questionDeadline) {
      return;
    }

    const targetTime = new Date(quizState.questionDeadline).getTime();

    timerRef.current = setInterval(() => {
      const diff = Math.max(0, Math.ceil((targetTime - Date.now()) / 1000));
      setQuizState((prev) => (prev.remainingSeconds === diff ? prev : { ...prev, remainingSeconds: diff }));
      if (diff <= 0 && timerRef.current) {
        clearInterval(timerRef.current);
      }
    }, 250);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [quizState.questionDeadline, quizState.roomStatus]);

  // Reliable Realtime synchronization:
  // 1. Supabase Broadcast channel ('ROOM_STATE_CHANGE') for instantaneous sub-100ms multi-browser sync
  // 2. postgres_changes backup
  // 3. Lightweight fallback polling: when active and waiting for others or when timer expired
  useEffect(() => {
    if (!roomId) return;

    // Initial state fetch
    fetchQuizState();

    // Setup Realtime Broadcast and Postgres subscription
    const channelName = `quiz_room_${roomId}`;
    const channel = supabase
      .channel(channelName)
      .on('broadcast', { event: 'ROOM_STATE_CHANGE' }, () => {
        fetchQuizState();
      })
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        () => {
          fetchQuizState();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'answers',
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          fetchQuizState();
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          // Sync on successful subscription / reconnection
          fetchQuizState();
        }
        if (err) {
          console.error(`Realtime room quiz error for ${roomId}:`, err);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [roomId, fetchQuizState]);

  // Synchronization fallback:
  // Poll periodically:
  // - Every 1.5s when 'waiting' to catch the quiz starting immediately even if websocket event is dropped/blocked
  // - Every 1.5s when 'active' to catch question transitions seamlessly
  useEffect(() => {
    if (!roomId) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    if (quizState.roomStatus === 'completed') {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    pollTimerRef.current = setInterval(() => {
      fetchQuizState();
    }, 1500);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [quizState.roomStatus, roomId, fetchQuizState]);

  // Method to broadcast state changes to all peers in the room
  const broadcastRoomChange = useCallback((eventPayload = {}) => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'ROOM_STATE_CHANGE',
        payload: eventPayload,
      });
    }
  }, []);

  return {
    quizState,
    loading,
    error,
    refreshQuizState: fetchQuizState,
    broadcastRoomChange,
  };
}

