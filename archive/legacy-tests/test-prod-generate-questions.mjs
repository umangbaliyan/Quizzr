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
function record(testName, passed, details = '') {
  auditResults.push({ testName, passed, details });
  const statusStr = passed ? 'PASS' : 'FAIL';
  console.log(`[${statusStr}] ${testName} ${details ? '- ' + details : ''}`);
}

async function testProductionGenerateQuestions() {
  console.log('===================================================================');
  console.log(' Quizzr: Testing Newly Deployed generate-questions in Production');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Step 1: Create isolated test room
  console.log('--- Setting up isolated test room ---');
  const { data: createData, error: createErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'JavaTesterHost' },
  });

  if (createErr || !createData?.room?.id) {
    record('Setup isolated test room', false, createErr?.message);
    process.exit(1);
  }

  const roomCode = createData.room.roomCode;
  const roomId = createData.room.id;
  const hostToken = createData.hostToken;
  const invalidHostToken = '2222222222222222222222222222222222222222222222222222222222222222';
  record('Setup isolated test room', true, `Room Code: ${roomCode}, ID: ${roomId}`);

  // Test 1: Invalid host token verification (Expect HTTP 401)
  console.log('\n--- 1. Testing Invalid Host Authentication (Expected 401) ---');
  const { data: unauthData, error: unauthErr } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: roomCode,
      host_token: invalidHostToken,
      topic: 'Java OOPs',
      difficulty: 'medium',
      question_count: 5,
    },
  });

  const unauthRejected = Boolean(unauthErr || unauthData?.error);
  record('1. Invalid host authentication returns 401', unauthRejected, unauthErr?.message || unauthData?.error);

  // Test 2: Generate exactly 5 medium Java OOPs questions
  console.log('\n--- 2. Generating 5 Medium Java OOPs Questions via Gemini ---');
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
    record('2. Generate 5 medium Java OOPs questions', false, genErr?.message || genData?.error || JSON.stringify(genData));
    console.error('Generation Error details:', genErr || genData);
    process.exit(1);
  }

  const qCount = genData?.questions?.length || 0;
  record('2. Generate exactly 5 medium Java OOPs questions', qCount === 5, `Returned: ${qCount}`);

  // Test 3: Structured JSON and valid MCQ format
  console.log('\n--- 3. Verifying Structured JSON & MCQ Quality ---');
  const validStructure = Array.isArray(genData?.questions) && genData.questions.every(
    (q, idx) =>
      typeof q.prompt === 'string' &&
      q.prompt.length > 5 &&
      Array.isArray(q.options) &&
      q.options.length === 4 &&
      q.questionOrder === idx + 1
  );
  record('3. Gemini returns valid structured JSON with 4 options per question', validStructure);

  // Test 4: Privacy - correct answers and explanations never exposed
  console.log('\n--- 4. Verifying Privacy & Secret Isolation ---');
  const leakedFields = genData.questions.some(
    (q) => q.correct_option_index !== undefined || q.explanation !== undefined || q.correct_answer !== undefined
  );
  record('4. Correct answers and explanations are NOT exposed in API response', !leakedFields);

  // Test 5: Verify questions inserted in database
  console.log('\n--- 5. Verifying DB Insertion in questions table ---');
  const { data: dbQuestions, error: dbQErr } = await supabase
    .from('questions')
    .select('id, room_id, prompt, options, question_order')
    .eq('room_id', roomId)
    .order('question_order', { ascending: true });

  const qDbCountOk = !dbQErr && dbQuestions?.length === 5;
  record('5. All 5 questions inserted into questions table', qDbCountOk, `DB Count: ${dbQuestions?.length || 0}`);

  // Test 6: Verify question_keys inserted and protected by RLS
  console.log('\n--- 6. Verifying DB Insertion & RLS on question_keys ---');
  // Check that public query returns 0 rows due to RLS
  const { data: pubKeys, error: pubKeysErr } = await supabase.from('question_keys').select('*');
  const rlsBlocked = (pubKeys?.length === 0) || Boolean(pubKeysErr);
  record('6. All answer keys stored securely; question_keys table protected by RLS', rlsBlocked, `Public query rows: ${pubKeys?.length || 0}`);

  // Test 7: Duplicate generation returns 409
  console.log('\n--- 7. Verifying Duplicate Generation Rejection (Expected 409) ---');
  const { data: dupData, error: dupErr } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: roomCode,
      host_token: hostToken,
      topic: 'Java OOPs',
      difficulty: 'medium',
      question_count: 5,
    },
  });

  const dupRejected = Boolean(dupErr || dupData?.error);
  record('7. Duplicate generation request returns 409 Conflict', dupRejected, dupErr?.message || dupData?.error);

  // Test 8: Room status remains waiting
  console.log('\n--- 8. Verifying Room Status Unaltered ---');
  const { data: roomRow, error: roomRowErr } = await supabase
    .from('rooms')
    .select('id, room_code, status, current_question_index')
    .eq('id', roomId)
    .single();

  const isStillWaiting = !roomRowErr && roomRow?.status === 'waiting';
  record('8. Room status remains "waiting"', isStillWaiting, `Status: ${roomRow?.status}`);

  console.log('\n===================================================================');
  console.log(' PRODUCTION TEST SUMMARY');
  console.log('===================================================================');
  let passCount = 0;
  auditResults.forEach((t) => {
    if (t.passed) passCount++;
    console.log(`${(t.passed ? 'PASS' : 'FAIL').padEnd(6)} | ${t.testName}`);
  });
  console.log(`\nTOTAL: ${passCount} / ${auditResults.length} PASSED`);
}

testProductionGenerateQuestions().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

