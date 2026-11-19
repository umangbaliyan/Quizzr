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

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runHostAndRealtimeTests() {
  console.log('===============================================================');
  console.log('Testing Host Room Management & Realtime Player Synchronization');
  console.log('Supabase URL:', supabaseUrl);
  console.log('===============================================================\n');

  // Step 1: Create room as host
  console.log('[Step 1] Creating a test room with Host...');
  const { data: createData, error: createError } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostCommander' },
  });

  if (createError || !createData?.room?.id) {
    console.error('Failed to create room:', createError || createData);
    process.exit(1);
  }

  const roomId = createData.room.id;
  const roomCode = createData.room.roomCode;
  const validHostToken = createData.hostToken;
  const invalidHostToken = '0000000000000000000000000000000000000000000000000000000000000000';

  console.log(`-> Room created: Code = ${roomCode}, ID = ${roomId}`);
  console.log(`-> Valid Host Token received (len: ${validHostToken.length})\n`);

  // Step 2: Test Realtime Player Synchronization
  console.log('[Step 2] Setting up Supabase Realtime channel for player join synchronization...');
  const receivedEvents = [];

  const playerChannel = supabase
    .channel(`room_players_${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'players',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        console.log(`   [Realtime Event] Player joined: ${payload.new.nickname} (is_host: ${payload.new.is_host})`);
        receivedEvents.push(payload.new);
      }
    );

  await new Promise((resolve) => {
    playerChannel.subscribe((status) => {
      console.log(`   Channel subscription status: ${status}`);
      if (status === 'SUBSCRIBED') {
        resolve(true);
      }
    });
  });

  // Step 3: Join player 1 & player 2
  console.log('\n[Step 3] Joining players via join-room function...');
  const { data: p1Data } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'Alice' },
  });
  console.log('   Player Alice joined:', p1Data?.player?.nickname);

  const { data: p2Data } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'Bob' },
  });
  console.log('   Player Bob joined:', p2Data?.player?.nickname);

  // Wait a brief moment for realtime broadcast
  console.log('   Waiting for Realtime events to propagate...');
  await new Promise((r) => setTimeout(r, 2500));

  console.log(`-> Realtime events captured: ${receivedEvents.length}`);
  supabase.removeChannel(playerChannel);

  // Step 4: Test Unauthorized start-room call (invalid host token)
  console.log('\n[Step 4] Testing unauthorized start-room attempt (invalid token)...');
  const { data: unauthData, error: unauthErr } = await supabase.functions.invoke('start-room', {
    body: {
      room_id: roomId,
      host_token: invalidHostToken,
    },
  });

  if (unauthErr || unauthData?.error) {
    console.log('-> Correctly rejected unauthorized host token:', unauthErr?.message || unauthData?.error);
  } else {
    console.error('-> SECURITY FAILURE: Invalid host token was accepted!');
    process.exit(1);
  }

  // Step 5: Test Authorized start-room call (valid host token)
  console.log('\n[Step 5] Testing authorized start-room attempt (valid token)...');
  const { data: startData, error: startErr } = await supabase.functions.invoke('start-room', {
    body: {
      room_id: roomId,
      host_token: validHostToken,
    },
  });

  if (startErr || !startData?.room) {
    console.error('-> start-room invocation failed:', startErr || startData);
    process.exit(1);
  }

  console.log('-> Room started successfully:');
  console.log('   New Status: ', startData.room.status);
  const isStarted = startData.room.status === 'in_progress';
  console.log('   Status is in_progress: ', isStarted ? 'PASSED' : 'FAILED');

  // Step 6: Test that new players CANNOT join once room is in_progress
  console.log('\n[Step 6] Testing join prevention on in_progress room...');
  const { data: lateJoinData, error: lateJoinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'LateComer' },
  });

  if (lateJoinErr || lateJoinData?.error) {
    console.log('-> Correctly rejected late join attempt:', lateJoinErr?.message || lateJoinData?.error);
  } else {
    console.error('-> FAILURE: Player was allowed to join an in_progress room!');
    process.exit(1);
  }

  // Step 7: Test duplicate start attempt (room already in_progress)
  console.log('\n[Step 7] Testing starting an already in_progress room...');
  const { data: dupStartData, error: dupStartErr } = await supabase.functions.invoke('start-room', {
    body: {
      room_id: roomId,
      host_token: validHostToken,
    },
  });
  console.log('-> Response for starting active room:', dupStartErr?.message || dupStartData?.error);

  console.log('\n===============================================================');
  console.log('ALL HOST & REALTIME INTEGRATION TESTS COMPLETED');
  console.log('===============================================================');
}

runHostAndRealtimeTests().catch((err) => {
  console.error('Host & Realtime test failed:', err);
  process.exit(1);
});

