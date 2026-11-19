import { supabase, supabaseUrl } from '../helpers/env.mjs';

const results = [];
function record(name, passed, details = '') {
  results.push({ name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
}

async function runProductionQuizEngineTest() {
  console.log('===================================================================');
  console.log(' Quizzr Phase 2B: Full Production Quiz Engine Test Suite');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // 1. Create Isolated Test Room A
  console.log('--- 1. Creating Isolated Test Room A ---');
  const { data: createA, error: errA } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostProdSync' },
  });
  if (errA || !createA?.room?.id) {
    record('1. Create isolated room', false, errA?.message);
    process.exit(1);
  }
  const roomId = createA.room.id;
  const roomCode = createA.room.roomCode;
  const hostToken = createA.hostToken;
  record('1. Create isolated room', true, `Code: ${roomCode}, ID: ${roomId}`);

  // Create Room B for cross-room token rejection test
  const { data: createB } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostOtherRoom' },
  });
  const roomBId = createB.room.id;
  const hostBToken = createB.hostToken;

  // Join Player to Room A
  const { data: joinData, error: joinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'PlayerProdSync' },
  });
  const playerToken = joinData.playerToken;
  record('Join player to isolated room', !joinErr && !!playerToken, `Player ID: ${joinData?.player?.id}`);

  // 2. Generate 5 Questions using Gemini
  console.log('\n--- 2. Generating 5 Questions via Gemini ---');
  const { data: genData, error: genErr } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: roomCode,
      host_token: hostToken,
      topic: 'Java OOPs',
      difficulty: 'medium',
      question_count: 5,
    },
  });
  const genSuccess = !genErr && genData?.success && genData?.questions?.length === 5;
  record('2. Generate 5 questions using Gemini', genSuccess, `Count: ${genData?.questions?.length || 0}`);

  if (!genSuccess) {
    console.error('Gemini generation failed:', genErr || genData);
    process.exit(1);
  }

  // 3 & 4. Start Room & Verify Question Index = 1 & 20-second Deadline
  console.log('\n--- 3 & 4. Starting Room & Verifying Authoritative Timers ---');
  const { data: startData, error: startErr } = await supabase.functions.invoke('start-room', {
    body: { room_id: roomId, host_token: hostToken },
  });

  const indexIsOne = startData?.room?.currentQuestionIndex === 1;
  record('3. Start room and verify question index = 1', indexIsOne, `Index: ${startData?.room?.currentQuestionIndex}`);

  const hasStartedAt = !!startData?.room?.questionStartedAt;
  const hasDeadline = !!startData?.room?.questionDeadline;
  let deadlineDiff = 0;
  if (hasStartedAt && hasDeadline) {
    const startMs = new Date(startData.room.questionStartedAt).getTime();
    const deadlineMs = new Date(startData.room.questionDeadline).getTime();
    deadlineDiff = Math.round((deadlineMs - startMs) / 1000);
  }
  const is20Sec = deadlineDiff >= 19 && deadlineDiff <= 21;
  record('4. Verify server-side 20-second deadline', is20Sec, `Duration: ${deadlineDiff}s`);

  // 5. Host and Player receive the same question
  console.log('\n--- 5. Verifying Host & Player Fetch Same Question ---');
  const [hostQRes, playerQRes] = await Promise.all([
    supabase.functions.invoke('get-current-question', {
      body: { room_id: roomId, host_token: hostToken },
    }),
    supabase.functions.invoke('get-current-question', {
      body: { room_id: roomId, player_token: playerToken },
    }),
  ]);

  const sameQuestionId =
    hostQRes?.data?.question?.id &&
    hostQRes.data.question.id === playerQRes?.data?.question?.id;
  const samePrompt =
    hostQRes?.data?.question?.prompt &&
    hostQRes.data.question.prompt === playerQRes?.data?.question?.prompt;
  record('5. Verify host and player receive the same question', sameQuestionId && samePrompt, `Prompt: "${hostQRes?.data?.question?.prompt?.slice(0, 40)}..."`);

  // 6. Verify invalid and cross-room tokens are rejected
  console.log('\n--- 6. Verifying Token Validation & Cross-Room Rejection ---');
  const fakeToken = '0000000000000000000000000000000000000000000000000000000000000000';
  const { data: fakeTokenRes, error: fakeTokenErr } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: fakeToken },
  });
  const fakeRejected = Boolean(fakeTokenErr || fakeTokenRes?.error);

  const { data: crossTokenRes, error: crossTokenErr } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, host_token: hostBToken }, // Token from room B for room A
  });
  const crossRejected = Boolean(crossTokenErr || crossTokenRes?.error);
  record('6. Verify invalid and cross-room tokens are rejected (HTTP 401)', fakeRejected && crossRejected);

  // 7. Verify early advancement returns HTTP 400
  console.log('\n--- 7. Verifying Early Advancement Rejection ---');
  const { data: earlyAdvRes, error: earlyAdvErr } = await supabase.functions.invoke('next-question', {
    body: { room_id: roomId, host_token: hostToken },
  });
  const earlyRejected = Boolean(earlyAdvErr || earlyAdvRes?.error);
  record('7. Verify early advancement returns HTTP 400 (Timer active)', earlyRejected, earlyAdvErr?.message || earlyAdvRes?.error);

  // 8. Verify simultaneous advancement allows exactly one success
  console.log('\n--- 8. Verifying Simultaneous Advancement Concurrency ---');
  // Wait out the timer until deadline has passed
  const deadlineMs = new Date(startData.room.questionDeadline).getTime();
  const waitMs = Math.max(0, deadlineMs - Date.now() + 1000);
  console.log(`   Waiting ${Math.ceil(waitMs / 1000)}s for question 1 deadline to pass...`);
  await new Promise((r) => setTimeout(r, waitMs));

  // Fire two simultaneous next-question calls
  console.log('   Sending two simultaneous next-question requests...');
  const [twinRes1, twinRes2] = await Promise.all([
    supabase.functions.invoke('next-question', { body: { room_id: roomId, host_token: hostToken } }),
    supabase.functions.invoke('next-question', { body: { room_id: roomId, host_token: hostToken } }),
  ]);

  const twin1Success = !twinRes1.error && twinRes1.data?.room?.currentQuestionIndex === 2;
  const twin2Success = !twinRes2.error && twinRes2.data?.room?.currentQuestionIndex === 2;
  const exactlyOneSuccess = (twin1Success && !twin2Success) || (!twin1Success && twin2Success);
  record('8. Verify simultaneous advancement allows exactly one success', exactlyOneSuccess, `Twin 1: ${twin1Success ? 'Success' : 'Conflict'}, Twin 2: ${twin2Success ? 'Success' : 'Conflict'}`);

  // 9. Verify reconnecting players receive correct remaining time
  console.log('\n--- 9. Verifying Reconnection State & Remaining Time ---');
  const { data: reconnectData, error: reconnectErr } = await supabase.functions.invoke('get-current-question', {
    body: { room_id: roomId, player_token: playerToken },
  });
  const hasRemainingSec = typeof reconnectData?.remainingSeconds === 'number' && reconnectData.remainingSeconds > 0 && reconnectData.remainingSeconds <= 20;
  record('9. Verify reconnecting players receive the correct remaining time', !reconnectErr && hasRemainingSec, `Remaining: ${reconnectData?.remainingSeconds}s on Q${reconnectData?.currentQuestionIndex}`);

  // 10. Verify final question transitions room to completed
  console.log('\n--- 10. Advancing to Final Question and Completing Room ---');
  // Q2 is active. Let's advance Q2->Q3, Q3->Q4, Q4->Q5, Q5->Completed
  // We fast-forward database deadline via service role or wait out deadlines
  for (let q = 2; q <= 5; q++) {
    // Wait for the deadline to pass
    const curQState = await supabase.functions.invoke('get-current-question', {
      body: { room_id: roomId, host_token: hostToken },
    });
    const dMs = new Date(curQState.data.questionDeadline).getTime();
    const waitTime = Math.max(0, dMs - Date.now() + 1000);
    if (waitTime > 0) {
      console.log(`   Waiting ${Math.ceil(waitTime / 1000)}s for question ${q} deadline...`);
      await new Promise((r) => setTimeout(r, waitTime));
    }
    const { data: advRes } = await supabase.functions.invoke('next-question', {
      body: { room_id: roomId, host_token: hostToken },
    });
    console.log(`   Advanced: Q${q} -> ${advRes?.completed ? 'COMPLETED' : 'Q' + advRes?.room?.currentQuestionIndex}`);
  }

  // Check room status is completed
  const { data: finalRoomCheck } = await supabase
    .from('rooms')
    .select('id, status, completed_at')
    .eq('id', roomId)
    .single();

  const isCompleted = finalRoomCheck?.status === 'completed' && !!finalRoomCheck?.completed_at;
  record('10. Verify final question transitions room to completed', isCompleted, `Status: ${finalRoomCheck?.status}`);

  // 11. Verify correct answers and explanations are never exposed
  console.log('\n--- 11. Verifying Privacy & Answer Key Protection ---');
  const { data: pubKeyProbe } = await supabase.from('question_keys').select('*');
  const rlsSafe = pubKeyProbe?.length === 0;

  const noAnswerInQFetch =
    hostQRes?.data?.question?.correct_option_index === undefined &&
    hostQRes?.data?.question?.explanation === undefined;
  record('11. Verify correct answers and explanations are never exposed', rlsSafe && noAnswerInQFetch);

  // 12. Verify Realtime UPDATE events reach multiple clients
  console.log('\n--- 12. Verifying Realtime Multi-Client Delivery ---');
  // Setup another quick room and check realtime broadcast on UPDATE
  const { data: rtRoomCreate } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'RTTestHost' },
  });
  const rtRoomId = rtRoomCreate.room.id;
  let client1Caught = false;
  let client2Caught = false;

  const c1 = supabase.channel(`rt_c1_${rtRoomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${rtRoomId}` }, () => {
      client1Caught = true;
    });

  const c2 = supabase.channel(`rt_c2_${rtRoomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${rtRoomId}` }, () => {
      client2Caught = true;
    });

  await new Promise((res) => {
    let subCount = 0;
    const onSub = () => { if (++subCount === 2) res(); };
    c1.subscribe(onSub);
    c2.subscribe(onSub);
  });

  // Generate and start
  await supabase.functions.invoke('generate-questions', {
    body: { room_code: rtRoomCreate.room.roomCode, host_token: rtRoomCreate.hostToken, topic: 'Java', difficulty: 'easy', question_count: 5 },
  });
  await supabase.functions.invoke('start-room', {
    body: { room_id: rtRoomId, host_token: rtRoomCreate.hostToken },
  });

  await new Promise((r) => setTimeout(r, 2500));
  supabase.removeChannel(c1);
  supabase.removeChannel(c2);

  record('12. Verify Realtime UPDATE events reach multiple clients', client1Caught && client2Caught);

  console.log('\n===================================================================');
  console.log(' FINAL PRODUCTION TEST SUMMARY');
  console.log('===================================================================');
  let passCount = 0;
  results.forEach((r) => {
    if (r.passed) passCount++;
    console.log(`${(r.passed ? 'PASS' : 'FAIL').padEnd(6)} | ${r.name}`);
  });
  console.log(`\nTOTAL: ${passCount} / ${results.length} PASSED`);
}

runProductionQuizEngineTest().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
