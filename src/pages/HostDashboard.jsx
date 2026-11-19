import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRoomContext } from '../context/RoomContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { Navbar } from '../components/ui/Navbar.jsx';
import { Card } from '../components/ui/Card.jsx';
import { Input } from '../components/ui/Input.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { GameBackground } from '../components/ui/GameBackground.jsx';

const TOPIC_SUGGESTIONS = [
  'Java Programming',
  'General Knowledge',
  'Science',
  'Sports',
  'Computer Science',
];

const DIFFICULTIES = [
  { id: 'easy', label: 'Easy' },
  { id: 'medium', label: 'Medium' },
  { id: 'hard', label: 'Hard' },
];

const QUESTION_COUNTS = [5, 10, 15];

/**
 * HostDashboard component for Stage 3A.
 * Provides Quiz Configuration (nickname, topic, difficulty, question count),
 * generates questions via the deployed `create-room` & `generate-questions` Edge Functions,
 * provides question preview and client-side editing/regeneration.
 */
export function HostDashboard() {
  const navigate = useNavigate();
  const { setSession, session } = useRoomContext();

  // Form state
  const [nickname, setNickname] = useState(session?.nickname || '');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [questionCount, setQuestionCount] = useState(5);

  // Workflow state
  const [isGenerating, setIsGenerating] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [generalError, setGeneralError] = useState(null);

  // Generated preview state
  const [questions, setQuestions] = useState([]);
  const [editingIndex, setEditingIndex] = useState(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [editedOptions, setEditedOptions] = useState([]);

  // Validate quiz configuration inputs
  const validate = () => {
    const errors = {};
    const cleanNick = nickname.trim();
    const cleanTopic = topic.trim();

    if (!cleanNick) {
      errors.nickname = 'Host nickname is required';
    } else if (cleanNick.length < 2) {
      errors.nickname = 'Nickname must be at least 2 characters';
    } else if (cleanNick.length > 20) {
      errors.nickname = 'Nickname cannot exceed 20 characters';
    }

    if (!cleanTopic) {
      errors.topic = 'Quiz topic is required';
    } else if (cleanTopic.length < 2) {
      errors.topic = 'Topic must be at least 2 characters';
    } else if (cleanTopic.length > 100) {
      errors.topic = 'Topic cannot exceed 100 characters';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * Executes question generation:
   * 1. Validates inputs.
   * 2. Calls `create-room` to obtain room code & host token (as required by the backend auth contract).
   * 3. Stores session in RoomContext.
   * 4. Calls `generate-questions` with roomCode, hostToken, topic, difficulty, and questionCount.
   * 5. Populates preview questions.
   */
  const handleGenerate = async (e) => {
    if (e) e.preventDefault();
    setGeneralError(null);

    if (!validate() || isGenerating) return;

    setIsGenerating(true);

    try {
      const cleanNick = nickname.trim();
      const cleanTopic = topic.trim();

      // Step 1: Create room to authorize question generation
      const { data: createData, error: createErr } = await supabase.functions.invoke('create-room', {
        body: { nickname: cleanNick },
      });

      if (createErr || !createData || !createData.room || !createData.hostToken) {
        throw new Error(createErr?.message || 'Failed to initialize quiz session on server');
      }

      // Step 2: Establish Host Session in RoomContext
      setSession({
        roomCode: createData.room.roomCode,
        roomId: createData.room.id,
        isHost: true,
        hostToken: createData.hostToken,
        playerToken: createData.playerToken,
        playerId: createData.hostPlayer.id,
        nickname: createData.hostPlayer.nickname,
      });

      // Step 3: Invoke AI Question Generation
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
        let userMessage = null;

        // 1. Safely extract error payload from response clone
        if (genErr?.context) {
          try {
            const responseClone =
              typeof genErr.context.clone === 'function'
                ? genErr.context.clone()
                : genErr.context;

            if (typeof responseClone.text === 'function') {
              const rawText = await responseClone.text();
              if (rawText) {
                try {
                  const parsed = JSON.parse(rawText);
                  if (parsed?.error) {
                    userMessage = parsed.error;
                  } else if (parsed?.message) {
                    userMessage = parsed.message;
                  }
                } catch {
                  // Fall back to clean non-HTML plain text
                  if (
                    rawText.length > 0 &&
                    rawText.length < 200 &&
                    !rawText.includes('<html') &&
                    !rawText.includes('<!DOCTYPE')
                  ) {
                    userMessage = rawText.trim();
                  }
                }
              }
            }
          } catch {
            // Stream read fallback
          }
        }

        // 2. Map by HTTP status code or provide descriptive fallback instead of generic SDK message
        if (!userMessage || userMessage.includes('non-2xx status code')) {
          const status = genErr?.context?.status;
          if (status === 429) {
            userMessage = 'AI generation service rate limit reached. Please wait a moment before trying again.';
          } else if (status === 503) {
            userMessage = 'AI servers are currently experiencing high demand. Please try again shortly.';
          } else if (status === 504 || status === 524) {
            userMessage = 'Quiz generation timed out. Try generating fewer questions or a simpler topic.';
          } else if (status === 401 || status === 403) {
            userMessage = 'Authorization failed on quiz generation service. Please try again.';
          } else {
            userMessage = 'AI generation service failed to generate questions. Please try again.';
          }
        }

        throw new Error(userMessage);
      }

      setQuestions(genData.questions || []);
    } catch (err) {
      setGeneralError(err.message || 'An unexpected error occurred during quiz generation.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Start editing a specific question in the preview
  const handleStartEdit = (index) => {
    setEditingIndex(index);
    setEditedPrompt(questions[index].prompt);
    setEditedOptions([...questions[index].options]);
  };

  // Save edits locally in preview
  const handleSaveEdit = (index) => {
    const updated = [...questions];
    updated[index] = {
      ...updated[index],
      prompt: editedPrompt.trim() || updated[index].prompt,
      options: editedOptions.map((opt, i) => opt.trim() || updated[index].options[i]),
    };
    setQuestions(updated);
    setEditingIndex(null);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
  };

  return (
    <GameBackground>
      <Navbar
        isHost
        onExit={() => navigate('/')}
      />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-[#6C9AE8]">
              Host Setup
            </span>
            <span className="text-xs text-[#A1A6AD]">•</span>
            <span className="text-xs text-[#A1A6AD]">Stage 3A: Configuration & Preview</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-[#F4F3EF] mb-2">
            Create your quiz
          </h1>
          <p className="text-sm text-[#A1A6AD]">
            Choose a topic, set the difficulty, and let AI build your quiz.
          </p>
        </div>

        {generalError && (
          <div
            role="alert"
            className="mb-6 p-4 text-xs rounded border border-[#D96868]/40 bg-[#D96868]/10 text-[#D96868] flex items-center justify-between"
          >
            <span>{generalError}</span>
            <button
              type="button"
              onClick={() => setGeneralError(null)}
              className="text-[#D96868] hover:text-[#F4F3EF] ml-2 text-base font-semibold"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        {/* Configuration Form Card (hidden or collapsed if questions generated) */}
        {questions.length === 0 ? (
          <Card variant="primary" className="p-6 sm:p-8">
            <form onSubmit={handleGenerate} className="flex flex-col gap-6" noValidate>
              {/* Host Nickname */}
              <div>
                <Input
                  id="host-nickname"
                  label="Host Nickname"
                  placeholder="e.g. QuizMaster"
                  value={nickname}
                  onChange={(e) => {
                    setNickname(e.target.value.slice(0, 20));
                    if (formErrors.nickname) setFormErrors((p) => ({ ...p, nickname: null }));
                  }}
                  error={formErrors.nickname}
                  helperText="Your display name in the quiz session (2-20 chars)"
                  disabled={isGenerating}
                  maxLength={20}
                  required
                />
              </div>

              {/* Quiz Topic */}
              <div>
                <Input
                  id="quiz-topic"
                  label="Quiz Topic"
                  placeholder="e.g. World Capitals, Modern Physics, 90s Hip Hop"
                  value={topic}
                  onChange={(e) => {
                    setTopic(e.target.value.slice(0, 100));
                    if (formErrors.topic) setFormErrors((p) => ({ ...p, topic: null }));
                  }}
                  error={formErrors.topic}
                  helperText="Any subject or domain you want questions generated for"
                  disabled={isGenerating}
                  maxLength={100}
                  required
                />

                {/* Topic suggestions */}
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-[#A1A6AD] mr-1">Suggestions:</span>
                  {TOPIC_SUGGESTIONS.map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => {
                        setTopic(sug);
                        if (formErrors.topic) setFormErrors((p) => ({ ...p, topic: null }));
                      }}
                      className="px-2.5 py-1 text-xs rounded bg-[#22262A] text-[#A1A6AD] border border-[#30353A] hover:text-[#F4F3EF] hover:border-[#6C9AE8]/40 hover:bg-[#2c3136] transition-colors"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty & Question Count Grids */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Difficulty Selector */}
                <div>
                  <label className="text-xs font-medium text-[#A1A6AD] tracking-wide block mb-2">
                    Difficulty Level
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {DIFFICULTIES.map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        disabled={isGenerating}
                        onClick={() => setDifficulty(d.id)}
                        className={`py-2 px-3 text-xs font-medium rounded border transition-colors ${
                          difficulty === d.id
                            ? 'bg-[#6C9AE8] text-[#111315] border-[#6C9AE8] font-semibold'
                            : 'bg-[#22262A] text-[#A1A6AD] border-[#30353A] hover:bg-[#2c3136] hover:text-[#F4F3EF]'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Question Count Selector */}
                <div>
                  <label className="text-xs font-medium text-[#A1A6AD] tracking-wide block mb-2">
                    Question Count
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {QUESTION_COUNTS.map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        disabled={isGenerating}
                        onClick={() => setQuestionCount(cnt)}
                        className={`py-2 px-3 text-xs font-medium rounded border transition-colors ${
                          questionCount === cnt
                            ? 'bg-[#6C9AE8] text-[#111315] border-[#6C9AE8] font-semibold'
                            : 'bg-[#22262A] text-[#A1A6AD] border-[#30353A] hover:bg-[#2c3136] hover:text-[#F4F3EF]'
                        }`}
                      >
                        {cnt} Questions
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Submit CTA */}
              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={isGenerating}
                  className="w-full"
                >
                  {isGenerating ? (
                    <span className="flex items-center gap-2">
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-[#111315]"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Generating Quiz with AI...
                    </span>
                  ) : (
                    'Generate Questions'
                  )}
                </Button>
              </div>
            </form>
          </Card>
        ) : (
          /* Question Preview Section */
          <div className="flex flex-col gap-6">
            {/* Action Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-[#1A1D20] p-4 rounded-lg border border-[#30353A]">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-[#F4F3EF]">{topic}</span>
                  <Badge variant="accent">{difficulty.toUpperCase()}</Badge>
                  <Badge variant="neutral">{questions.length} Questions</Badge>
                </div>
                <p className="text-xs text-[#A1A6AD] mt-1">
                  Preview generated questions below. You can review and edit question text.
                </p>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setQuestions([])}
                  disabled={isGenerating}
                >
                  Change Config
                </Button>
              </div>
            </div>

            {/* Questions List */}
            <div className="flex flex-col gap-4">
              {questions.map((q, idx) => {
                const isEditing = editingIndex === idx;

                return (
                  <Card key={idx} variant="secondary" className="p-5">
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono px-2 py-0.5 rounded bg-[#111315] text-[#6C9AE8] border border-[#30353A]">
                          Q{idx + 1}
                        </span>
                        {!isEditing && (
                          <h3 className="text-sm font-medium text-[#F4F3EF]">
                            {q.prompt}
                          </h3>
                        )}
                      </div>

                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => handleStartEdit(idx)}
                          className="text-xs text-[#A1A6AD] hover:text-[#6C9AE8] transition-colors"
                        >
                          Edit
                        </button>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSaveEdit(idx)}
                            className="text-xs text-[#35B58A] font-semibold hover:underline"
                          >
                            Done
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEdit}
                            className="text-xs text-[#A1A6AD] hover:text-[#F4F3EF]"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Question Content / Edit mode */}
                    {isEditing ? (
                      <div className="flex flex-col gap-3 mt-2">
                        <div>
                          <label className="text-xs text-[#A1A6AD] block mb-1">Question Prompt</label>
                          <input
                            type="text"
                            value={editedPrompt}
                            onChange={(e) => setEditedPrompt(e.target.value)}
                            className="w-full px-3 py-1.5 rounded bg-[#111315] text-[#F4F3EF] border border-[#30353A] text-sm focus:outline-none focus:border-[#6C9AE8]"
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                          {editedOptions.map((opt, oIdx) => (
                            <div key={oIdx} className="flex items-center gap-2">
                              <span className="text-xs font-mono text-[#A1A6AD] w-4">
                                {String.fromCharCode(65 + oIdx)}:
                              </span>
                              <input
                                type="text"
                                value={opt}
                                onChange={(e) => {
                                  const updated = [...editedOptions];
                                  updated[oIdx] = e.target.value;
                                  setEditedOptions(updated);
                                }}
                                className="flex-1 px-2.5 py-1 rounded bg-[#111315] text-[#F4F3EF] border border-[#30353A] text-xs focus:outline-none focus:border-[#6C9AE8]"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                        {q.options.map((opt, oIdx) => (
                          <div
                            key={oIdx}
                            className="flex items-center gap-2 px-3 py-2 rounded bg-[#1A1D20] border border-[#30353A] text-xs text-[#A1A6AD]"
                          >
                            <span className="font-mono text-[#6C9AE8] font-semibold">
                              {String.fromCharCode(65 + oIdx)}
                            </span>
                            <span className="text-[#F4F3EF]">{opt}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>

            {/* Stage 3B: Continue to Waiting Room Finalization */}
            <div className="p-6 rounded-lg border border-[#30353A] bg-[#1A1D20] flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h4 className="text-sm font-semibold text-[#F4F3EF] mb-1">
                  Ready to host the quiz?
                </h4>
                <p className="text-xs text-[#A1A6AD]">
                  Questions are saved. Proceed to the Waiting Room to gather players and launch when ready.
                </p>
              </div>
              <Button
                variant="primary"
                size="lg"
                onClick={() => {
                  if (session?.isHost && session?.roomCode && session?.hostToken) {
                    navigate(`/room/${session.roomCode}`);
                  } else {
                    setGeneralError('Host session is missing or invalid. Please configure the quiz again.');
                  }
                }}
                className="w-full sm:w-auto whitespace-nowrap min-w-[200px]"
              >
                Continue to Waiting Room →
              </Button>
            </div>
          </div>
        )}
      </main>
    </GameBackground>
  );
}

