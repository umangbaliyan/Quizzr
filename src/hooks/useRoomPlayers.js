import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient.js';

/**
 * Custom React hook for live player synchronization in a room.
 * Handles initial fetch, Realtime INSERT (player joins), and Realtime DELETE (player leaves/kicked).
 * 
 * @param {string} roomId - UUID of the room
 * @returns {{
 *   players: Array,
 *   loading: boolean,
 *   error: string|null,
 *   refreshPlayers: () => Promise<void>
 * }}
 */
export function useRoomPlayers(roomId) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(Boolean(roomId));
  const [error, setError] = useState(null);
  const channelRef = useRef(null);

  const fetchPlayers = useCallback(async () => {
    if (!roomId) return;
    try {
      const { data, error: fetchErr } = await supabase
        .from('players')
        .select('id, room_id, nickname, score, is_host, joined_at')
        .eq('room_id', roomId)
        .order('joined_at', { ascending: true });

      if (fetchErr) throw fetchErr;
      setPlayers(data || []);
      setError(null);
    } catch (err) {
      console.error('Failed to fetch room players:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    // 1. Initial player list fetch
    fetchPlayers();

    // 2. Setup Realtime subscription for INSERT and DELETE events
    const channelName = `room_players_${roomId}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'players',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          if (!payload.new || payload.new.room_id !== roomId) return;
          setPlayers((prev) => {
            if (prev.some((p) => p.id === payload.new.id)) {
              return prev;
            }
            return [...prev, payload.new];
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'players',
        },
        (payload) => {
          if (!payload.old || !payload.old.id) return;
          setPlayers((prev) => prev.filter((p) => p.id !== payload.old.id));
        }
      )
      .subscribe((status, err) => {
        if (err) {
          console.error(`Realtime subscription error for room ${roomId}:`, err);
        }
      });

    channelRef.current = channel;

    // 3. Cleanup channel on unmount
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [roomId, fetchPlayers]);

  return {
    players,
    loading,
    error,
    refreshPlayers: fetchPlayers,
  };
}
