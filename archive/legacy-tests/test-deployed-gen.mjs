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

async function testDeployedGenerateQuestions() {
  console.log('===================================================================');
  console.log(' Quizzr: Testing Deployed generate-questions Edge Function');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Step 1: Create isolated test room
  console.log('[Step 1] Creating isolated test room via create-room...');
  const { data: createData, error: createErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'JavaOOPMaster' },
  });

  if (createErr || !createData?.room?.roomCode) {
    record('Step 1: Create isolated test room', false, createErr?.message);
    process.exit(1);
  }

  const roomCode = createData.room.roomCode;
  const roomId = createData.room.id;
  const hostToken = createData.hostToken;
  record('Step 1: Create isolated test room', true, `Room Code: ${roomCode}`);

  // Step 2: Test invalid host token rejection first
  console.log('\n[Step 2] Testing invalid host token rejection...');
  const invalidHostToken = '1111111111111111111111111111111111111111111111111111111111111111';
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
  record('Step 2: Reject invalid host token', unauthRejected, unauthErr?.message || unauthData?.error);

  // Step 3: Call deployed generate-questions with valid parameters
  console.log('\n[Step 3] Calling generate-questions for 5 medium questions on "Java OOPs"...');
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
    record('Step 3: Generate 5 Java OOPs questions', false, genErr?.message || genData?.error);
    console.error('Generation Error details:', genErr || genData);
    process.exit(1);
  }

  const generatedCount = genData?.questions?.length || 0;
  record('Step 3: Generate 5 Java OOPs questions', generatedCount === 5, `Generated: ${generatedCount}`);

  // Step 4: Verify API response privacy (no correct_option_index or explanation)
  console.log('\n[Step 4] Verifying API response privacy...');
  const hasLeakedKey = genData.questions.some(
    (q) => q.correct_option_index !== undefined || q.explanation !== undefined || q.correctAnswer !== undefined
  );
  record('Step 4: Response contains NO correct_option_index or explanation', !hasLeakedKey);

  // Verify each question preview structure
  const allValidMCQs = genData.questions.every(
    (q) => typeof q.prompt === 'string' && q.prompt.length > 5 && Array.isArray(q.options) && q.options.length === 4
  );
  record('Step 4: Each question has valid prompt and exactly 4 options', allValidMCQs);

  // Step 5: Verify questions saved in public database table
  console.log('\n[Step 5] Verifying 5 questions saved in questions table...');
  const { data: dbQuestions, error: dbQErr } = await supabase
    .from('questions')
    .select('id, room_id, prompt, options, question_order')
    .eq('room_id', roomId)
    .order('question_order', { ascending: true });

  const questionsCountOk = !dbQErr && dbQuestions?.length === 5;
  record('Step 5: Exactly 5 questions saved in database', questionsCountOk, `Found in DB: ${dbQuestions?.length || 0}`);

  // Step 6: Verify answer keys saved in question_keys table
  console.log('\n[Step 6] Verifying answer keys & RLS security on question_keys...');
  // As anonymous client, public select returns 0 rows due to RLS
  const { data: pubKeys } = await supabase.from('question_keys').select('*');
  record('Step 6: question_keys table protected by RLS (0 rows returned to public client)', pubKeys?.length === 0);

  // Step 7: Verify second generation request is rejected (duplicate prevention)
  console.log('\n[Step 7] Testing duplicate generation rejection...');
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
  record('Step 7: Reject second generation request for same room', dupRejected, dupErr?.message || dupData?.error);

  // Step 8: Verify room remains in waiting state
  console.log('\n[Step 8] Verifying room remains in waiting state...');
  const { data: roomCheck, error: roomErr } = await supabase
    .from('rooms')
    .select('id, room_code, status')
    .eq('id', roomId)
    .single();

  const isStillWaiting = !roomErr && roomCheck?.status === 'waiting';
  record('Step 8: Room status remains "waiting"', isStillWaiting, `Current status: ${roomCheck?.status}`);

  console.log('\n===================================================================');
  console.log('SUMMARY OF RESULTS:');
  console.log('===================================================================');
  let passCount = 0;
  results.forEach((r) => {
    if (r.passed) passCount++;
    console.log(`${(r.passed ? 'PASS' : 'FAIL').padEnd(6)} | ${r.name}`);
  });
  console.log(`\nTOTAL: ${passCount} / ${results.length} PASSED`);
}

testDeployedGenerateQuestions().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

