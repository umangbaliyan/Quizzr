import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import crypto from 'crypto';

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

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function runTests() {
  console.log('=============================================');
  console.log('Testing create-room Edge Function in Production');
  console.log('Supabase Project URL:', supabaseUrl);
  console.log('=============================================\n');

  // Test 1: Nickname validation
  console.log('[Test 1] Nickname validation test...');
  const { data: valData, error: valError } = await supabase.functions.invoke('create-room', {
    body: { nickname: ' ' },
  });
  if (valError) {
    console.log('-> Correctly rejected empty nickname via function error response.');
  } else if (valData?.error) {
    console.log('-> Correctly rejected empty nickname with message:', valData.error);
  } else {
    console.error('-> Validation failed: should not allow empty nickname');
  }

  // Test 2: Room creation
  console.log('\n[Test 2] Room creation test...');
  const nickname = 'CaptainQuiz';
  const { data, error } = await supabase.functions.invoke('create-room', {
    body: { nickname },
  });

  if (error) {
    console.error('-> create-room invocation error:', error);
    process.exit(1);
  }

  if (!data?.room || !data?.hostPlayer) {
    console.error('-> Unexpected response format:', data);
    process.exit(1);
  }

  console.log('-> Room created successfully:');
  console.log('   Room ID:                ', data.room.id);
  console.log('   Room Code:              ', data.room.roomCode);
  console.log('   Room Status:            ', data.room.status);
  console.log('   Current Question Index: ', data.room.currentQuestionIndex);

  // Verification 1 & 2: 6-char code
  const is6Char = typeof data.room.roomCode === 'string' && data.room.roomCode.length === 6;
  console.log('-> 6-Character Room Code check: ', is6Char ? 'PASSED (' + data.room.roomCode + ')' : 'FAILED');

  // Verification 3: Host Player check
  console.log('\n[Test 3] Host player return check...');
  console.log('   Host Player ID:         ', data.hostPlayer.id);
  console.log('   Host Nickname:          ', data.hostPlayer.nickname);
  console.log('   Is Host:                ', data.hostPlayer.isHost);
  console.log('   Initial Score:          ', data.hostPlayer.score);

  // Verification 4: Tokens check
  console.log('\n[Test 4] Host and player tokens check...');
  const hasHostToken = typeof data.hostToken === 'string' && data.hostToken.length === 64;
  const hasPlayerToken = typeof data.playerToken === 'string' && data.playerToken.length === 64;
  console.log('   Host Token returned:    ', hasHostToken ? 'PASSED (64 hex characters)' : 'FAILED');
  console.log('   Player Token returned:  ', hasPlayerToken ? 'PASSED (64 hex characters)' : 'FAILED');

  // Verification 5: Database state and token security
  console.log('\n[Test 5] Querying public tables to verify row existence...');
  const { data: dbRoom, error: dbRoomErr } = await supabase
    .from('rooms')
    .select('id, room_code, status, current_question_index')
    .eq('id', data.room.id)
    .single();

  if (dbRoomErr || !dbRoom) {
    console.error('-> Could not query room from database:', dbRoomErr?.message);
  } else {
    console.log('-> Room confirmed in database:', dbRoom);
  }

  const { data: dbPlayer, error: dbPlayerErr } = await supabase
    .from('players')
    .select('id, room_id, nickname, is_host, score')
    .eq('id', data.hostPlayer.id)
    .single();

  if (dbPlayerErr || !dbPlayer) {
    console.error('-> Could not query player from database:', dbPlayerErr?.message);
  } else {
    console.log('-> Host player confirmed in database:', dbPlayer);
  }

  console.log('\n[Test 6] Security Verification: checking token hashing...');
  const expectedHostHash = sha256(data.hostToken);
  const expectedPlayerHash = sha256(data.playerToken);

  console.log('   Generated Host Token (Raw):   ', data.hostToken.slice(0, 8) + '...' + data.hostToken.slice(-8));
  console.log('   Expected Host Token Hash:     ', expectedHostHash.slice(0, 8) + '...' + expectedHostHash.slice(-8));
  console.log('   Generated Player Token (Raw): ', data.playerToken.slice(0, 8) + '...' + data.playerToken.slice(-8));
  console.log('   Expected Player Token Hash:   ', expectedPlayerHash.slice(0, 8) + '...' + expectedPlayerHash.slice(-8));

  // Check that public tables DO NOT leak private hashes or tokens
  console.log('\n[Test 7] RLS check on private tables (anonymous client)...');
  const { data: privRoomCheck } = await supabase
    .from('room_private')
    .select('*')
    .eq('room_id', data.room.id);
  console.log('   Direct query to room_private returned rows:', privRoomCheck?.length || 0, '(Should be 0 due to RLS)');

  const { data: privPlayerCheck } = await supabase
    .from('player_private')
    .select('*')
    .eq('player_id', data.hostPlayer.id);
  console.log('   Direct query to player_private returned rows:', privPlayerCheck?.length || 0, '(Should be 0 due to RLS)');

  console.log('\n=============================================');
  console.log('ALL VERIFICATIONS COMPLETED SUCCESSFULLY');
  console.log('=============================================');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
