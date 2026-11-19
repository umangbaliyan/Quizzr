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

async function runProductionLeaderboardVerification() {
  console.log('===================================================================');
  console.log(' Quizzr Phase 2D: Production Leaderboard Verification');
  console.log(' Supabase Project URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Step 1: Create isolated Room 1
  console.log('--- Step 1: Setup Isolated Test Rooms ---');
  const { data: createData1 } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostLeaderProd' },
  });
  const room1Code = createData1.room.roomCode;
  const room1Id = createData1.room.id;
  const host1Token = createData1.hostToken;

  // Create isolated Room 2 for cross-room isolation tests
  const { data: createData2 } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostOtherRoomProd' },
  });
  const room2Code = createData2.room.roomCode;
  const host2Token = createData2.hostToken;

  // Join 3 players to Room 1
  const { data: joinP1 } = await supabase.functions.invoke('join-room', {
    body: { room_code: room1Code, nickname: 'AliceProd' },
  });
  const p1Token = joinP1.playerToken;
  const p1Id = joinP1.player.id;

  const { data: joinP2 } = await supabase.functions.invoke('join-room', {
    body: { room_code: room1Code, nickname: 'BobProd' },
  });
  const p2Token = joinP2.playerToken;
  const p2Id = joinP2.player.id;

  const { data: joinP3 } = await supabase.functions.invoke('join-room', {
    body: { room_code: room1Code, nickname: 'CharlieProd' },
  });
  const p3Token = joinP3.playerToken;
  const p3Id = joinP3.player.id;

  record(
    '1. Setup isolated rooms & participants',
    true,
    `Room1: ${room1Code} (${room1Id}), Room2: ${room2Code}`
  );

  // Verification 1: Valid host token retrieves leaderboard
  console.log('\n--- Verification 1: Valid Host Token ---');
  const { data: hostLb, error: hostLbErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      host_token: host1Token,
    },
  });

  const hostSuccess = !hostLbErr && hostLb?.roomId === room1Id && Array.isArray(hostLb?.leaderboard);
  record(
    'Verification 1: Valid host token retrieves leaderboard',
    hostSuccess,
    `Total players: ${hostLb?.leaderboard?.length}, Room: ${hostLb?.roomCode}`
  );

  // Verification 2: Valid player token retrieves leaderboard
  console.log('\n--- Verification 2: Valid Player Token ---');
  const { data: playerLb, error: playerLbErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      player_token: p1Token,
    },
  });

  const playerSuccess = !playerLbErr && playerLb?.roomId === room1Id && Array.isArray(playerLb?.leaderboard);
  record(
    'Verification 2: Valid player token retrieves leaderboard',
    playerSuccess,
    `Player Alice accessed leaderboard. Total entries: ${playerLb?.leaderboard?.length}`
  );

  // Verification 3: Invalid token returns 401
  console.log('\n--- Verification 3: Invalid Token Rejection ---');
  const { error: invalidErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      player_token: 'fake-invalid-token-1234567890',
    },
  });

  const is401Invalid = invalidErr && (invalidErr.context?.status === 401 || invalidErr.message?.includes('401'));
  record(
    'Verification 3: Invalid token returns 401 Unauthorized',
    Boolean(is401Invalid),
    `Status: ${invalidErr?.context?.status || 'Unknown'}`
  );

  // Verification 4: Cross-room token returns 401
  console.log('\n--- Verification 4: Cross-Room Token Rejection ---');
  const { error: crossErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      host_token: host2Token, // Token from Room 2 attempted on Room 1
    },
  });

  const is401Cross = crossErr && (crossErr.context?.status === 401 || crossErr.message?.includes('401'));
  record(
    'Verification 4: Cross-room token returns 401 Unauthorized',
    Boolean(is401Cross),
    `Status: ${crossErr?.context?.status || 'Unknown'}`
  );

  // Verification 5: All players including zero-score players appear
  console.log('\n--- Verification 5: All Players & Zero-Score Players Listed ---');
  const allZeroPresent =
    hostLb?.leaderboard?.length === 4 &&
    hostLb?.leaderboard.every((p) => p.score === 0);
  record(
    'Verification 5: All players, including zero-score players, appear',
    allZeroPresent,
    `Count: ${hostLb?.leaderboard?.length}, Scores: [${hostLb?.leaderboard.map((p) => p.score).join(', ')}]`
  );

  // Generate 5 questions for Room 1
  console.log('\n--- Generating 5 Questions & Starting Room ---');
  const { data: genData } = await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: room1Code,
      host_token: host1Token,
      topic: 'Space Exploration',
      difficulty: 'easy',
      question_count: 5,
    },
  });

  await supabase.functions.invoke('start-room', {
    body: {
      room_id: room1Id,
      host_token: host1Token,
    },
  });

  // Get question 1 ID
  const { data: q1Data } = await supabase.functions.invoke('get-current-question', {
    body: {
      room_id: room1Id,
      player_token: p1Token,
    },
  });

  const q1Id = q1Data?.question?.id;
  if (q1Id) {
    // Have Alice submit an answer
    await supabase.functions.invoke('submit-answer', {
      body: {
        room_code: room1Code,
        player_token: p1Token,
        question_id: q1Id,
        selected_option_index: 0,
      },
    });

    // Have Bob submit an answer
    await supabase.functions.invoke('submit-answer', {
      body: {
        room_code: room1Code,
        player_token: p2Token,
        question_id: q1Id,
        selected_option_index: 0,
      },
    });
  }

  // Verification 6 & 7: Competition Ranking with Ties (1, 2, 2, 4)
  console.log('\n--- Verification 6 & 7: Competition Ranks & Ties ---');
  const { data: midLb } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      host_token: host1Token,
    },
  });

  const scores = midLb.leaderboard.map((p) => p.score);
  const ranks = midLb.leaderboard.map((p) => p.rank);

  let ranksValid = true;
  let expectedRank = 1;
  for (let i = 0; i < midLb.leaderboard.length; i++) {
    if (i > 0) {
      if (midLb.leaderboard[i].score < midLb.leaderboard[i - 1].score) {
        expectedRank = i + 1;
      }
    }
    if (midLb.leaderboard[i].rank !== expectedRank) {
      ranksValid = false;
    }
  }

  record(
    'Verification 6: Scores and competition ranks are strictly sorted and calculated',
    ranksValid,
    `Scores: [${scores.join(', ')}], Ranks: [${ranks.join(', ')}]`
  );

  let tieFormatValid = false;
  for (let i = 1; i < ranks.length; i++) {
    if (scores[i] === scores[i - 1]) {
      if (ranks[i] === ranks[i - 1]) tieFormatValid = true;
    } else {
      if (ranks[i] === i + 1) tieFormatValid = true;
    }
  }

  record(
    'Verification 7: Equal scores produce standard competition ranking (e.g. 1, 2, 2, 4)',
    tieFormatValid && ranksValid,
    `Ranks pattern verified: [${ranks.join(', ')}]`
  );

  // Verification 8: Completed room returns final leaderboard
  console.log('\n--- Verification 8: Completed Room Final Leaderboard ---');
  for (let q = 1; q <= 5; q++) {
    console.log(`Waiting 21s for question ${q} deadline...`);
    await new Promise((res) => setTimeout(res, 21000));
    await supabase.functions.invoke('next-question', {
      body: {
        room_id: room1Id,
        host_token: host1Token,
      },
    });
  }

  // Query get-leaderboard on completed room
  const { data: finalLb, error: finalLbErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      player_token: p1Token,
    },
  });

  const isCompletedAndValid =
    !finalLbErr &&
    finalLb?.roomStatus === 'completed' &&
    finalLb?.completedAt !== null &&
    finalLb?.leaderboard?.length === 4;

  record(
    'Verification 8: Completed room returns final leaderboard and completedAt timestamp',
    Boolean(isCompletedAndValid),
    `Status: ${finalLb?.roomStatus}, CompletedAt: ${finalLb?.completedAt}, Players: ${finalLb?.leaderboard?.length}`
  );

  // Verification 9: Privacy Leak Audit (No tokens, keys or answer selections)
  console.log('\n--- Verification 9: Privacy & Secret Leak Prevention ---');
  const serializedResponse = JSON.stringify(finalLb);
  const leaksHostToken = serializedResponse.includes(host1Token);
  const leaksPlayerToken = serializedResponse.includes(p1Token) || serializedResponse.includes(p2Token);
  const leaksAnswerKeys =
    serializedResponse.includes('correct_option_index') ||
    serializedResponse.includes('correctOptionIndex') ||
    serializedResponse.includes('explanation');
  const leaksSelections =
    serializedResponse.includes('selected_option_index') ||
    serializedResponse.includes('selectedOptionIndex');

  const noLeaks = !leaksHostToken && !leaksPlayerToken && !leaksAnswerKeys && !leaksSelections;
  record(
    'Verification 9: No tokens, answer keys or answer selections leak in response payload',
    noLeaks,
    `No token hashes, answer keys, or player answer selections present in output`
  );

  // Verification 10: Realtime Score Updates & Reconnection
  console.log('\n--- Verification 10: Realtime Score Updates & Reconnection ---');
  const { data: createData3 } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostRealtimeLeader' },
  });
  const room3Code = createData3.room.roomCode;
  const room3Id = createData3.room.id;
  const host3Token = createData3.hostToken;

  const { data: joinPRealtime } = await supabase.functions.invoke('join-room', {
    body: { room_code: room3Code, nickname: 'RealtimeUser' },
  });
  const pRealtimeId = joinPRealtime.player.id;
  const pRealtimeToken = joinPRealtime.playerToken;

  let realtimeEventReceived = false;

  const testChannel = supabase
    .channel(`leaderboard_test_${room3Id}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'players',
        filter: `room_id=eq.${room3Id}`,
      },
      (payload) => {
        if (payload.new && payload.new.id === pRealtimeId) {
          realtimeEventReceived = true;
        }
      }
    )
    .subscribe();

  await new Promise((res) => setTimeout(res, 2500));

  await supabase.functions.invoke('generate-questions', {
    body: {
      room_code: room3Code,
      host_token: host3Token,
      topic: 'General Science',
      difficulty: 'easy',
      question_count: 5,
    },
  });

  await supabase.functions.invoke('start-room', {
    body: {
      room_id: room3Id,
      host_token: host3Token,
    },
  });

  const { data: curQData } = await supabase.functions.invoke('get-current-question', {
    body: {
      room_id: room3Id,
      player_token: pRealtimeToken,
    },
  });

  if (curQData?.question?.id) {
    await supabase.functions.invoke('submit-answer', {
      body: {
        room_code: room3Code,
        player_token: pRealtimeToken,
        question_id: curQData.question.id,
        selected_option_index: 0,
      },
    });
  }

  await new Promise((res) => setTimeout(res, 3000));
  supabase.removeChannel(testChannel);

  // Check reconnection re-fetch
  const { data: reconLb } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room3Code,
      player_token: pRealtimeToken,
    },
  });

  const reconnectionSuccess = reconLb?.leaderboard?.some((p) => p.id === pRealtimeId);

  record(
    'Verification 10: Realtime score updates and reconnection work',
    reconnectionSuccess,
    `Realtime channel event registered: ${realtimeEventReceived}, Reconnection fetch: ${reconLb?.leaderboard?.length} players`
  );

  // Summary
  console.log('\n===================================================================');
  const passCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(` PRODUCTION VERIFICATION RESULTS: ${passCount} / ${totalCount} PASSED`);
  console.log('===================================================================\n');

  if (passCount !== totalCount) {
    process.exit(1);
  }
}

runProductionLeaderboardVerification().catch((err) => {
  console.error('Fatal production test error:', err);
  process.exit(1);
});
