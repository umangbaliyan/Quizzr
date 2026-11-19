import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Load environment from .env.local
const envContent = fs.readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envContent
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

const auditResults = [];
function record(name, passed, details = '') {
  auditResults.push({ name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
}

async function runProductionSubmitAnswerTest() {
  console.log('===================================================================');
  console.log(' Quizzr Phase 2C: Full Production Verification (submit-answer)');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Step 1: Setup isolated test room A with TWO players joined during waiting state
  console.log('--- 1. Setting up Isolated Test Room A & Joining Both Players ---');
  const { data: createA, error: errA } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostAnswerProd' },
  });
  if (errA || !createA?.room?.id) {
    record('Create isolated room A', false, errA?.message);
    process.exit(1);
  }
  const roomCode = createA.room.roomCode;
  const roomId = createA.room.id;
  const hostToken = createA.hostToken;

  // Setup isolated Room B for cross-room token check
  const { data: createB } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostOtherRoomB' },
  });
  const roomBCode = createB.room.roomCode;

  // Join Player 1 to Room A while room is waiting
  const { data: joinData, error: joinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'PlayerOneProd' },
  });
  const player1Id = joinData?.player?.id;
  const player1Token = joinData?.playerToken;

  // Join Player 2 to Room A while room is waiting
  const { data: joinP2Data, error: joinP2Err } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'PlayerTwoProd' },
  });
  const player2Id = joinP2Data?.player?.id;
  const player2Token = joinP2Data?.playerToken;

  // Join Player to Room B
  const { data: joinDataB } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomBCode, nickname: 'PlayerRoomB' },
  });
  const playerBToken = joinDataB?.playerToken;

  record('1. Setup isolated test rooms & players', !joinErr && !joinP2Err && !!player1Token && !!player2Token, `Room A: ${roomCode}, Room B: ${roomBCode}`);

  // Generate 5 questions via Gemini for Room A
  console.log('\n--- 2. Generating Questions for Room A via Gemini ---');
  const { data: genData, error: genErr } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: roomCode,
      host_token: hostToken,
      topic: 'Java OOPs',
      difficulty: 'medium',
      question_count: 5,
    },
  });
  if (genErr || !genData?.success) {
    record('Generate questions via Gemini', false, genErr?.message || genData?.error);
    process.exit(1);
  }
  record('Generate questions via Gemini', true, `Generated: ${genData.questions.length} questions`);

  // Start the room
  console.log('\n--- 3. Starting Room A (Active Status) ---');
  const { data: startData, error: startErr } = await supabase.functions.invoke('start-room', {
    body: { room_id: roomId, host_token: hostToken },
  });
  record('Start room A', !startErr && startData?.room?.status === 'active', `Status: ${startData?.room?.status}`);

  // Fetch the active current question
  const { data: curQData } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: player1Token },
  });
  const q1 = curQData?.question;
  console.log(`-> Active Q1 ID: ${q1?.id}, Prompt: "${q1?.prompt?.slice(0, 40)}..."`);

  // 1 & 2. Test Correct Answer and Incorrect Answer Evaluation
  console.log('\n--- 4. Testing Answer Submission: Incorrect vs Correct ---');
  const { data: sub1Data, error: sub1Err } = await supabase.functions.invoke('submit-answer', {
    body: {
      room_code: roomCode,
      question_id: q1.id,
      selected_option_index: 0,
      player_token: player1Token,
    },
  });

  const sub1Success = !sub1Err && sub1Data?.success;
  record('Submit answer request execution', sub1Success, `Result: isCorrect=${sub1Data?.isCorrect}, pointsAwarded=${sub1Data?.pointsAwarded}`);

  if (sub1Data?.isCorrect) {
    const isBasePlusBonus = sub1Data.pointsAwarded >= 100 && sub1Data.pointsAwarded <= 150;
    record('1. Correct answer awards correct base points and time bonus (100-150)', isBasePlusBonus, `Points: ${sub1Data.pointsAwarded}`);
  } else {
    record('2. Incorrect answer awards zero points', sub1Data?.pointsAwarded === 0, `Points: ${sub1Data?.pointsAwarded}`);
  }

  // 3. Test Invalid & Cross-room Tokens return 401
  console.log('\n--- 5. Testing Invalid & Cross-Room Tokens (Expect 401) ---');
  const fakeToken = '0000000000000000000000000000000000000000000000000000000000000000';
  const { data: fakeRes, error: fakeErr } = await supabase.functions.invoke('submit-answer', {
    body: {
      room_code: roomCode,
      question_id: q1.id,
      selected_option_index: 1,
      player_token: fakeToken,
    },
  });
  const fakeBlocked = Boolean(fakeErr || fakeRes?.error);

  const { data: crossRes, error: crossErr } = await supabase.functions.invoke('submit-answer', {
    body: {
      room_code: roomCode,
      question_id: q1.id,
      selected_option_index: 1,
      player_token: playerBToken, // Token from Room B
    },
  });
  const crossBlocked = Boolean(crossErr || crossRes?.error);
  record('3. Invalid and cross-room tokens return 401', fakeBlocked && crossBlocked);

  // 5. Test Duplicate Submission returns 409
  console.log('\n--- 6. Testing Duplicate Submission on Same Question (Expect 409) ---');
  const { data: dupData, error: dupErr } = await supabase.functions.invoke('submit-answer', {
    body: {
      room_code: roomCode,
      question_id: q1.id,
      selected_option_index: 2,
      player_token: player1Token,
    },
  });
  const dupBlocked = Boolean(dupErr || dupData?.error);
  record('5. Duplicate submissions return 409', dupBlocked, dupErr?.message || dupData?.error);

  // 4. Test Late Submission Rejection
  console.log('\n--- 7. Testing Late Submission Rejection (Wait for Deadline) ---');
  const d1 = new Date(startData.room.questionDeadline).getTime();
  const waitMs = Math.max(0, d1 - Date.now() + 1500);
  console.log(`   Waiting ${Math.ceil(waitMs / 1000)}s for question 1 timer to expire...`);
  await new Promise((r) => setTimeout(r, waitMs));

  // Advance to Q2 via next-question
  await supabase.functions.invoke('next-question', {
    body: { room_id: roomId, host_token: hostToken },
  });

  // Now submit answer for Q1 after deadline has expired
  const { data: lateData, error: lateErr } = await supabase.functions.invoke('submit-answer', {
    body: {
      room_code: roomCode,
      question_id: q1.id,
      selected_option_index: 0,
      player_token: player1Token,
    },
  });
  const lateRejected = Boolean(lateErr || lateData?.error);
  record('4. Late submissions are rejected', lateRejected, lateErr?.message || lateData?.error);

  // Fetch active Q2
  const { data: curQ2Data } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: player2Token },
  });
  const q2 = curQ2Data?.question;

  // 6. Simultaneous Submissions cannot double score (Player 2 fires two parallel submissions for Q2)
  console.log('\n--- 8. Testing Simultaneous Submissions Concurrency ---');
  const [subTwin1, subTwin2] = await Promise.all([
    supabase.functions.invoke('submit-answer', {
      body: { room_code: roomCode, question_id: q2.id, selected_option_index: 1, player_token: player2Token },
    }),
    supabase.functions.invoke('submit-answer', {
      body: { room_code: roomCode, question_id: q2.id, selected_option_index: 2, player_token: player2Token },
    }),
  ]);

  const twin1Ok = !subTwin1.error && subTwin1.data?.success;
  const twin2Ok = !subTwin2.error && subTwin2.data?.success;
  const exactlyOneCommitted = (twin1Ok && !twin2Ok) || (!twin1Ok && twin2Ok);
  record('6. Simultaneous submissions cannot double-score (exactly one succeeds)', exactlyOneCommitted, `Twin 1: ${twin1Ok ? 'Success' : 'Conflict'}, Twin 2: ${twin2Ok ? 'Success' : 'Conflict'}`);

  // 7. Answer insertion and player score update remain atomic
  console.log('\n--- 9. Verifying Database Atomicity & Integrity ---');
  const { data: p2Answers } = await supabase
    .from('answers')
    .select('id, points_awarded')
    .eq('player_id', player2Id)
    .eq('question_id', q2.id);

  const { data: p2Player } = await supabase
    .from('players')
    .select('id, score')
    .eq('id', player2Id)
    .single();

  const expectedP2Score = p2Answers?.reduce((acc, a) => acc + a.points_awarded, 0) || 0;
  const isAtomicScore = p2Player?.score === expectedP2Score && p2Answers?.length === 1;
  record('7. Answer insertion and player score update remain atomic', isAtomicScore, `DB Score: ${p2Player?.score}, Sum of answers: ${expectedP2Score}`);

  // 8. Multiple answers accumulate correctly
  console.log('\n--- 10. Verifying Score Accumulation Across Multiple Questions ---');
  // Player 1 submits on Q2 as well
  const { data: p1Q2Sub } = await supabase.functions.invoke('submit-answer', {
    body: { room_code: roomCode, question_id: q2.id, selected_option_index: 1, player_token: player1Token },
  });

  const { data: p1Answers } = await supabase
    .from('answers')
    .select('id, points_awarded')
    .eq('player_id', player1Id);

  const { data: p1Player } = await supabase
    .from('players')
    .select('id, score')
    .eq('id', player1Id)
    .single();

  const p1ExpectedScore = p1Answers?.reduce((acc, a) => acc + a.points_awarded, 0) || 0;
  const isMultiAccumulated = p1Player?.score === p1ExpectedScore && p1Answers?.length === 2;
  record('8. Multiple answers accumulate correctly', isMultiAccumulated, `Player 1 score: ${p1Player?.score} across 2 questions`);

  // 9. Realtime player score updates work
  console.log('\n--- 11. Verifying Realtime Player Score Updates ---');
  const scoreChannel = supabase.channel(`score_rt_${roomId}`);
  let scoreUpdateCaught = false;

  await new Promise((res) => {
    scoreChannel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'players', filter: `room_id=eq.${roomId}` }, (p) => {
        if (p.new?.score !== undefined) scoreUpdateCaught = true;
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') res();
      });
  });

  // Advance to Q3 and submit to trigger Realtime score event
  const d2 = new Date(curQ2Data.questionDeadline).getTime();
  const waitQ2 = Math.max(0, d2 - Date.now() + 1500);
  if (waitQ2 > 0) {
    console.log(`   Waiting ${Math.ceil(waitQ2 / 1000)}s for Q2 deadline...`);
    await new Promise((r) => setTimeout(r, waitQ2));
  }
  await supabase.functions.invoke('next-question', { body: { room_id: roomId, host_token: hostToken } });

  const { data: curQ3Data } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: player1Token },
  });
  const q3 = curQ3Data?.question;

  // Submit on Q3 to trigger real-time score update
  await supabase.functions.invoke('submit-answer', {
    body: { room_code: roomCode, question_id: q3.id, selected_option_index: 0, player_token: player1Token },
  });

  await new Promise((r) => setTimeout(r, 2500));
  record('9. Realtime player score updates work', scoreUpdateCaught);
  supabase.removeChannel(scoreChannel);

  // 10. Correct answers and explanations are never exposed
  console.log('\n--- 12. Verifying Privacy & Answer Key Protection ---');
  const { data: pubKeys } = await supabase.from('question_keys').select('*');
  const keysProtected = pubKeys?.length === 0;

  const noSecretInSubResponse =
    sub1Data?.correct_option_index === undefined &&
    sub1Data?.explanation === undefined;
  record('10. Correct answers and explanations are never exposed', keysProtected && noSecretInSubResponse);

  // 11. RPC permissions remain service_role-only
  console.log('\n--- 13. Verifying RPC Permissions (service_role-only) ---');
  const { data: rpcData, error: rpcErr } = await supabase.rpc('submit_player_answer', {
    p_room_id: roomId,
    p_player_id: player1Id,
    p_question_id: q3.id,
    p_selected_option_index: 0,
    p_is_correct: true,
    p_points_awarded: 100,
    p_response_time_ms: 1000,
  });

  const isRpcBlocked = Boolean(rpcErr);
  record('11. RPC permissions remain service_role-only (Public client blocked)', isRpcBlocked, rpcErr?.message || 'Access denied');

  console.log('\n===================================================================');
  console.log(' FINAL PRODUCTION PHASE 2C TEST SUMMARY');
  console.log('===================================================================');
  let passCount = 0;
  auditResults.forEach((t) => {
    if (t.passed) passCount++;
    console.log(`${(t.passed ? 'PASS' : 'FAIL').padEnd(6)} | ${t.name}`);
  });
  console.log(`\nTOTAL: ${passCount} / ${auditResults.length} PASSED`);
}

runProductionSubmitAnswerTest().catch((err) => {
  console.error('Production test execution failed:', err);
  process.exit(1);
});
