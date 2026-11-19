import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomContext } from '../context/RoomContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { Input } from './ui/Input.jsx';
import { Button } from './ui/Button.jsx';
import { AvatarSelector } from './ui/AvatarSelector.jsx';

/**
 * JoinRoomForm component matching reference video styling:
 * - Avatar selection
 * - Compact nickname input
 * - 6-character room code input
 * - High-contrast action CTA
 */
export function JoinRoomForm({ defaultRoomCode = '', onSuccess }) {
  const navigate = useNavigate();
  const { setSession } = useRoomContext();

  const [avatar, setAvatar] = useState('cat-detective');
  const [roomCode, setRoomCode] = useState(defaultRoomCode);
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [generalError, setGeneralError] = useState(null);

  // Validate room code: exactly 6 alphanumeric uppercase characters
  const handleRoomCodeChange = (e) => {
    const cleaned = e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
    setRoomCode(cleaned);
    if (errors.roomCode) setErrors((prev) => ({ ...prev, roomCode: null }));
    if (generalError) setGeneralError(null);
  };

  // Validate nickname: max 20 chars
  const handleNicknameChange = (e) => {
    const val = e.target.value.slice(0, 20);
    setNickname(val);
    if (errors.nickname) setErrors((prev) => ({ ...prev, nickname: null }));
    if (generalError) setGeneralError(null);
  };

  const validate = () => {
    const newErrors = {};
    const trimmedNick = nickname.trim();

    if (!trimmedNick) {
      newErrors.nickname = 'Nickname is required';
    } else if (trimmedNick.length < 2) {
      newErrors.nickname = 'Nickname must be at least 2 characters';
    } else if (trimmedNick.length > 20) {
      newErrors.nickname = 'Nickname must be 20 characters or less';
    }

    if (!roomCode) {
      newErrors.roomCode = 'Room code is required';
    } else if (roomCode.length !== 6) {
      newErrors.roomCode = 'Room code must be exactly 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGeneralError(null);

    if (!validate() || loading) return;

    setLoading(true);

    try {
      const cleanCode = roomCode.trim().toUpperCase();
      const cleanNick = nickname.trim();

      const { data, error: fnError } = await supabase.functions.invoke('join-room', {
        body: {
          room_code: cleanCode,
          nickname: cleanNick,
        },
      });

      if (fnError) {
        let errorMsg = fnError.message || 'Failed to join room';
        if (fnError.context && typeof fnError.context.json === 'function') {
          try {
            const body = await fnError.context.json();
            if (body?.error) errorMsg = body.error;
          } catch {
            // Keep default
          }
        }
        throw new Error(errorMsg);
      }

      if (!data || !data.room || !data.player || !data.playerToken) {
        throw new Error('Unexpected response format from server');
      }

      setSession({
        roomCode: data.room.roomCode,
        roomId: data.room.id,
        isHost: false,
        playerToken: data.playerToken,
        hostToken: null,
        playerId: data.player.id,
        nickname: data.player.nickname,
      });

      if (onSuccess) {
        onSuccess(data);
      } else {
        navigate(`/room/${data.room.roomCode}`);
      }
    } catch (err) {
      setGeneralError(err.message || 'Unable to join the room. Please check the code.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Optional Avatar Selection */}
      <AvatarSelector selectedId={avatar} onSelect={setAvatar} />

      {/* Nickname Input */}
      <Input
        label="Your Nickname"
        id="player-nickname-input"
        placeholder="e.g. ShadowRider"
        value={nickname}
        onChange={handleNicknameChange}
        error={errors.nickname}
        disabled={loading}
        required
      />

      {/* Room Code Input */}
      <Input
        label="Room Code"
        id="room-code-input"
        placeholder="6-character code"
        value={roomCode}
        onChange={handleRoomCodeChange}
        error={errors.roomCode}
        disabled={loading}
        required
        maxLength={6}
        className="font-mono tracking-widest uppercase"
      />

      {/* General Error Banner */}
      {generalError && (
        <div
          role="alert"
          className="p-3 text-xs rounded-xl border border-red-500/30 bg-red-950/30 text-red-300 font-medium leading-relaxed"
        >
          {generalError}
        </div>
      )}

      {/* Submit Action */}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={loading}
        className="w-full mt-1"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Entering Room...
          </span>
        ) : (
          'Join Room'
        )}
      </Button>
    </form>
  );
}
