import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

const SESSION_KEY = 'quizzr_session';

const RoomContext = createContext(null);

/**
 * Validates the structure of a session candidate object.
 */
function isValidSession(data) {
  if (!data || typeof data !== 'object') return false;
  const { roomCode, roomId, playerToken, nickname } = data;
  if (!roomCode || typeof roomCode !== 'string' || roomCode.trim().length !== 6) return false;
  if (!roomId || typeof roomId !== 'string') return false;
  if (!playerToken || typeof playerToken !== 'string') return false;
  if (!nickname || typeof nickname !== 'string') return false;
  return true;
}

export function RoomProvider({ children }) {
  const [session, setSessionState] = useState(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      if (isValidSession(parsed)) {
        return {
          roomCode: parsed.roomCode.trim().toUpperCase(),
          roomId: parsed.roomId,
          isHost: Boolean(parsed.isHost),
          hostToken: parsed.hostToken || null,
          playerToken: parsed.playerToken,
          playerId: parsed.playerId || null,
          nickname: parsed.nickname.trim(),
        };
      }
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    } catch {
      return null;
    }
  });

  const [isRestored, setIsRestored] = useState(true);

  /**
   * Updates in-memory session state and synchronizes with sessionStorage.
   */
  const setSession = useCallback((data) => {
    if (!data || !isValidSession(data)) {
      console.warn('Attempted to set an invalid session format');
      return false;
    }

    const normalized = {
      roomCode: data.roomCode.trim().toUpperCase(),
      roomId: data.roomId,
      isHost: Boolean(data.isHost),
      hostToken: data.hostToken || null,
      playerToken: data.playerToken,
      playerId: data.playerId || null,
      nickname: data.nickname.trim(),
    };

    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
      setSessionState(normalized);
      return true;
    } catch (err) {
      console.error('Failed to save session to sessionStorage:', err);
      return false;
    }
  }, []);

  /**
   * Clears session only on explicit exit or confirmed kick/leave.
   */
  const clearSession = useCallback(() => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (err) {
      console.error('Failed to clear sessionStorage:', err);
    }
    setSessionState(null);
  }, []);

  /**
   * Explicitly re-reads and restores session from sessionStorage if needed.
   */
  const restoreSession = useCallback(() => {
    try {
      const stored = sessionStorage.getItem(SESSION_KEY);
      if (!stored) {
        setSessionState(null);
        return null;
      }
      const parsed = JSON.parse(stored);
      if (isValidSession(parsed)) {
        const normalized = {
          roomCode: parsed.roomCode.trim().toUpperCase(),
          roomId: parsed.roomId,
          isHost: Boolean(parsed.isHost),
          hostToken: parsed.hostToken || null,
          playerToken: parsed.playerToken,
          playerId: parsed.playerId || null,
          nickname: parsed.nickname.trim(),
        };
        setSessionState(normalized);
        return normalized;
      }
      sessionStorage.removeItem(SESSION_KEY);
      setSessionState(null);
      return null;
    } catch {
      setSessionState(null);
      return null;
    } finally {
      setIsRestored(true);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const value = {
    session,
    isRestored,
    roomCode: session?.roomCode || null,
    roomId: session?.roomId || null,
    isHost: Boolean(session?.isHost),
    hostToken: session?.hostToken || null,
    playerToken: session?.playerToken || null,
    playerId: session?.playerId || null,
    nickname: session?.nickname || null,
    setSession,
    clearSession,
    restoreSession,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoomContext() {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoomContext must be used within a RoomProvider');
  }
  return context;
}

