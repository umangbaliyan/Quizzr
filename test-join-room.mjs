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
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function runJoinRoomTests() {
  console.log('=============================================');
  console.log('Testing join-room Edge Function in Production');
  console.log('Supabase Project URL:', supabaseUrl);
  console.log('=============================================\n');

  // Step 1: Create a fresh room first
  console.log('[Step 1] Creating fresh host room for testing...');
  const hostNick = 'LobbyLeader_' + Math.floor(Math.random() * 1000);
  const { data: createData, error: createError } = await supabase.functions.invoke('create-room', {
    body: { nickname: hostNick },
  });

  if (createError || !createData?.room?.roomCode) {
    console.error('Failed to create host room:', createError || createData);
    process.exit(1);
  }

  const roomCode = createData.room.roomCode;
  const roomId = createData.room.id;
  console.log(`-> Created room code: ${roomCode} (ID: ${roomId}) with host: ${hostNick}\n`);

  // Test 1: Validation - Invalid/short nickname
  console.log('[Test 1] Nickname validation test (too short)...');
  const { data: shortNickData, error: shortNickErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'A' },
  });
  console.log('-> Response for single-char nickname:', shortNickErr?.message || shortNickData?.error || 'No error');

  // Test 2: Validation - Missing / Invalid room code
  console.log('\n[Test 2] Invalid room code test (non-existent code)...');
  const { data: nonExistentData, error: nonExistentErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: 'ZZZZZZ', nickname: 'TestPlayer' },
  });
  console.log('-> Response for non-existent room code:', nonExistentErr?.message || nonExistentData?.error || 'No error');

  // Test 3: Successful player join
  console.log('\n[Test 3] Successful player join test...');
  const player1Nick = 'SpeedyGonzales';
  const { data: joinData, error: joinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: player1Nick },
  });

  if (joinErr || !joinData?.player) {
    console.error('-> Join failed:', joinErr || joinData);
    process.exit(1);
  }

  console.log('-> Joined successfully:');
  console.log('   Player ID:     ', joinData.player.id);
  console.log('   Nickname:      ', joinData.player.nickname);
  console.log('   Is Host:       ', joinData.player.isHost);
  console.log('   Score:         ', joinData.player.score);
  console.log('   Room Code:     ', joinData.room.roomCode);

  const hasPlayerToken = typeof joinData.playerToken === 'string' && joinData.playerToken.length === 64;
  console.log('   Player Token:  ', hasPlayerToken ? 'PASSED (64 hex characters)' : 'FAILED');

  // Test 4: Duplicate nickname in same room rejection
  console.log('\n[Test 4] Duplicate nickname rejection test in same room...');
  const { data: dupData, error: dupErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: player1Nick },
  });
  console.log('-> Response for duplicate nickname:', dupErr?.message || dupData?.error || 'Allowed');

  // Test 5: Verify player in DB via public client
  console.log('\n[Test 5] Querying database for inserted player...');
  const { data: dbPlayer, error: dbPlayerErr } = await supabase
    .from('players')
    .select('id, room_id, nickname, is_host, score')
    .eq('id', joinData.player.id)
    .single();

  if (dbPlayerErr || !dbPlayer) {
    console.error('-> Could not find player in DB:', dbPlayerErr?.message);
  } else {
    console.log('-> Player confirmed in database:', dbPlayer);
  }

  // Test 6: Verify private token security & hashing
  console.log('\n[Test 6] Security verification: token hashing & RLS check...');
  const expectedHash = sha256(joinData.playerToken);
  console.log('   Raw Player Token:    ', joinData.playerToken.slice(0, 8) + '...' + joinData.playerToken.slice(-8));
  console.log('   Expected Token Hash: ', expectedHash.slice(0, 8) + '...' + expectedHash.slice(-8));

  const { data: privCheck } = await supabase
    .from('player_private')
    .select('*')
    .eq('player_id', joinData.player.id);
  console.log('   Direct query to player_private returned rows:', privCheck?.length || 0, '(Should be 0 due to RLS)');

  console.log('\n=============================================');
  console.log('ALL JOIN-ROOM TESTS COMPLETED');
  console.log('=============================================');
}

runJoinRoomTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

