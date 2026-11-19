import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * Computes standard competition ranking (1, 2, 2, 4) deterministically
 * Sorts by score DESC, joined_at ASC, id ASC
 */
function computeStandardRanks(playerList) {
  if (!Array.isArray(playerList)) return [];

  // Sort deterministically
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
        // Tied with previous player: keep currentRank
      } else {
        // Standard competition rank: skip to index + 1
        currentRank = idx + 1;
      }
    }
    return {
      id: p.id,
      nickname: p.nickname,
      score: p.score,
      rank: currentRank,
      isHost: p.isHost ?? p.is_host,
      joinedAt: p.joinedAt ?? p.joined_at,
    };
  });
}

/**
 * Custom React hook for live quiz leaderboard synchronization.
 * 1. Establishes Realtime subscription before or concurrently with initial fetch to avoid missing events.
 * 2. Fetches authoritative leaderboard state.
 * 3. Automatically triggers refreshLeaderboard() upon Realtime reconnection (e.g. SUBSCRIBED after disconnect).
 * 4. Ensures Realtime UPDATE events monotonic score progression (cannot overwrite newer scores with stale lower scores).
 * 5. Recalculates standard competition ranks locally when score updates arrive.
 *
 * @param {string} roomCode - 6-character room code
 * @param {string} token - Host or Player authentication token
 * @param {string} [initialRoomId] - Optional room UUID if known upfront
 * @returns {{
 *   leaderboard: Array,
 *   roomId: string|null,
 *   roomStatus: string,
 *   loading: boolean,
 *   error: string|null,
 *   refreshLeaderboard: () => Promise<void>
 * }}
 */
export function useRoomLeaderboard(roomCode, token, initialRoomId = null) {
  const [leaderboard, setLeaderboard] = useState([]);
  const [roomId, setRoomId] = useState(initialRoomId);
  const [roomStatus, setRoomStatus] = useState('waiting');
  const [loading, setLoading] = useState(Boolean(roomCode && token));
  const [error, setError] = useState(null);
  const channelRef = useRef(null);
  const isInitialFetchDone = useRef(false);

  // Authoritative server fetch
  const fetchLeaderboard = useCallback(async () => {
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

      setRoomId(data.roomId);
      setRoomStatus(data.roomStatus);
      setLeaderboard(data.leaderboard || []);
      setError(null);
      isInitialFetchDone.current = true;
    } catch (err) {
      console.error('Failed to fetch leaderboard:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roomCode, token]);

  // Initial fetch on mount or credential change
  useEffect(() => {
    if (!roomCode || !token) return;
    fetchLeaderboard();
  }, [roomCode, token, fetchLeaderboard]);

  // Realtime subscription setup
  useEffect(() => {
    if (!roomId) return;

    const channelName = `leaderboard_players_${roomId}`;
    let hasSubscribedBefore = false;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'players',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (!payload.new) return;
          // Guard 3: Prevent stale data from overwriting newer scores (scores only increase in Quizzr)
          setLeaderboard((prev) => {
            const updated = prev.map((p) => {
              if (p.id === payload.new.id) {
                const safeScore = Math.max(p.score || 0, payload.new.score || 0);
                return { ...p, score: safeScore };
              }
              return p;
            });
            return computeStandardRanks(updated);
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'players',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (!payload.new) return;
          setLeaderboard((prev) => {
            if (prev.some((p) => p.id === payload.new.id)) return prev;
            const updated = [...prev, payload.new];
            return computeStandardRanks(updated);
          });
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error(`Realtime leaderboard error for room ${roomId}:`, err);
        }
        // Guard 2: Reconnection triggers authoritative refreshLeaderboard()
        if (status === 'SUBSCRIBED') {
          if (hasSubscribedBefore || isInitialFetchDone.current) {
            // Reconnection event or reconnection after network flap
            fetchLeaderboard();
          }
          hasSubscribedBefore = true;
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [roomId, fetchLeaderboard]);

  return {
    leaderboard,
    roomId,
    roomStatus,
    loading,
    error,
    refreshLeaderboard: fetchLeaderboard,
  };
}
