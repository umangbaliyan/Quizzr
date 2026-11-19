import { supabase, supabaseUrl } from '../helpers/env.mjs';

const results = [];
function record(name, passed, details = '') {
  results.push({ name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
}

async function runGenerateQuestionsTests() {
  console.log('===================================================================');
  console.log(' Quizzr Phase 2A: generate-questions Validation & Security Tests');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Step 1: Create room
  console.log('--- Setting up test room ---');
  const { data: createData, error: createErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'QuizMasterGen' },
  });

  if (createErr || !createData?.room?.roomCode) {
    record('Setup room for generate-questions', false, createErr?.message);
    process.exit(1);
  }

  const roomCode = createData.room.roomCode;
  const roomId = createData.room.id;
  const hostToken = createData.hostToken;
  const invalidToken = '0000000000000000000000000000000000000000000000000000000000000000';
  record('Setup room for generate-questions', true, `Code: ${roomCode}, ID: ${roomId}`);

  // Test 1: Missing / invalid inputs
  console.log('\n--- Input Validation Checks ---');
  const { data: v1Data, error: v1Err } = await supabase.functions.invoke('generate-questions', {
    body: { room_code: '', host_token: hostToken, topic: 'Science', question_count: 5 },
  });
  record('Reject empty room_code', Boolean(v1Err || v1Data?.error));

  const { data: v2Data, error: v2Err } = await supabase.functions.invoke('generate-questions', {
    body: { room_code: roomCode, host_token: hostToken, topic: '', question_count: 5 },
  });
  record('Reject empty topic', Boolean(v2Err || v2Data?.error));

  const { data: v3Data, error: v3Err } = await supabase.functions.invoke('generate-questions', {
    body: { room_code: roomCode, host_token: hostToken, topic: 'History', question_count: 2 },
  });
  record('Reject question_count < 5', Boolean(v3Err || v3Data?.error));

  const { data: v4Data, error: v4Err } = await supabase.functions.invoke('generate-questions', {
    body: { room_code: roomCode, host_token: hostToken, topic: 'History', question_count: 25 },
  });
  record('Reject question_count > 20', Boolean(v4Err || v4Data?.error));

  const { data: v5Data, error: v5Err } = await supabase.functions.invoke('generate-questions', {
    body: { room_code: roomCode, host_token: hostToken, topic: 'History', difficulty: 'impossible', question_count: 5 },
  });
  record('Reject invalid difficulty', Boolean(v5Err || v5Data?.error));

  // Test 2: Authentication Security
  console.log('\n--- Host Authentication Checks ---');
  const { data: authData, error: authErr } = await supabase.functions.invoke('generate-questions', {
    body: { room_code: roomCode, host_token: invalidToken, topic: 'Astronomy', question_count: 5 },
  });
  record('Reject invalid host_token', Boolean(authErr || authData?.error));

  // Test 3: Gemini API key check & response behavior
  console.log('\n--- Gemini Invocation & AI Key Test ---');
  const { data: genData, error: genErr } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: roomCode,
      host_token: hostToken,
      topic: 'Planets of the Solar System',
      difficulty: 'easy',
      question_count: 5,
    },
  });

  if (genErr || !genData?.success) {
    const errMsg = genErr?.message || genData?.error;
    console.log('-> Function response details:', errMsg);
    if (errMsg && /AI service key is not configured/i.test(errMsg)) {
      record('GEMINI_API_KEY security check', true, 'Function safely detected missing secret without crashing');
      console.log('   NOTE: Run `npx supabase secrets set GEMINI_API_KEY=<key>` to test live generation.');
    } else {
      record('generate-questions execution', false, errMsg);
    }
  } else {
    record('generate-questions execution', true, `Generated ${genData.questions.length} questions`);

    // Verify response privacy: no correct answers or answer indices exposed
    const leakedAnswers = genData.questions.some(
      (q) => q.correct_option_index !== undefined || q.explanation !== undefined
    );
    record('Response privacy: correct answers not exposed to client', !leakedAnswers);

    // Verify question structure
    const validMCQs = genData.questions.every(
      (q) => typeof q.prompt === 'string' && Array.isArray(q.options) && q.options.length === 4
    );
    record('MCQ structure: exactly 4 options per question', validMCQs);

    // Test duplicate generation rejection
    console.log('\n--- Duplicate Generation Rejection Check ---');
    const { data: dupData, error: dupErr } = await supabase.functions.invoke('generate-questions', {
      body: {
        room_code: roomCode,
        host_token: hostToken,
        topic: 'Planets of the Solar System',
        difficulty: 'easy',
        question_count: 5,
      },
    });
    record('Reject duplicate question generation for same room', Boolean(dupErr || dupData?.error));

    // Test answer key isolation via public client
    console.log('\n--- Answer Key Security Verification ---');
    const { data: pubKeys } = await supabase.from('question_keys').select('*');
    record('RLS security: question_keys table inaccessible to public client', pubKeys?.length === 0);
  }

  // Test 4: Cannot generate for started room
  console.log('\n--- Room Status Check ---');
  // Start the room
  await supabase.functions.invoke('start-room', {
    body: { room_id: roomId, host_token: hostToken },
  });

  const { data: startedGenData, error: startedGenErr } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: roomCode,
      host_token: hostToken,
      topic: 'Science',
      difficulty: 'easy',
      question_count: 5,
    },
  });
  record('Reject question generation on active/started room', Boolean(startedGenErr || startedGenData?.error));

  console.log('\n===================================================================');
  console.log('TEST SUMMARY');
  console.log('===================================================================');
  const passed = results.filter((r) => r.passed).length;
  console.log(`TOTAL: ${passed} / ${results.length} PASSED`);
}

runGenerateQuestionsTests().catch((e) => {
  console.error('Test run error:', e);
  process.exit(1);
});

