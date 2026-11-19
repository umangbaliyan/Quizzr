import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameBackground } from '../components/ui/GameBackground.jsx';
import { Card } from '../components/ui/Card.jsx';
import { JoinRoomForm } from '../components/JoinRoomForm.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Input } from '../components/ui/Input.jsx';
import { AvatarSelector } from '../components/ui/AvatarSelector.jsx';
import { useRoomContext } from '../context/RoomContext.jsx';
import { supabase } from '../lib/supabaseClient.js';

const QUICK_TOPICS = ['Gaming & Esports', 'Science & Space', 'Movies & Pop Culture', 'World History'];

/**
 * Compact Create Quiz Form directly integrated into the landing card tabs
 */
function QuickCreateForm() {
  const navigate = useNavigate();
  const { setSession } = useRoomContext();

  const [avatar, setAvatar] = useState('cat-wizard');
  const [nickname, setNickname] = useState('');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [questionCount, setQuestionCount] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState({});
  const [generalError, setGeneralError] = useState(null);

  const validate = () => {
    const errs = {};
    const cleanNick = nickname.trim();
    const cleanTopic = topic.trim();

    if (!cleanNick) errs.nickname = 'Host nickname is required';
    else if (cleanNick.length < 2) errs.nickname = 'At least 2 characters';

    if (!cleanTopic) errs.topic = 'Topic is required';
    else if (cleanTopic.length < 2) errs.topic = 'At least 2 characters';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setGeneralError(null);
    if (!validate() || isGenerating) return;

    setIsGenerating(true);

    try {
      const cleanNick = nickname.trim();
      const cleanTopic = topic.trim();

      // 1. Create room
      const { data: createData, error: createErr } = await supabase.functions.invoke('create-room', {
        body: { nickname: cleanNick },
      });

      if (createErr || !createData || !createData.room || !createData.hostToken) {
        throw new Error(createErr?.message || 'Failed to initialize room on server');
      }

      // 2. Establish Session
      setSession({
        roomCode: createData.room.roomCode,
        roomId: createData.room.id,
        isHost: true,
        hostToken: createData.hostToken,
        playerToken: createData.playerToken,
        playerId: createData.hostPlayer.id,
        nickname: createData.hostPlayer.nickname,
      });

      // 3. Generate questions
      const { data: genData, error: genErr } = await supabase.functions.invoke('generate-questions', {
        body: {
          room_code: createData.room.roomCode,
          host_token: createData.hostToken,
          topic: cleanTopic,
          difficulty: difficulty,
          question_count: questionCount,
        },
      });

      if (genErr || !genData || !genData.questions) {
        let msg = genErr?.message || 'Failed to generate questions';
        if (genErr?.context && typeof genErr.context.json === 'function') {
          try {
            const body = await genErr.context.json();
            if (body?.error) msg = body.error;
          } catch {
            // Keep default
          }
        }
        throw new Error(msg);
      }

      // 4. Navigate directly to waiting room
      navigate(`/room/${createData.room.roomCode}`);
    } catch (err) {
      setGeneralError(err.message || 'Error creating game room');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <form onSubmit={handleCreate} className="flex flex-col gap-4">
      <AvatarSelector selectedId={avatar} onSelect={setAvatar} />

      <Input
        label="Host Nickname"
        id="host-nickname-quick"
        placeholder="e.g. QuizMaster"
        value={nickname}
        onChange={(e) => {
          setNickname(e.target.value.slice(0, 20));
          if (errors.nickname) setErrors((prev) => ({ ...prev, nickname: null }));
        }}
        error={errors.nickname}
        disabled={isGenerating}
        required
      />

      <div>
        <Input
          label="Quiz Topic"
          id="quiz-topic-quick"
          placeholder="e.g. 90s Video Games, Astrophysics"
          value={topic}
          onChange={(e) => {
            setTopic(e.target.value.slice(0, 100));
            if (errors.topic) setErrors((prev) => ({ ...prev, topic: null }));
          }}
          error={errors.topic}
          disabled={isGenerating}
          required
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {QUICK_TOPICS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTopic(t);
                if (errors.topic) setErrors((prev) => ({ ...prev, topic: null }));
              }}
              className="text-[11px] px-2 py-0.5 rounded-lg bg-[#0F0B42]/50 text-[#93C5FD] border border-[#231B68] hover:border-[#3B82F6]/50 hover:bg-[#171259]/60 transition-colors"
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="quick-difficulty" className="text-xs font-semibold text-[#A5A6C2] uppercase tracking-wider block mb-1.5">
            Difficulty
          </label>
          <select
            id="quick-difficulty"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            disabled={isGenerating}
            className="w-full px-3 py-2.5 rounded-xl bg-[#0B0617] text-[#F3F4F6] border border-[#2D1F4C] text-sm focus:outline-none focus:border-[#4338CA] focus:ring-2 focus:ring-[#3B349E]/25"
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>

        <div>
          <label htmlFor="quick-qcount" className="text-xs font-semibold text-[#A5A6C2] uppercase tracking-wider block mb-1.5">
            Questions
          </label>
          <select
            id="quick-qcount"
            value={questionCount}
            onChange={(e) => setQuestionCount(Number(e.target.value))}
            disabled={isGenerating}
            className="w-full px-3 py-2.5 rounded-xl bg-[#0B0617] text-[#F3F4F6] border border-[#2D1F4C] text-sm focus:outline-none focus:border-[#4338CA] focus:ring-2 focus:ring-[#3B349E]/25"
          >
            <option value={5}>5 Questions</option>
            <option value={10}>10 Questions</option>
            <option value={15}>15 Questions</option>
          </select>
        </div>
      </div>

      {generalError && (
        <div role="alert" className="p-3 text-xs rounded-xl border border-red-500/30 bg-red-950/30 text-red-300 font-medium">
          {generalError}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        size="lg"
        disabled={isGenerating}
        className="w-full mt-1"
      >
        {isGenerating ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Generating AI Quiz...
          </span>
        ) : (
          'Create & Launch Room'
        )}
      </Button>

      <button
        type="button"
        onClick={() => navigate('/host')}
        className="text-xs text-purple-400/80 hover:text-purple-300 text-center transition-colors underline-offset-2 hover:underline"
      >
        Advanced Question Preview & Editor →
      </button>
    </form>
  );
}

/**
 * Compact, Centered Landing Page matching reference video layout:
 * - Logo + Tagline at the top of the central composition
 * - Compact centered card with Room icon header
 * - Create & Join dual tab toggle
 * - Entire view comfortably fits on 1366x768 and 1920x1080 without scrolling
 */
export function LandingPage() {
  const [activeTab, setActiveTab] = useState('join'); // 'create' | 'join'

  return (
    <GameBackground className="flex items-center justify-center p-4 min-h-screen">
      <div className="w-full max-w-[460px] mx-auto flex flex-col items-center my-auto py-6">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex items-center gap-3 mb-1.5">
            {/* Visual Logo Mascot / Badge */}
            <img
              src="/logo.png"
              alt="Quizzr logo"
              className="w-12 h-12 sm:w-14 sm:h-14 object-contain select-none transition-transform hover:scale-105"
            />
            <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white drop-shadow-md">
              Quizzr
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-purple-200/80 font-medium max-w-sm">
            Real-time AI-powered multiplayer quiz challenge.
          </p>
        </div>

        {/* Central Compact Interactive Card */}
        <Card variant="primary" className="w-full p-6 sm:p-7 border-[#2E204E]/90 bg-[#110B22]/95 shadow-2xl">
          {/* Card Header & Room Title */}
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-[#251A40]">
            <div className="flex items-center gap-2">
              <span className="text-base select-none">🎮</span>
              <span className="text-sm font-bold text-white tracking-wide">
                Game Lobby
              </span>
            </div>
            <span className="text-[11px] text-purple-300/60 font-semibold uppercase tracking-wider">
              Multiplayer
            </span>
          </div>

          {/* Create & Join Segmented Tabs */}
          <div className="grid grid-cols-2 p-1 rounded-xl bg-[#090514] border border-[#251A40] mb-5">
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'create'
                  ? 'bg-gradient-to-r from-[#0F0B42] to-[#0B083F] text-white shadow-md shadow-[#0B083F]/60 border border-[#231B68]/60'
                  : 'text-[#A5A6C2] hover:text-white hover:bg-white/5'
              }`}
            >
              <span>🌐</span>
              <span>Create</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('join')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all ${
                activeTab === 'join'
                  ? 'bg-gradient-to-r from-[#0F0B42] to-[#0B083F] text-white shadow-md shadow-[#0B083F]/60 border border-[#231B68]/60'
                  : 'text-[#A5A6C2] hover:text-white hover:bg-white/5'
              }`}
            >
              <span>🔑</span>
              <span>Join</span>
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'join' ? (
            <JoinRoomForm />
          ) : (
            <QuickCreateForm />
          )}
        </Card>

        {/* Footer info */}
        <div className="flex items-center justify-center gap-3 text-[11px] text-purple-300/50 font-medium mt-6">
          <span>Instant AI Generation</span>
          <span>•</span>
          <span>Synchronized Timers</span>
          <span>•</span>
          <span>Live Rankings</span>
        </div>
      </div>
    </GameBackground>
  );
}
