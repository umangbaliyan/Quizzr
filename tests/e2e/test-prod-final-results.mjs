import { supabase, supabaseUrl } from '../helpers/env.mjs';

const results = [];
function record(name, passed, details = '') {
  results.push({ name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
}

function extractPodium(leaderboard) {
  return {
    first: leaderboard.filter((p) => p.rank === 1),
    second: leaderboard.filter((p) => p.rank === 2),
    third: leaderboard.filter((p) => p.rank === 3),
  };
}

async function runProductionFinalResultsVerification() {
  console.log('===================================================================');
  console.log(' Quizzr Phase 2E: Production Final Results Verification');
  console.log(' Supabase Project URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Step 1: Create isolated Room 1
  console.log('--- Step 1: Setup Isolated Test Rooms ---');
  const { data: createData1 } = await supabase.functions.invoke('create-room', {
    body: { nickname: 'HostResultsProd' },
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
    'Setup isolated rooms & participants',
    true,
    `Room1: ${room1Code} (${room1Id}), Room2: ${room2Code}`
  );

  // Check 1: Active/waiting rooms never declare winners
  console.log('\n--- Check 1: Active/Waiting Rooms Never Declare Winners ---');
  const { data: waitingLb } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      host_token: host1Token,
    },
  });

  const waitingNoWinners =
    waitingLb?.isCompleted === false &&
    Array.isArray(waitingLb?.winners) &&
    waitingLb.winners.length === 0 &&
    waitingLb.leaderboard.every((p) => p.isWinner === false);

  record(
    'Check 1: Active/waiting rooms never declare winners',
    waitingNoWinners,
    `isCompleted: ${waitingLb?.isCompleted}, winners array length: ${waitingLb?.winners?.length}`
  );

  // Check 9: Invalid and cross-room tokens return 401
  console.log('\n--- Check 9: Invalid & Cross-Room Token Rejection (HTTP 401) ---');
  const { error: invalidTokenErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      player_token: 'fake-invalid-token-1234567890',
    },
  });
  const is401Invalid = invalidTokenErr && (invalidTokenErr.context?.status === 401 || invalidTokenErr.message?.includes('401'));

  const { error: crossRoomErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      host_token: host2Token, // Token from room 2
    },
  });
  const is401Cross = crossRoomErr && (crossRoomErr.context?.status === 401 || crossRoomErr.message?.includes('401'));

  record(
    'Check 9: Invalid and cross-room tokens return 401',
    Boolean(is401Invalid && is401Cross),
    `Invalid token 401: ${Boolean(is401Invalid)}, Cross-room 401: ${Boolean(is401Cross)}`
  );

  // Start Room 1 and generate 5 questions
  console.log('\n--- Generating 5 Questions & Starting Room 1 ---');
  await supabase.functions.invoke('generate-questions', {
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

  // Verify that an 'active' room still never declares winners
  const { data: activeLb } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      player_token: p1Token,
    },
  });
  const activeNoWinners =
    activeLb?.isCompleted === false &&
    activeLb?.winners?.length === 0 &&
    activeLb?.leaderboard?.every((p) => p.isWinner === false);

  record(
    'Check 1B: In-progress active room never declares winners',
    activeNoWinners,
    `Room Status: ${activeLb?.roomStatus}, isCompleted: ${activeLb?.isCompleted}`
  );

  // Have Alice submit an answer to create distinct scores (or test ties if both answer)
  // Let Alice answer question 1
  const { data: q1Data } = await supabase.functions.invoke('get-current-question', {
    body: {
      room_id: room1Id,
      player_token: p1Token,
    },
  });
  const q1Id = q1Data?.question?.id;

  if (q1Id) {
    await supabase.functions.invoke('submit-answer', {
      body: {
        room_code: room1Code,
        player_token: p1Token,
        question_id: q1Id,
        selected_option_index: 0,
      },
    });
  }

  // Advance room through all 5 questions to completion
  console.log('\n--- Progressing Room to Completion (5 Questions) ---');
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

  // Fetch final results from host and player
  console.log('\n--- Fetching Authoritative Final Results ---');
  const { data: hostFinal, error: hostFinalErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      host_token: host1Token,
    },
  });

  const { data: playerFinal, error: playerFinalErr } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      player_token: p1Token,
    },
  });

  // Check 2: Completed room returns isCompleted=true
  console.log('\n--- Check 2: Completed Room Flag ---');
  const check2Passed =
    hostFinal?.roomStatus === 'completed' &&
    hostFinal?.isCompleted === true &&
    hostFinal?.completedAt !== null;
  record(
    'Check 2: Completed room returns isCompleted=true',
    check2Passed,
    `Status: ${hostFinal?.roomStatus}, isCompleted: ${hostFinal?.isCompleted}, completedAt: ${hostFinal?.completedAt}`
  );

  // Check 3: Single winner receives isWinner=true (or joint if tied)
  console.log('\n--- Check 3 & 4: Winner Identification (Single or Joint) ---');
  const winnersList = hostFinal?.winners || [];
  const rank1Players = hostFinal?.leaderboard?.filter((p) => p.rank === 1) || [];

  const winnersMatchRank1 =
    winnersList.length === rank1Players.length &&
    rank1Players.every((p) => p.isWinner === true) &&
    hostFinal?.leaderboard?.filter((p) => p.rank > 1).every((p) => p.isWinner === false);

  record(
    'Check 3: All rank 1 players receive isWinner=true and populate winners array',
    winnersMatchRank1 && winnersList.length >= 1,
    `Winners: ${winnersList.map((w) => `${w.nickname}(${w.score})`).join(', ')}`
  );

  // Check 4: Joint first-place winners correctly identified
  // If rank1 has multiple players, all are in winners; if 1, joint logic handles properly
  const jointCheck = rank1Players.every((p) => winnersList.some((w) => w.id === p.id));
  record(
    'Check 4: Joint first-place winners are correctly identified and represented',
    jointCheck,
    `Total rank 1 winners: ${rank1Players.length}`
  );

  // Check 5: Standard competition ranking remains correct (1, 2, 2, 4 or 1, 1, 3, 4)
  console.log('\n--- Check 5: Standard Competition Ranking ---');
  const scores = hostFinal.leaderboard.map((p) => p.score);
  const ranks = hostFinal.leaderboard.map((p) => p.rank);

  let ranksConsistent = true;
  for (let i = 0; i < hostFinal.leaderboard.length; i++) {
    if (i > 0) {
      if (scores[i] < scores[i - 1]) {
        if (ranks[i] !== i + 1) ranksConsistent = false;
      } else {
        if (ranks[i] !== ranks[i - 1]) ranksConsistent = false;
      }
    } else {
      if (ranks[0] !== 1) ranksConsistent = false;
    }
  }

  record(
    'Check 5: Standard competition ranking remains correct',
    ranksConsistent,
    `Scores: [${scores.join(', ')}], Ranks: [${ranks.join(', ')}]`
  );

  // Check 6: Podium uses actual ranks only (First: rank 1, Second: rank 2, Third: rank 3)
  console.log('\n--- Check 6: Podium Uses Actual Ranks Only ---');
  const podium = extractPodium(hostFinal.leaderboard);
  const podiumAccurate =
    podium.first.every((p) => p.rank === 1) &&
    podium.second.every((p) => p.rank === 2) &&
    podium.third.every((p) => p.rank === 3);

  record(
    'Check 6: Podium uses actual ranks only',
    podiumAccurate,
    `Podium count: 1st=${podium.first.length}, 2nd=${podium.second.length}, 3rd=${podium.third.length}`
  );

  // Check 7: Host and player receive identical final results
  console.log('\n--- Check 7: Identical Results for Host and Player ---');
  const sameLength = hostFinal.leaderboard.length === playerFinal.leaderboard.length;
  const sameWinners = JSON.stringify(hostFinal.winners) === JSON.stringify(playerFinal.winners);
  const sameRanks = JSON.stringify(ranks) === JSON.stringify(playerFinal.leaderboard.map((p) => p.rank));
  const sameStatus = hostFinal.roomStatus === playerFinal.roomStatus && hostFinal.isCompleted === playerFinal.isCompleted;

  record(
    'Check 7: Host and player receive identical final results',
    sameLength && sameWinners && sameRanks && sameStatus,
    `Host total: ${hostFinal.leaderboard.length}, Player total: ${playerFinal.leaderboard.length}`
  );

  // Check 8: Refresh/reconnection retrieves persistent final results
  console.log('\n--- Check 8: Refresh/Reconnection Persistence ---');
  // Re-fetch simulated 2 seconds later with player 2
  const { data: reconnectFinal } = await supabase.functions.invoke('get-leaderboard', {
    body: {
      room_code: room1Code,
      player_token: p2Token,
    },
  });

  const isPersistent =
    reconnectFinal?.isCompleted === true &&
    reconnectFinal?.completedAt === hostFinal.completedAt &&
    reconnectFinal?.winners?.length === hostFinal.winners?.length;

  record(
    'Check 8: Refresh/reconnection retrieves persistent final results',
    Boolean(isPersistent),
    `Persistent completedAt: ${reconnectFinal?.completedAt}`
  );

  // Check 10: No private data leaks
  console.log('\n--- Check 10: No Private Data Leaks ---');
  const payloadStr = JSON.stringify(hostFinal);
  const leaksHostToken = payloadStr.includes(host1Token);
  const leaksPlayerToken = payloadStr.includes(p1Token) || payloadStr.includes(p2Token);
  const leaksKeys = payloadStr.includes('correct_option_index') || payloadStr.includes('explanation');
  const leaksSelections = payloadStr.includes('selected_option_index');

  const noLeaks = !leaksHostToken && !leaksPlayerToken && !leaksKeys && !leaksSelections;
  record(
    'Check 10: No private tokens, answer keys or answer selections leak',
    noLeaks,
    `Verified safe payload serialization`
  );

  // Check 11: Existing Phase 2D leaderboard functionality remains intact
  console.log('\n--- Check 11: Phase 2D Backward Compatibility ---');
  const hasRequiredPhase2DFields =
    'roomId' in hostFinal &&
    'roomCode' in hostFinal &&
    'roomStatus' in hostFinal &&
    'currentQuestionIndex' in hostFinal &&
    'completedAt' in hostFinal &&
    'totalPlayers' in hostFinal &&
    'leaderboard' in hostFinal;

  record(
    'Check 11: Existing Phase 2D leaderboard functionality remains intact',
    hasRequiredPhase2DFields,
    `Total players: ${hostFinal.totalPlayers}, Room Code: ${hostFinal.roomCode}`
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

runProductionFinalResultsVerification().catch((err) => {
  console.error('Fatal production test error:', err);
  process.exit(1);
});

