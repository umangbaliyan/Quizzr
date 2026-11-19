import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { useRoomLeaderboard } from '../hooks/useRoomLeaderboard.js';
import { Navbar } from '../components/ui/Navbar.jsx';
import { Card } from '../components/ui/Card.jsx';
import { Badge } from '../components/ui/Badge.jsx';
import { GameBackground } from '../components/ui/GameBackground.jsx';

/**
 * QuizScreen component for Stage 5:
 * - Active Question display & synchronized timer.
 * - Answer submission with instant lock & backend scoring feedback.
 * - Secure Correct Answer Reveal & Explanation via `get-question-reveal` Edge Function
 *   (Strictly unlocked ONLY after the question deadline has expired).
 * - Brief 2-second answer-reveal period (NO intermission, NO leaderboard between questions).
 * - Host automatically advances via `next-question` once the 2-second reveal completes.
 * - Live total score display maintained via `useRoomLeaderboard` (ranks hidden until final results).
 *
 * @param {{
 *   quizState: {
 *     roomStatus: string,
 *     currentQuestionIndex: number,
 *     totalQuestions: number,
 *     questionDeadline: string|null,
 *     questionDurationSeconds: number,
 *     remainingSeconds: number,
 *     question: { id: string, prompt: string, options: string[], questionOrder: number }|null
 *   },
 *   session: {
 *     roomCode: string,
 *     roomId: string,
 *     isHost: boolean,
 *     playerToken: string,
 *     hostToken: string|null,
 *     playerId: string,
 *     nickname: string
 *   },
 *   onExit: () => void
 * }} props
 */
export function QuizScreen({ quizState, session, onExit, onBroadcast }) {
  const {
    roomStatus,
    currentQuestionIndex,
    totalQuestions,
    questionDurationSeconds = 20,
    remainingSeconds = 0,
    question,
    allPlayersAnswered = false,
    userSubmission = null,
  } = quizState;

  // Active question interaction state
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(null);
  const [submittedForQuestionId, setSubmittedForQuestionId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);
  const [submissionFeedback, setSubmissionFeedback] = useState(null); // { isCorrect: boolean, pointsAwarded: number }

  // Answer Reveal state (Revealed when all answered or deadline expired)
  const [revealedAnswer, setRevealedAnswer] = useState(null); // { correctOptionIndex: number }
  const [isFetchingReveal, setIsFetchingReveal] = useState(false);
  const [revealPeriodEnded, setRevealPeriodEnded] = useState(false);
  const revealTimeoutRef = useRef(null);

  // Advancement guard refs (host-only)
  const advancingQuestionIndexRef = useRef(null);
  const isAdvancingRef = useRef(false);

  // Restore submission state on mount / reconnect if user already submitted for current question
  useEffect(() => {
    if (question?.id && userSubmission?.hasSubmitted) {
      setSubmittedForQuestionId(question.id);
      if (userSubmission.selectedOptionIndex !== null && selectedOptionIndex === null) {
        setSelectedOptionIndex(userSubmission.selectedOptionIndex);
      }
      if (userSubmission.isCorrect !== null && !submissionFeedback) {
        setSubmissionFeedback({
          isCorrect: userSubmission.isCorrect,
          pointsAwarded: userSubmission.pointsAwarded || 0,
        });
      }
    }
  }, [question?.id, userSubmission, selectedOptionIndex, submissionFeedback]);

  // Consume live leaderboard for Realtime synchronized player score (ranks hidden until completion)
  const activeToken = session?.playerToken || session?.hostToken;
  const { leaderboard } = useRoomLeaderboard(session?.roomCode, activeToken, session?.roomId);

  // Find current player in live leaderboard to track total score
  const currentPlayerStats = leaderboard.find((p) => p.id === session?.playerId);
  const currentTotalScore = currentPlayerStats?.score ?? 0;

  // Reset state on new question
  useEffect(() => {
    if (question?.id && submittedForQuestionId !== question.id) {
      setSelectedOptionIndex(null);
      setSubmissionFeedback(null);
      setRevealedAnswer(null);
      setRevealPeriodEnded(false);
      setIsSubmitting(false);
      setSubmissionError(null);
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
        revealTimeoutRef.current = null;
      }
    }
  }, [question?.id, submittedForQuestionId]);

  const isTimeExpired = remainingSeconds <= 0;
  const isAnswered = submittedForQuestionId === question?.id;
  const isInputLocked = isAnswered || isSubmitting || isTimeExpired;

  // Handle option selection and submission
  const handleSelectOption = async (optionIndex) => {
    if (isInputLocked || !question?.id || !session?.playerToken || !session?.roomCode) {
      return;
    }

    setSelectedOptionIndex(optionIndex);
    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('submit-answer', {
        body: {
          room_code: session.roomCode,
          question_id: question.id,
          selected_option_index: optionIndex,
          player_token: session.playerToken,
        },
      });

      if (fnErr) {
        let msg = fnErr.message || 'Failed to submit answer';
        if (fnErr.context && typeof fnErr.context.json === 'function') {
          try {
            const body = await fnErr.context.json();
            if (body?.error) msg = body.error;
          } catch {
            // keep default
          }
        }
        throw new Error(msg);
      }

      setSubmittedForQuestionId(question.id);
      if (data && typeof data.isCorrect === 'boolean') {
        setSubmissionFeedback({
          isCorrect: data.isCorrect,
          pointsAwarded: data.pointsAwarded || 0,
        });
      }

      // Notify all peers immediately that an answer was submitted
      if (typeof onBroadcast === 'function') {
        onBroadcast({ type: 'ANSWER_SUBMITTED', questionId: question.id, playerId: session?.playerId });
      }
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('already submitted')) {
        setSubmittedForQuestionId(question.id);
      } else {
        setSubmissionError(err.message || 'Failed to submit answer');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Progression trigger conditions:
  // Advancing is triggered when EITHER:
  // 1. All players in the room have submitted answers (`allPlayersAnswered`), OR
  // 2. The server deadline has expired (`isTimeExpired`).
  const shouldAdvanceQuestion = allPlayersAnswered || isTimeExpired;

  // Fetch answer reveal when all players answered or question timer expired
  useEffect(() => {
    if (
      shouldAdvanceQuestion &&
      question?.id &&
      !revealedAnswer &&
      !isFetchingReveal &&
      roomStatus === 'active'
    ) {
      setIsFetchingReveal(true);

      const fetchReveal = async () => {
        try {
          const { data, error: revErr } = await supabase.functions.invoke('get-question-reveal', {
            body: {
              room_code: session.roomCode,
              question_id: question.id,
              player_token: session.playerToken || undefined,
              host_token: session.hostToken || undefined,
            },
          });

          if (!revErr && data?.success) {
            setRevealedAnswer({
              correctOptionIndex: data.correctOptionIndex,
            });

            // Brief reveal period before moving forward
            revealTimeoutRef.current = setTimeout(() => {
              setRevealPeriodEnded(true);
            }, 1000);
          }
        } catch (err) {
          console.error('Error fetching question reveal:', err);
          revealTimeoutRef.current = setTimeout(() => {
            setRevealPeriodEnded(true);
          }, 1000);
        } finally {
          setIsFetchingReveal(false);
        }
      };

      fetchReveal();
    }
  }, [shouldAdvanceQuestion, question?.id, revealedAnswer, isFetchingReveal, roomStatus, session?.roomCode, session?.playerToken, session?.hostToken]);

  // Automatic question progression after brief reveal (Host-only)
  useEffect(() => {
    // Only proceed if:
    // 1. Room is active
    // 2. The reveal period has ended
    // 3. Current user is verified host
    // 4. This question index has not already been advanced
    if (
      roomStatus !== 'active' ||
      !revealPeriodEnded ||
      !session?.isHost ||
      !session?.hostToken ||
      !session?.roomId ||
      !currentQuestionIndex
    ) {
      return;
    }

    if (
      advancingQuestionIndexRef.current === currentQuestionIndex ||
      isAdvancingRef.current
    ) {
      return;
    }

    advancingQuestionIndexRef.current = currentQuestionIndex;
    isAdvancingRef.current = true;

    const advanceToNext = async () => {
      try {
        const { error: nextErr } = await supabase.functions.invoke('next-question', {
          body: {
            room_id: session.roomId,
            host_token: session.hostToken,
          },
        });

        if (nextErr) {
          if (nextErr.message && nextErr.message.includes('already advanced')) {
            return;
          }
          console.error('Failed to advance question:', nextErr);
          advancingQuestionIndexRef.current = null;
        } else {
          // Successfully advanced: broadcast immediately so all participant browsers update without delay
          if (typeof onBroadcast === 'function') {
            onBroadcast({ type: 'QUESTION_ADVANCED', room_id: session.roomId });
          }
        }
      } catch (err) {
        console.error('Exception advancing question:', err);
        advancingQuestionIndexRef.current = null;
      } finally {
        isAdvancingRef.current = false;
      }
    };

    advanceToNext();
  }, [revealPeriodEnded, roomStatus, session?.isHost, session?.hostToken, session?.roomId, currentQuestionIndex, onBroadcast]);

  // Calculate timer progress percentage
  const totalDuration = questionDurationSeconds || 20;
  // If the current player has submitted, freeze their timer view completely
  const displayedSeconds = isAnswered ? 0 : remainingSeconds;
  const timerPercentage = isAnswered
    ? 0
    : Math.max(0, Math.min(100, (displayedSeconds / totalDuration) * 100));

  const isTimerCritical = displayedSeconds <= 5;
  const timerBarColor = isTimerCritical ? 'bg-[#D96868]' : 'bg-[#6C9AE8]';
  const timerTextColor = isTimerCritical ? 'text-[#D96868]' : 'text-[#6C9AE8]';

  return (
    <GameBackground>
      <Navbar
        roomCode={session?.roomCode}
        isHost={session?.isHost}
        onExit={onExit}
      />

      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 flex flex-col gap-6">
        {/* Top Progress & Score Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="accent">
              QUESTION {currentQuestionIndex} OF {totalQuestions}
            </Badge>
            <span className="text-xs text-[#A1A6AD] hidden sm:inline">•</span>
            <span className="text-xs text-[#A1A6AD]">Active Quiz</span>
          </div>

          {/* Live Player Score Badge (Ranks completely hidden during active quiz) */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#A1A6AD]">Playing as:</span>
            <span className="font-semibold text-[#F4F3EF]">{session?.nickname}</span>
            <div className="flex items-center gap-1.5 ml-2 px-2.5 py-1 rounded bg-[#1A1D20] border border-[#30353A]">
              <span className="text-[#A1A6AD]">Score:</span>
              <span className="font-mono font-bold text-[#6C9AE8]">{currentTotalScore}</span>
            </div>
          </div>
        </div>

        {/* Question Countdown Timer Card */}
        <Card variant="primary" className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[#A1A6AD]">
              {isAnswered ? 'Status' : 'Time Remaining'}
            </span>
            <div className={`font-mono text-xl sm:text-2xl font-bold ${timerTextColor}`}>
              {isAnswered ? 'Submitted' : `${displayedSeconds}s`}
            </div>
          </div>

          {/* Synchronized Deadline Progress Bar */}
          <div className="w-full h-2 rounded-full bg-[#22262A] overflow-hidden border border-[#30353A]">
            <div
              className={`h-full transition-all duration-300 ease-linear ${isAnswered ? 'bg-[#35B58A]' : timerBarColor}`}
              style={{ width: isAnswered ? '100%' : `${timerPercentage}%` }}
            />
          </div>
        </Card>

        {submissionError && (
          <div
            role="alert"
            className="p-3 text-xs rounded border border-[#D96868]/40 bg-[#D96868]/10 text-[#D96868] flex items-center justify-between"
          >
            <span>{submissionError}</span>
            <button
              type="button"
              onClick={() => setSubmissionError(null)}
              className="text-[#D96868] hover:text-[#F4F3EF] ml-2 text-sm font-semibold"
            >
              ×
            </button>
          </div>
        )}

        {/* Question Prompt Card */}
        {question ? (
          <Card variant="primary" className="p-6 sm:p-8 flex flex-col gap-6">
            <div className="flex items-start gap-3">
              <span className="text-xs font-mono px-2.5 py-1 rounded bg-[#22262A] text-[#6C9AE8] border border-[#30353A] shrink-0 mt-0.5">
                Q{currentQuestionIndex}
              </span>
              <h2 className="text-lg sm:text-xl font-semibold text-[#F4F3EF] leading-relaxed">
                {question.prompt}
              </h2>
            </div>

            {/* Answer Options Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              {question.options.map((optText, idx) => {
                const isSelected = selectedOptionIndex === idx;
                const isRevealedCorrect = revealedAnswer?.correctOptionIndex === idx;
                const isRevealedIncorrectSelection = revealedAnswer && isSelected && !isRevealedCorrect;
                const letter = String.fromCharCode(65 + idx);

                let optionClasses =
                  'bg-[#22262A] border-[#30353A] text-[#F4F3EF] hover:bg-[#2c3136] hover:border-[#6C9AE8]/40';

                if (revealedAnswer) {
                  // Reveal Mode
                  if (isRevealedCorrect) {
                    optionClasses =
                      'bg-[#35B58A]/15 border-[#35B58A] text-[#F4F3EF] ring-1 ring-[#35B58A]';
                  } else if (isRevealedIncorrectSelection) {
                    optionClasses =
                      'bg-[#D96868]/15 border-[#D96868] text-[#F4F3EF] ring-1 ring-[#D96868]';
                  } else {
                    optionClasses =
                      'bg-[#1A1D20] border-[#30353A]/40 text-[#A1A6AD] opacity-40 cursor-default';
                  }
                } else if (isSelected) {
                  // Active Question Selected Mode
                  optionClasses =
                    'bg-[#6C9AE8]/15 border-[#6C9AE8] text-[#F4F3EF] ring-1 ring-[#6C9AE8]';
                } else if (isInputLocked) {
                  optionClasses =
                    'bg-[#1A1D20] border-[#30353A]/60 text-[#A1A6AD] opacity-60 cursor-not-allowed';
                }

                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isInputLocked}
                    onClick={() => handleSelectOption(idx)}
                    className={`w-full text-left p-4 rounded-lg border transition-all flex items-center gap-3.5 focus-visible:outline-2 focus-visible:outline-[#6C9AE8] ${optionClasses}`}
                  >
                    <span
                      className={`w-7 h-7 rounded flex items-center justify-center text-xs font-mono font-bold shrink-0 border ${
                        revealedAnswer
                          ? isRevealedCorrect
                            ? 'bg-[#35B58A] text-[#111315] border-[#35B58A]'
                            : isRevealedIncorrectSelection
                            ? 'bg-[#D96868] text-[#F4F3EF] border-[#D96868]'
                            : 'bg-[#111315] text-[#A1A6AD] border-[#30353A]'
                          : isSelected
                          ? 'bg-[#6C9AE8] text-[#111315] border-[#6C9AE8]'
                          : 'bg-[#111315] text-[#A1A6AD] border-[#30353A]'
                      }`}
                    >
                      {letter}
                    </span>
                    <span className="text-sm font-medium leading-snug flex-1">
                      {optText}
                    </span>
                    {revealedAnswer && isRevealedCorrect && (
                      <span className="text-xs text-[#35B58A] font-bold font-mono">
                        CORRECT
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Question Footer Status */}
            <div className="pt-2 border-t border-[#30353A] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                {submissionFeedback ? (
                  <div className="flex items-center gap-2">
                    {submissionFeedback.isCorrect ? (
                      <span className="inline-flex items-center gap-1.5 text-[#35B58A] font-semibold">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                        </svg>
                        Correct! +{submissionFeedback.pointsAwarded} pts
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[#D96868] font-semibold">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                        Incorrect (0 pts)
                      </span>
                    )}
                    <span className="text-[#A1A6AD] text-[11px]">• Waiting for others...</span>
                  </div>
                ) : isAnswered ? (
                  <span className="text-[#35B58A] font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#35B58A] animate-pulse"></span>
                    Answer submitted. Waiting for others...
                  </span>
                ) : isTimeExpired ? (
                  <span className="text-[#A1A6AD] font-medium flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6C9AE8] animate-pulse"></span>
                    {session?.isHost ? 'Time is up. Advancing...' : 'Waiting for next question...'}
                  </span>
                ) : (
                  <span className="text-[#A1A6AD]">
                    Select one option. Submissions lock automatically.
                  </span>
                )}
              </div>

              {session?.isHost ? (
                <div className="text-[11px] text-[#6C9AE8] font-mono">
                  Host control active • Automatic progression
                </div>
              ) : (
                <div className="text-[11px] text-[#A1A6AD] font-mono">
                  Synchronized live quiz
                </div>
              )}
            </div>
          </Card>
        ) : (
          <div className="py-16 text-center text-xs text-[#A1A6AD] rounded-lg border border-[#30353A] bg-[#1A1D20]">
            Loading question from authoritative server...
          </div>
        )}
      </main>
    </GameBackground>
  );
}
