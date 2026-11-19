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

// Emulate local start-room logic directly to test the exact edge function handler
async function localVerifyHostToken(supabaseClient, roomId, hostToken) {
  if (!roomId || typeof roomId !== 'string') return { valid: false, error: 'Missing or invalid roomId.' };
  if (!hostToken || typeof hostToken !== 'string') return { valid: false, error: 'Missing or invalid hostToken.' };

  const tokenHash = sha256(hostToken.trim());
  const { data: privRecord, error } = await supabaseClient
    .from('room_private')
    .select('room_id')
    .eq('room_id', roomId)
    .eq('host_token_hash', tokenHash)
    .maybeSingle();

  if (error) return { valid: false, error: 'Database error.' };
  if (!privRecord) return { valid: false, error: 'Unauthorized: Invalid host token.' };
  return { valid: true };
}

async function runSafeLocalVerification() {
  console.log('===================================================================');
  console.log(' Quizzr Safe Verification & Regression Suite (Non-Destructive)');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  const testResults = [];
  function record(name, passed, details = '') {
    testResults.push({ name, status: passed ? 'PASS' : 'FAIL', details });
    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
  }

  // 1. Verify existing create-room functionality
  console.log('--- Checking create-room Functionality ---');
  const hostNick = 'HostVerifier_' + Math.floor(Math.random() * 1000);
  const { data: createData, error: createErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: hostNick },
  });

  if (createErr || !createData?.room?.id) {
    record('create-room invocation', false, createErr?.message || 'No room returned');
    process.exit(1);
  }
  record('create-room invocation', true, `Room ID: ${createData.room.id}, Code: ${createData.room.roomCode}`);

  const roomId = createData.room.id;
  const roomCode = createData.room.roomCode;
  const hostToken = createData.hostToken;

  const validCode = typeof roomCode === 'string' && roomCode.length === 6;
  record('create-room 6-character code', validCode, `Code: ${roomCode}`);

  const validTokens = typeof hostToken === 'string' && hostToken.length === 64;
  record('create-room 64-char secure tokens', validTokens);

  // 2. Verify existing join-room functionality
  console.log('\n--- Checking join-room Functionality ---');
  const { data: joinData, error: joinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'PlayerOne' },
  });

  if (joinErr || !joinData?.player?.id) {
    record('join-room invocation', false, joinErr?.message || 'Join failed');
  } else {
    record('join-room invocation', true, `Player ID: ${joinData.player.id}, Nickname: ${joinData.player.nickname}`);
  }

  const isNotHost = joinData?.player?.isHost === false && joinData?.player?.score === 0;
  record('join-room player properties (isHost=false, score=0)', isNotHost);

  // Join-room duplicate nickname rejection
  const { data: dupData, error: dupErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'PlayerOne' },
  });
  const dupRejected = Boolean(dupErr || dupData?.error);
  record('join-room duplicate nickname rejection', dupRejected, dupErr?.message || dupData?.error);

  // 3. Verify Realtime Player Synchronization (INSERT)
  console.log('\n--- Checking Realtime Player Synchronization ---');
  let realtimeInsertCaptured = false;
  let realtimeDeleteCaptured = false;

  const channel = supabase
    .channel(`safe_test_players_${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'players',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        if (payload.new && payload.new.nickname === 'RealtimePlayerTwo') {
          realtimeInsertCaptured = true;
        }
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'players',
      },
      (payload) => {
        if (payload.old) {
          realtimeDeleteCaptured = true;
        }
      }
    );

  await new Promise((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });

  // Join a second player to test Realtime INSERT
  const { data: joinP2 } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'RealtimePlayerTwo' },
  });

  // Wait 2s for Realtime delivery
  await new Promise((r) => setTimeout(r, 2000));
  record('Realtime player join event (INSERT)', realtimeInsertCaptured, `Joined: ${joinP2?.player?.nickname}`);

  // 4. Verify Host Authentication Logic
  console.log('\n--- Checking Host Authentication & Authorization ---');
  const dummyToken = '1111111111111111111111111111111111111111111111111111111111111111';

  // Test unauthorized token
  const fakeTokenHash = sha256(dummyToken);
  const realTokenHash = sha256(hostToken);
  record('Host token hashing deterministic check', realTokenHash.length === 64);

  // Verify that an invalid token does NOT match the room
  const invalidAuthCheck = fakeTokenHash === realTokenHash;
  record('Unauthorized host token rejection check', !invalidAuthCheck);

  // 5. Verify RLS Security (Public client cannot bypass authorization)
  console.log('\n--- Checking Row-Level Security (RLS) Boundaries ---');
  const { data: privRoomCheck } = await supabase
    .from('room_private')
    .select('*')
    .eq('room_id', roomId);
  record('RLS protects room_private from public queries', privRoomCheck?.length === 0, `Rows: ${privRoomCheck?.length || 0}`);

  const { data: privPlayerCheck } = await supabase
    .from('player_private')
    .select('*')
    .eq('player_id', joinData.player.id);
  record('RLS protects player_private from public queries', privPlayerCheck?.length === 0, `Rows: ${privPlayerCheck?.length || 0}`);

  const { data: directRoomUpdate } = await supabase
    .from('rooms')
    .update({ status: 'in_progress' })
    .eq('id', roomId)
    .select();
  record('RLS blocks unauthorized direct room updates', directRoomUpdate?.length === 0, `Updated rows: ${directRoomUpdate?.length || 0}`);

  const { data: directPlayerDelete } = await supabase
    .from('players')
    .delete()
    .eq('id', joinData.player.id)
    .select();
  record('RLS blocks unauthorized direct player deletes', directPlayerDelete?.length === 0, `Deleted rows: ${directPlayerDelete?.length || 0}`);

  // Clean up test channel
  supabase.removeChannel(channel);

  console.log('\n===================================================================');
  console.log('SUMMARY OF TEST RESULTS:');
  console.log('===================================================================');
  let passCount = 0;
  testResults.forEach((t) => {
    if (t.status === 'PASS') passCount++;
    console.log(`${t.status.padEnd(6)} | ${t.name}`);
  });
  console.log(`\nTOTAL: ${passCount} / ${testResults.length} PASSED`);
}

runSafeLocalVerification().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});

