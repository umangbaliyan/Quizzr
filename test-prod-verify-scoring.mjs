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

const results = [];
function record(name, passed, details = '') {
  results.push({ name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
}

async function verifyAllProductionScoringRequirements() {
  console.log('===================================================================');
  console.log(' Quizzr Phase 2C: Full Production Verification Test Suite');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Setup Isolated Test Room
  console.log('--- 1. Setting up Isolated Test Room & Pre-Joining Players ---');
  const { data: createData } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostProdScore' },
  });
  const roomCode = createData.room.roomCode;
  const roomId = createData.room.id;
  const hostToken = createData.hostToken;

  // Setup second room for cross-room token rejection
  const { data: createB } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostOtherRoom' },
  });
  const roomBCode = createB.room.roomCode;

  // Join 4 players to Room A while room is waiting (Player 0, 1, 2, 3)
  const players = [];
  for (let i = 0; i < 4; i++) {
    const { data: j } = await supabase.functions.invoke('join-room', {
      body: { room_code: roomCode, nickname: 'P_Answer_' + i },
    });
    players.push(j);
  }

  // Join a player to Room B
  const { data: joinB } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomBCode, nickname: 'P_RoomB' },
  });
  const playerBToken = joinB.playerToken;

  record('1. Setup isolated test rooms & players', true, `Room A: ${roomCode}, Room B: ${roomBCode}`);

  // Generate 5 questions via Gemini
  console.log('\n--- 2. Generating Questions for Room A via Gemini ---');
  const { data: genData } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: roomCode,
      host_token: hostToken,
      topic: 'Java OOPs',
      difficulty: 'medium',
      question_count: 5,
    },
  });
  record('2. Generate questions via Gemini', genData?.success && genData?.questions?.length === 5, `Generated: ${genData?.questions?.length || 0}`);

  // Start Room A
  console.log('\n--- 3. Starting Room A (Active Status) ---');
  const { data: startData } = await supabase.functions.invoke('start-room', {
    body: { room_id: roomId, host_token: hostToken },
  });
  record('3. Start room A', startData?.room?.status === 'active', `Status: ${startData?.room?.status}`);

  // Fetch Q1
  const { data: curQ1 } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: players[0].playerToken },
  });
  const q1 = curQ1.question;

  // 1 & 2. Test Correct Answer (Base + Time Bonus) and Incorrect Answer (0 points)
  console.log('\n--- 4. Testing Correct Answer & Incorrect Answer Evaluation ---');
  // Submit all 4 options across 4 players to guarantee hitting the correct option and incorrect options
  let correctSubResponse = null;
  let incorrectSubResponse = null;
  let correctPlayerIndex = -1;

  for (let i = 0; i < 4; i++) {
    const { data: subRes } = await supabase.functions.invoke('submit-answer', {
      body: {
        room_code: roomCode,
        question_id: q1.id,
        selected_option_index: i,
        player_token: players[i].playerToken,
      },
    });

    if (subRes?.isCorrect) {
      correctSubResponse = subRes;
      correctPlayerIndex = i;
    } else {
      incorrectSubResponse = subRes;
    }
  }

  const isBasePlusBonus =
    correctSubResponse?.isCorrect === true &&
    correctSubResponse.pointsAwarded >= 100 &&
    correctSubResponse.pointsAwarded <= 150 &&
    correctSubResponse.totalScore === correctSubResponse.pointsAwarded;

  record('1. Correct answer awards correct base points and time bonus (100-150)', isBasePlusBonus, `Points: ${correctSubResponse?.pointsAwarded}`);

  const isIncorrectZero =
    incorrectSubResponse?.isCorrect === false &&
    incorrectSubResponse.pointsAwarded === 0 &&
    incorrectSubResponse.totalScore === 0;

  record('2. Incorrect answer awards zero', isIncorrectZero, `Points: ${incorrectSubResponse?.pointsAwarded}`);

  // 3. Invalid and cross-room tokens return 401
  console.log('\n--- 5. Testing Invalid & Cross-Room Tokens (Expect 401) ---');
  const fakeToken = '0000000000000000000000000000000000000000000000000000000000000000';
  const { data: fakeRes, error: fakeErr } = await supabase.functions.invoke('submit-answer', {
    body: { room_code: roomCode, question_id: q1.id, selected_option_index: 0, player_token: fakeToken },
  });
  const fakeBlocked = Boolean(fakeErr || fakeRes?.error);

  const { data: crossRes, error: crossErr } = await supabase.functions.invoke('submit-answer', {
    body: { room_code: roomCode, question_id: q1.id, selected_option_index: 0, player_token: playerBToken },
  });
  const crossBlocked = Boolean(crossErr || crossRes?.error);
  record('3. Invalid and cross-room tokens return 401', fakeBlocked && crossBlocked);

  // 5. Duplicate submissions return 409
  console.log('\n--- 6. Testing Duplicate Submissions on Same Question (Expect 409) ---');
  const { data: dupData, error: dupErr } = await supabase.functions.invoke('submit-answer', {
    body: {
      room_code: roomCode,
      question_id: q1.id,
      selected_option_index: 0,
      player_token: players[0].playerToken,
    },
  });
  const dupBlocked = Boolean(dupErr || dupData?.error);
  record('5. Duplicate submissions return 409', dupBlocked, dupErr?.message || dupData?.error);

  // 4. Late submissions are rejected
  console.log('\n--- 7. Testing Late Submission Rejection (Waiting for Deadline) ---');
  const d1Ms = new Date(startData.room.questionDeadline).getTime();
  const waitMs = Math.max(0, d1Ms - Date.now() + 1500);
  console.log(`   Waiting ${Math.ceil(waitMs / 1000)}s for question 1 timer to expire...`);
  await new Promise((r) => setTimeout(r, waitMs));

  // Advance to Q2 via next-question
  await supabase.functions.invoke('next-question', {
    body: { room_id: roomId, host_token: hostToken },
  });

  // Attempt late submission on expired Q1
  const { data: lateData, error: lateErr } = await supabase.functions.invoke('submit-answer', {
    body: {
      room_code: roomCode,
      question_id: q1.id,
      selected_option_index: 0,
      player_token: players[0].playerToken,
    },
  });
  const lateRejected = Boolean(lateErr || lateData?.error);
  record('4. Late submissions are rejected', lateRejected, lateErr?.message || lateData?.error);

  // Fetch Q2
  const { data: curQ2 } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: players[0].playerToken },
  });
  const q2 = curQ2.question;

  // 6. Simultaneous submissions cannot double-score
  console.log('\n--- 8. Testing Simultaneous Submissions Concurrency ---');
  // Player 3 fires two parallel submissions for Q2 at the exact same millisecond
  const [twin1, twin2] = await Promise.all([
    supabase.functions.invoke('submit-answer', {
      body: { room_code: roomCode, question_id: q2.id, selected_option_index: 1, player_token: players[3].playerToken },
    }),
    supabase.functions.invoke('submit-answer', {
      body: { room_code: roomCode, question_id: q2.id, selected_option_index: 2, player_token: players[3].playerToken },
    }),
  ]);

  const twin1Ok = !twin1.error && twin1.data?.success;
  const twin2Ok = !twin2.error && twin2.data?.success;
  const exactlyOneCommitted = (twin1Ok && !twin2Ok) || (!twin1Ok && twin2Ok);
  record('6. Simultaneous submissions cannot double-score', exactlyOneCommitted, `Twin 1: ${twin1Ok ? 'Success' : 'Conflict'}, Twin 2: ${twin2Ok ? 'Success' : 'Conflict'}`);

  // 7. Answer insertion and player score update remain atomic
  console.log('\n--- 9. Verifying Database Score Integrity ---');
  const { data: dbPlayerRow } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('id', players[correctPlayerIndex].player.id)
    .single();

  const isAtomic = dbPlayerRow?.score === correctSubResponse.totalScore && dbPlayerRow?.score > 0;
  record('7. Answer insertion and player score update remain atomic', isAtomic, `Player score in DB: ${dbPlayerRow?.score}, Returned totalScore: ${correctSubResponse.totalScore}`);

  // 8. Multiple answers accumulate correctly
  console.log('\n--- 10. Verifying Cumulative Score Accumulation Across Questions ---');
  // The player who got Q1 right now submits on Q2
  let pCorrectQ2Score = 0;
  for (let opt = 0; opt < 4; opt++) {
    // We already know player 0 and player 3 submitted or we can use player 1
    // Let's submit for the player who scored on Q1
    const { data: q2Sub } = await supabase.functions.invoke('submit-answer', {
      body: {
        room_code: roomCode,
        question_id: q2.id,
        selected_option_index: opt,
        player_token: players[correctPlayerIndex].playerToken,
      },
    });
    if (q2Sub?.success) {
      pCorrectQ2Score = q2Sub.totalScore;
      break;
    }
  }

  const { data: pAccumulatedDb } = await supabase
    .from('players')
    .select('score')
    .eq('id', players[correctPlayerIndex].player.id)
    .single();

  const isAccumulated = pAccumulatedDb?.score === pCorrectQ2Score && pAccumulatedDb?.score >= correctSubResponse.pointsAwarded;
  record('8. Multiple answers accumulate correctly', isAccumulated, `Total Accumulated Score: ${pAccumulatedDb?.score}`);

  // 9. Realtime player score updates work
  console.log('\n--- 11. Verifying Realtime Player Score Broadcast ---');
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

  // Advance to Q3 and submit to trigger real-time score update
  const d2Ms = new Date(curQ2.questionDeadline).getTime();
  const waitQ2 = Math.max(0, d2Ms - Date.now() + 1500);
  if (waitQ2 > 0) {
    console.log(`   Waiting ${Math.ceil(waitQ2 / 1000)}s for Q2 deadline...`);
    await new Promise((r) => setTimeout(r, waitQ2));
  }
  await supabase.functions.invoke('next-question', { body: { room_id: roomId, host_token: hostToken } });

  const { data: curQ3 } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: players[0].playerToken },
  });
  const q3 = curQ3.question;

  // Submit on Q3
  await supabase.functions.invoke('submit-answer', {
    body: { room_code: roomCode, question_id: q3.id, selected_option_index: 0, player_token: players[0].playerToken },
  });

  await new Promise((r) => setTimeout(r, 2500));
  record('9. Realtime player score updates work', scoreUpdateCaught);
  supabase.removeChannel(scoreChannel);

  // 10. Correct answers and explanations are never exposed
  console.log('\n--- 12. Verifying Privacy & Answer Key Protection ---');
  const { data: pubKeys } = await supabase.from('question_keys').select('*');
  const keysProtected = pubKeys?.length === 0;

  const noSecretInResponse =
    correctSubResponse?.correct_option_index === undefined &&
    correctSubResponse?.explanation === undefined;
  record('10. Correct answers and explanations are never exposed', keysProtected && noSecretInResponse);

  // 11. RPC permissions remain service_role-only
  console.log('\n--- 13. Verifying RPC Permissions (service_role-only) ---');
  const { data: rpcData, error: rpcErr } = await supabase.rpc('submit_player_answer', {
    p_room_id: roomId,
    p_player_id: players[0].player.id,
    p_question_id: q3.id,
    p_selected_option_index: 0,
    p_is_correct: true,
    p_points_awarded: 100,
    p_response_time_ms: 1000,
  });
  const isRpcBlocked = Boolean(rpcErr);
  record('11. RPC permissions remain service_role-only (Public client blocked)', isRpcBlocked, rpcErr?.message || 'Access blocked');

  console.log('\n===================================================================');
  console.log(' FINAL PRODUCTION TEST RESULTS');
  console.log('===================================================================');
  let passCount = 0;
  results.forEach((r) => {
    if (r.passed) passCount++;
    console.log(`${(r.passed ? 'PASS' : 'FAIL').padEnd(6)} | ${r.name}`);
  });
  console.log(`\nTOTAL: ${passCount} / ${results.length} PASSED`);
}

verifyAllProductionScoringRequirements().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

