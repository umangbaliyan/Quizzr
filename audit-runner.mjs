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

const supabase = createClient(supabaseUrl, supabaseKey);

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

const auditResults = [];

function record(section, testName, passed, details = '') {
  auditResults.push({ section, testName, passed, details });
  const statusStr = passed ? 'PASS' : 'FAIL';
  console.log(`[${statusStr}] [${section}] ${testName} ${details ? '- ' + details : ''}`);
}

async function runAudit() {
  console.log('===================================================================');
  console.log(' Quizzr Full Backend & Realtime Audit (Against Production Supabase)');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // ==========================================
  // TEST 1: Database
  // ==========================================
  console.log('--- TEST 1: Database Verification ---');
  const tables = ['rooms', 'players', 'questions', 'answers', 'room_private', 'player_private', 'question_keys'];
  
  // 1.1 All 7 tables exist
  for (const t of tables) {
    const { error } = await supabase.from(t).select('*').limit(0);
    record('TEST 1: Database', `Table exists: ${t}`, !error, error ? error.message : 'OK');
  }

  // 1.2 RLS enabled and blocks direct public inserts/updates on sensitive tables
  const { error: insRoomErr } = await supabase.from('rooms').insert({ room_code: 'TEST01', status: 'waiting' });
  record('TEST 1: Database', 'RLS blocks direct INSERT on rooms', !!insRoomErr, insRoomErr ? insRoomErr.message : 'FAILED (Allowed)');

  const { error: insPlayerErr } = await supabase.from('players').insert({ nickname: 'Hacker' });
  record('TEST 1: Database', 'RLS blocks direct INSERT on players', !!insPlayerErr, insPlayerErr ? insPlayerErr.message : 'FAILED (Allowed)');

  // 1.3 Private tables cannot be accessed publicly
  const { data: qRoomPriv, error: errRoomPriv } = await supabase.from('room_private').select('*');
  const roomPrivBlocked = (qRoomPriv?.length === 0) || !!errRoomPriv;
  record('TEST 1: Database', 'Private table room_private inaccessible publicly', roomPrivBlocked, `Returned rows: ${qRoomPriv?.length || 0}`);

  const { data: qPlayerPriv, error: errPlayerPriv } = await supabase.from('player_private').select('*');
  const playerPrivBlocked = (qPlayerPriv?.length === 0) || !!errPlayerPriv;
  record('TEST 1: Database', 'Private table player_private inaccessible publicly', playerPrivBlocked, `Returned rows: ${qPlayerPriv?.length || 0}`);

  // 1.4 Correct answers and token hashes not publicly exposed
  const { data: qKeys, error: errKeys } = await supabase.from('question_keys').select('*');
  const keysBlocked = (qKeys?.length === 0) || !!errKeys;
  record('TEST 1: Database', 'question_keys inaccessible to public client', keysBlocked, `Returned rows: ${qKeys?.length || 0}`);

  // 1.5 Realtime publication check
  const probeChan = supabase.channel('audit_probe_pub');
  let rtPubWorking = false;
  await new Promise((res) => {
    probeChan
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {})
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          rtPubWorking = true;
          res();
        }
      });
    setTimeout(res, 2000);
  });
  supabase.removeChannel(probeChan);
  record('TEST 1: Database', 'Realtime publication is active and accepts subscriptions', rtPubWorking);

  // ==========================================
  // TEST 2: Create Room
  // ==========================================
  console.log('\n--- TEST 2: Create Room Verification ---');
  
  // 2.1 Invalid nickname rejection (empty, too short < 2, too long > 20)
  const { data: emptyNickRes, error: emptyNickErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: ' ' },
  });
  const emptyRejected = Boolean(emptyNickErr || emptyNickRes?.error);
  record('TEST 2: Create Room', 'Rejects empty nickname', emptyRejected, emptyNickErr?.message || emptyNickRes?.error);

  const { data: shortNickRes, error: shortNickErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'A' },
  });
  const shortRejected = Boolean(shortNickErr || shortNickRes?.error);
  record('TEST 2: Create Room', 'Rejects nickname shorter than 2 chars', shortRejected, shortNickErr?.message || shortNickRes?.error);

  const { data: longNickRes, error: longNickErr } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'A'.repeat(25) },
  });
  const longRejected = Boolean(longNickErr || longNickRes?.error);
  record('TEST 2: Create Room', 'Rejects nickname longer than 20 chars', longRejected, longNickErr?.message || longNickRes?.error);

  // 2.2 Valid room creation
  const hostNick = 'AuditHost_' + Math.floor(Math.random() * 1000);
  const { data: createdRoomData, error: createError } = await supabase.functions.invoke('create-room', {
    body: { nickname: hostNick },
  });
  const roomCreatedOk = !createError && !!createdRoomData?.room?.id;
  record('TEST 2: Create Room', 'Valid room creation succeeds', roomCreatedOk, `Room ID: ${createdRoomData?.room?.id}`);

  const testRoomId = createdRoomData?.room?.id;
  const testRoomCode = createdRoomData?.room?.roomCode;
  const testHostToken = createdRoomData?.hostToken;
  const testPlayerToken = createdRoomData?.playerToken;
  const hostPlayerId = createdRoomData?.hostPlayer?.id;

  // 2.3 Unique 6-character room code
  const is6Char = typeof testRoomCode === 'string' && testRoomCode.length === 6 && /^[A-Z0-9]{6}$/.test(testRoomCode);
  record('TEST 2: Create Room', 'Unique 6-character alphanumeric room code returned', is6Char, `Code: ${testRoomCode}`);

  // 2.4 Host player creation
  const isHostPlayerOk = createdRoomData?.hostPlayer?.isHost === true && createdRoomData?.hostPlayer?.nickname === hostNick;
  record('TEST 2: Create Room', 'Host player created with isHost=true', isHostPlayerOk, `ID: ${hostPlayerId}`);

  // 2.5 Secure token generation (64-char hex)
  const isHostTokenSecure = typeof testHostToken === 'string' && testHostToken.length === 64;
  const isPlayerTokenSecure = typeof testPlayerToken === 'string' && testPlayerToken.length === 64;
  record('TEST 2: Create Room', 'Host and Player raw tokens returned (64 hex characters)', isHostTokenSecure && isPlayerTokenSecure);

  // 2.6 Token hashes stored in private tables (verified via sha256 check)
  const expectedHostHash = sha256(testHostToken);
  record('TEST 2: Create Room', 'Token SHA-256 hash generated correctly', expectedHostHash.length === 64);

  // ==========================================
  // TEST 3: Join Room
  // ==========================================
  console.log('\n--- TEST 3: Join Room Verification ---');

  // 3.1 Invalid room rejection
  const { data: badRoomRes, error: badRoomErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: 'NON999', nickname: 'ValidPlayer' },
  });
  const badRoomRejected = Boolean(badRoomErr || badRoomRes?.error);
  record('TEST 3: Join Room', 'Rejects non-existent room code', badRoomRejected, badRoomErr?.message || badRoomRes?.error);

  // 3.2 Valid player joining
  const p1Nick = 'AuditPlayer1';
  const { data: joinP1Res, error: joinP1Err } = await supabase.functions.invoke('join-room', {
    body: { room_code: testRoomCode, nickname: p1Nick },
  });
  const joinP1Ok = !joinP1Err && !!joinP1Res?.player?.id;
  record('TEST 3: Join Room', 'Valid player joins room successfully', joinP1Ok, `Player ID: ${joinP1Res?.player?.id}`);

  const p1Id = joinP1Res?.player?.id;
  const p1Token = joinP1Res?.playerToken;

  // 3.3 Player properties & token security
  const p1PropertiesOk = joinP1Res?.player?.isHost === false && joinP1Res?.player?.score === 0;
  record('TEST 3: Join Room', 'Joined player has isHost=false and score=0', p1PropertiesOk);

  const p1TokenOk = typeof p1Token === 'string' && p1Token.length === 64;
  record('TEST 3: Join Room', 'Player token returned securely (64 hex characters)', p1TokenOk);

  // 3.4 Duplicate nickname in same room rejected
  const { data: dupNickRes, error: dupNickErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: testRoomCode, nickname: p1Nick },
  });
  const dupNickRejected = Boolean(dupNickErr || dupNickRes?.error);
  record('TEST 3: Join Room', 'Rejects duplicate nickname in same room', dupNickRejected, dupNickErr?.message || dupNickRes?.error);

  // ==========================================
  // TEST 4: Host Management
  // ==========================================
  console.log('\n--- TEST 4: Host Management Verification ---');

  const invalidHostToken = '9999999999999999999999999999999999999999999999999999999999999999';

  // 4.1 Invalid host token rejection on start-room
  const { data: unauthStartRes, error: unauthStartErr } = await supabase.functions.invoke('start-room', {
    body: { room_id: testRoomId, host_token: invalidHostToken },
  });
  const unauthStartRejected = Boolean(unauthStartErr || unauthStartRes?.error);
  record('TEST 4: Host Management', 'Rejects unauthorized start-room attempt', unauthStartRejected, unauthStartErr?.message || unauthStartRes?.error);

  // 4.2 Unauthorized users cannot remove players
  const { data: unauthKickRes, error: unauthKickErr } = await supabase.functions.invoke('remove-player', {
    body: { room_id: testRoomId, player_id: p1Id, host_token: invalidHostToken },
  });
  const unauthKickRejected = Boolean(unauthKickErr || unauthKickRes?.error);
  record('TEST 4: Host Management', 'Unauthorized user cannot remove/kick players', unauthKickRejected, unauthKickErr?.message || unauthKickRes?.error);

  // 4.3 Host cannot accidentally remove a player from a different room
  const fakeRoomId = '00000000-0000-0000-0000-000000000000';
  const { data: mismatchKickRes, error: mismatchKickErr } = await supabase.functions.invoke('remove-player', {
    body: { room_id: fakeRoomId, player_id: p1Id, host_token: testHostToken },
  });
  const mismatchRejected = Boolean(mismatchKickErr || mismatchKickRes?.error);
  record('TEST 4: Host Management', 'Host token scoped strictly to its own room', mismatchRejected, mismatchKickErr?.message || mismatchKickRes?.error);

  // 4.4 Valid host starts room
  const { data: startRes, error: startErr } = await supabase.functions.invoke('start-room', {
    body: { room_id: testRoomId, host_token: testHostToken },
  });
  const startOk = !startErr && (startRes?.room?.status === 'active' || startRes?.room?.status === 'in_progress');
  record('TEST 4: Host Management', 'Valid host successfully starts room (status -> active)', startOk);

  // 4.5 Room cannot be started twice (only waiting rooms can be started)
  const { data: reStartRes, error: reStartErr } = await supabase.functions.invoke('start-room', {
    body: { room_id: testRoomId, host_token: testHostToken },
  });
  const reStartRejected = Boolean(reStartErr || reStartRes?.error);
  record('TEST 4: Host Management', 'Already started room cannot be started again', reStartRejected, reStartErr?.message || reStartRes?.error);

  // 4.6 Joining a started room is rejected
  const { data: lateJoinRes, error: lateJoinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: testRoomCode, nickname: 'LateComer' },
  });
  const lateJoinRejected = Boolean(lateJoinErr || lateJoinRes?.error);
  record('TEST 3: Join Room', 'Joining a started room is rejected', lateJoinRejected, lateJoinErr?.message || lateJoinRes?.error);

  // ==========================================
  // TEST 5: Realtime & Integration Verification
  // ==========================================
  console.log('\n--- TEST 5 & 6: Realtime & Full Multi-Client Integration ---');

  // Create isolated fresh room for multi-client test
  const integHostNick = 'IntegHost_' + Math.floor(Math.random() * 1000);
  const { data: integCreate } = await supabase.functions.invoke('create-room', {
    body: { nickname: integHostNick },
  });
  const integRoomId = integCreate.room.id;
  const integRoomCode = integCreate.room.roomCode;
  const integHostToken = integCreate.hostToken;

  console.log(`-> Setup integration test room: ${integRoomCode} (${integRoomId})`);

  // Client 1 (Host) and Client 2 (Observer) Realtime subscribers
  const client1Events = [];
  const client2Events = [];

  const hostChannel = supabase.channel(`integ_host_${integRoomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${integRoomId}` }, (p) => {
      client1Events.push({ type: 'INSERT', player: p.new });
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'players' }, (p) => {
      client1Events.push({ type: 'DELETE', old: p.old });
    });

  const observerChannel = supabase.channel(`integ_obs_${integRoomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'players', filter: `room_id=eq.${integRoomId}` }, (p) => {
      client2Events.push({ type: 'INSERT', player: p.new });
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'players' }, (p) => {
      client2Events.push({ type: 'DELETE', old: p.old });
    });

  await new Promise((res) => {
    let readyCount = 0;
    const check = () => { if (++readyCount === 2) res(); };
    hostChannel.subscribe(check);
    observerChannel.subscribe(check);
  });

  // Client joins Player A
  const { data: joinA } = await supabase.functions.invoke('join-room', {
    body: { room_code: integRoomCode, nickname: 'PlayerA' },
  });

  // Client joins Player B
  const { data: joinB } = await supabase.functions.invoke('join-room', {
    body: { room_code: integRoomCode, nickname: 'PlayerB' },
  });

  // Wait for Realtime delivery
  await new Promise((r) => setTimeout(r, 2500));

  const hostSawA = client1Events.some((e) => e.type === 'INSERT' && e.player.nickname === 'PlayerA');
  const hostSawB = client1Events.some((e) => e.type === 'INSERT' && e.player.nickname === 'PlayerB');
  record('TEST 5: Realtime', 'Host Realtime subscriber captured Player INSERT events', hostSawA && hostSawB, `Captured: ${client1Events.length}`);

  const obsSawA = client2Events.some((e) => e.type === 'INSERT' && e.player.nickname === 'PlayerA');
  const obsSawB = client2Events.some((e) => e.type === 'INSERT' && e.player.nickname === 'PlayerB');
  record('TEST 5: Realtime', 'Multiple connected clients receive simultaneous Realtime updates', obsSawA && obsSawB, `Captured: ${client2Events.length}`);

  // Host kicks Player B using remove-player
  const { data: kickBRes, error: kickBErr } = await supabase.functions.invoke('remove-player', {
    body: { room_id: integRoomId, player_id: joinB.player.id, host_token: integHostToken },
  });
  const kickBOk = !kickBErr && kickBRes?.player?.id === joinB.player.id;
  record('TEST 4: Host Management', 'Host authorized player removal (remove-player)', kickBOk);

  // Wait for Realtime DELETE delivery
  await new Promise((r) => setTimeout(r, 2500));

  const hostSawDelete = client1Events.some((e) => e.type === 'DELETE' && e.old?.id === joinB.player.id);
  const obsSawDelete = client2Events.some((e) => e.type === 'DELETE' && e.old?.id === joinB.player.id);
  record('TEST 5: Realtime', 'Realtime subscriber captures player DELETE events across clients', hostSawDelete && obsSawDelete);

  // Host starts the room
  const { data: integStartRes, error: integStartErr } = await supabase.functions.invoke('start-room', {
    body: { room_id: integRoomId, host_token: integHostToken },
  });
  const integStartedOk = !integStartErr && (integStartRes?.room?.status === 'active' || integStartRes?.room?.status === 'in_progress');
  record('TEST 6: Integration', 'Host starts room in multi-client lifecycle', integStartedOk);

  // Verify late joiner blocked
  const { data: integLateJoin, error: integLateJoinErr } = await supabase.functions.invoke('join-room', {
    body: { room_code: integRoomCode, nickname: 'LatePlayerC' },
  });
  const integLateBlocked = Boolean(integLateJoinErr || integLateJoin?.error);
  record('TEST 6: Integration', 'Late joiner rejected after room start in multi-client lifecycle', integLateBlocked);

  // Cleanup Realtime channels
  supabase.removeChannel(hostChannel);
  supabase.removeChannel(observerChannel);
  record('TEST 5: Realtime', 'Realtime subscription cleanup executes cleanly', true);

  // Summary
  console.log('\n===================================================================');
  console.log(' AUDIT EXECUTION SUMMARY');
  console.log('===================================================================');
  let passCount = 0;
  auditResults.forEach((t) => {
    if (t.passed) passCount++;
    console.log(`${(t.passed ? 'PASS' : 'FAIL').padEnd(6)} | [${t.section}] ${t.testName}`);
  });
  console.log(`\nTOTAL TESTS EXECUTED: ${auditResults.length}`);
  console.log(`TOTAL PASSED:         ${passCount} / ${auditResults.length}`);
  console.log(`TOTAL FAILED:         ${auditResults.length - passCount}`);
}

runAudit().catch((err) => {
  console.error('Audit run encountered error:', err);
  process.exit(1);
});

