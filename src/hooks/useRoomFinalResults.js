import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * Computes standard competition ranking (1, 2, 2, 4) deterministically
 * Sorts by score DESC, joined_at ASC, id ASC
 * Assigns isWinner only if room is completed and rank === 1
 */
function computeStandardResults(playerList, isCompleted = false) {
  if (!Array.isArray(playerList)) return [];

  const sorted = [...playerList].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aJoined = new Date(a.joinedAt || a.joined_at).getTime();
    const bJoined = new Date(b.joinedAt || b.joined_at).getTime();
    if (aJoined !== bJoined) return aJoined - bJoined;
    return String(a.id).localeCompare(String(b.id));
  });

  let currentRank = 1;
  return sorted.map((p, idx) => {
    if (idx > 0) {
      if (p.score === sorted[idx - 1].score) {
        // Tied with previous player: keep rank
      } else {
        // Standard competition ranking: jump ahead
        currentRank = idx + 1;
      }
    }
    const isWinner = Boolean(isCompleted && currentRank === 1);
    return {
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      rank: currentRank,
      isWinner,
      isHost: p.isHost ?? p.is_host,
      joinedAt: p.joinedAt ?? p.joined_at,
    };
  });
}

/**
 * Extracts podium based strictly on actual standard competition ranks:
 * - First: rank === 1
 * - Second: rank === 2
 * - Third: rank === 3
 * Note: If ties cause rank 2 or 3 to be skipped, the corresponding podium bracket will be empty.
 */
function extractPodium(leaderboard) {
  return {
    first: leaderboard.filter((p) => p.rank === 1),
    second: leaderboard.filter((p) => p.rank === 2),
    third: leaderboard.filter((p) => p.rank === 3),
  };
}

/**
 * Custom React hook for final quiz results synchronization and state handling.
 * - Detects room completion via Realtime on 'rooms' table.
 * - Immediately fetches authoritative results if room is already completed or on mount.
 * - Refreshes authoritative results on reconnection.
 * - Avoids stale Realtime data overwriting newer results.
 * - Strictly respects standard competition ranking and podium placement (rank 1, 2, 3).
 *
 * @param {string} roomCode - 6-character room code
 * @param {string} token - Host or Player authentication token
 * @param {string} [initialRoomId] - Optional room UUID if known upfront
 * @returns {{
 *   isCompleted: boolean,
 *   roomStatus: string,
 *   completedAt: string|null,
 *   winners: Array<{ id: string, nickname: string, score: number }>,
 *   podium: { first: Array, second: Array, third: Array },
 *   leaderboard: Array,
 *   roomId: string|null,
 *   loading: boolean,
 *   error: string|null,
 *   refreshResults: () => Promise<void>
 * }}
 */
export function useRoomFinalResults(roomCode, token, initialRoomId = null) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [winners, setWinners] = useState([]);
  const [podium, setPodium] = useState({ first: [], second: [], third: [] });
  const [roomId, setRoomId] = useState(initialRoomId);
  const [roomStatus, setRoomStatus] = useState('waiting');
  const [isCompleted, setIsCompleted] = useState(false);
  const [completedAt, setCompletedAt] = useState(null);
  const [loading, setLoading] = useState(Boolean(roomCode && token));
  const [error, setError] = useState(null);

  const roomChannelRef = useRef(null);
  const hasSubscribedRef = useRef(false);

  // Authoritative server fetch
  const fetchFinalResults = useCallback(async () => {
    if (!roomCode || !token) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('get-leaderboard', {
        body: {
          room_code: roomCode,
          player_token: token,
          host_token: token,
        },
      });

      if (fnErr) throw fnErr;

      const completed = data.roomStatus === 'completed' || Boolean(data.isCompleted);
      const computedLeaderboard = computeStandardResults(data.leaderboard || [], completed);

      setRoomId(data.roomId);
      setRoomStatus(data.roomStatus);
      setIsCompleted(completed);
      setCompletedAt(data.completedAt || null);
      setLeaderboard(computedLeaderboard);

      if (completed) {
        setWinners(data.winners || computedLeaderboard.filter((p) => p.rank === 1));
        setPodium(extractPodium(computedLeaderboard));
      } else {
        setWinners([]);
        setPodium({ first: [], second: [], third: [] });
      }

      setError(null);
    } catch (err) {
      console.error('Failed to fetch final results:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roomCode, token]);

  // Initial fetch on mount or credential update
  useEffect(() => {
    if (!roomCode || !token) return;
    fetchFinalResults();
  }, [roomCode, token, fetchFinalResults]);

  // Subscribe to Realtime room updates to detect completion & reconnection
  useEffect(() => {
    if (!roomId) return;

    const channelName = `final_results_room_${roomId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${roomId}`,
        },
        (payload) => {
          if (!payload.new) return;
          // When room status transitions to completed, fetch final authoritative results
          if (payload.new.status === 'completed') {
            fetchFinalResults();
          } else if (payload.new.status) {
            setRoomStatus(payload.new.status);
          }
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error(`Realtime error for final results room ${roomId}:`, err);
        }
        if (status === 'SUBSCRIBED') {
          // Reconnection handling: fetch authoritative state
          if (hasSubscribedRef.current) {
            fetchFinalResults();
          }
          hasSubscribedRef.current = true;
        }
      });

    roomChannelRef.current = channel;

    // Cleanup subscription on unmount
    return () => {
      if (roomChannelRef.current) {
        supabase.removeChannel(roomChannelRef.current);
      }
    };
  }, [roomId, fetchFinalResults]);

  return {
    isCompleted,
    roomStatus,
    completedAt,
    winners,
    podium,
    leaderboard,
    roomId,
    loading,
    error,
    refreshResults: fetchFinalResults,
  };
}

