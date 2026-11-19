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

async function runComprehensiveVerification() {
  console.log('===================================================================');
  console.log(' Quizzr Host Management & Realtime Synchronization Verification');
  console.log('===================================================================\n');

  // Step 1: Create room
  console.log('[Step 1] Creating test room...');
  const { data: createData, error: createErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostCommander' },
  });

  if (createErr || !createData?.room?.id) {
    console.error('Failed to create room:', createErr || createData);
    process.exit(1);
  }

  const roomId = createData.room.id;
  const roomCode = createData.room.roomCode;
  const hostToken = createData.hostToken;
  console.log(`-> Room created: ${roomCode} (${roomId})\n`);

  // Step 2: Client-side synchronized player list simulation
  console.log('[Step 2] Simulating client-side synchronized player list (INSERT & DELETE)...');
  const synchronizedPlayers = [{ id: createData.hostPlayer.id, nickname: createData.hostPlayer.nickname }];

  const channel = supabase
    .channel(`verify_room_players_${roomId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'players',
        filter: `room_id=eq.${roomId}`,
      },
      (payload) => {
        console.log(`   [Realtime Event: INSERT] Player joined: ${payload.new.nickname}`);
        synchronizedPlayers.push(payload.new);
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
        console.log(`   [Realtime Event: DELETE] Player removed ID: ${payload.old.id}`);
        const idx = synchronizedPlayers.findIndex((p) => p.id === payload.old.id);
        if (idx !== -1) synchronizedPlayers.splice(idx, 1);
      }
    );

  await new Promise((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('   Subscription active.');
        resolve();
      }
    });
  });

  // Step 3: Join multiple players
  console.log('\n[Step 3] Joining players Alice, Bob, Charlie...');
  const { data: p1 } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'Alice' },
  });
  const { data: p2 } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'Bob' },
  });
  const { data: p3 } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'Charlie' },
  });

  // Allow Realtime events to propagate
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`-> Synchronized player count after joins: ${synchronizedPlayers.length} (Expected: 4: Host + 3 players)`);

  // Step 4: Security Verification - Direct updates/deletes blocked by RLS
  console.log('\n[Step 4] Verifying Row-Level Security (RLS) enforcement...');
  // A: Public client attempting direct room status modification
  const { data: directRoomUpdate } = await supabase
    .from('rooms')
    .update({ status: 'in_progress' })
    .eq('id', roomId)
    .select();
  console.log('   Direct public UPDATE on rooms modified rows:', directRoomUpdate?.length || 0, '(Expected: 0 - RLS blocked)');

  // B: Public client attempting direct player deletion
  const { data: directPlayerDel } = await supabase
    .from('players')
    .delete()
    .eq('id', p1.player.id)
    .select();
  console.log('   Direct public DELETE on players modified rows:', directPlayerDel?.length || 0, '(Expected: 0 - RLS blocked)');

  // C: Direct access to room_private and player_private
  const { data: privRoom } = await supabase.from('room_private').select('*').eq('room_id', roomId);
  console.log('   Direct query to room_private returned rows:', privRoom?.length || 0, '(Expected: 0 - RLS blocked)');

  const { data: privPlayer } = await supabase.from('player_private').select('*').eq('player_id', p1.player.id);
  console.log('   Direct query to player_private returned rows:', privPlayer?.length || 0, '(Expected: 0 - RLS blocked)');

  // Step 5: Test start-room concurrency & race conditions
  console.log('\n[Step 5] Testing start-room race conditions & state transition safety...');
  console.log('   Firing 3 concurrent start-room requests (1 authorized, 2 unauthorized)...');
  const [resAuth, resUnauth1, resUnauth2] = await Promise.all([
    supabase.functions.invoke('start-room', {
      body: { room_id: roomId, host_token: hostToken },
    }),
    supabase.functions.invoke('start-room', {
      body: { room_id: roomId, host_token: 'fake_token_1111111111111111111111111111111111111111111111111111111111111111' },
    }),
    supabase.functions.invoke('start-room', {
      body: { room_id: roomId, host_token: 'fake_token_2222222222222222222222222222222222222222222222222222222222222222' },
    }),
  ]);

  console.log('   Authorized request result:', resAuth.data?.message || resAuth.error?.message);
  console.log('   Unauthorized 1 result:   ', resUnauth1.error?.message || resUnauth1.data?.error);
  console.log('   Unauthorized 2 result:   ', resUnauth2.error?.message || resUnauth2.data?.error);

  // Step 6: Verify concurrent join vs start lock
  console.log('\n[Step 6] Testing concurrent join-room attempt after start...');
  const { data: lateJoinData, error: lateJoinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: roomCode, nickname: 'LateDave' },
  });
  console.log('   Late join attempt response:', lateJoinErr?.message || lateJoinData?.error);

  supabase.removeChannel(channel);

  console.log('\n===================================================================');
  console.log('ALL VERIFICATIONS COMPLETED');
  console.log('===================================================================');
}

runComprehensiveVerification().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});

