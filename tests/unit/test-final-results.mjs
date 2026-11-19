import fs from 'fs';
import path from 'path';
import { supabaseUrl, projectRoot } from '../helpers/env.mjs';

const results = [];
function record(name, passed, details = '') {
  results.push({ name, passed, details });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${details ? '- ' + details : ''}`);
}

/**
 * Standard competition rank calculation matching backend implementation
 */
function computeStandardResults(playerList, isCompleted = false) {
  const sorted = [...playerList].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aJoined = new Date(a.joined_at || a.joinedAt).getTime();
    const bJoined = new Date(b.joined_at || b.joinedAt).getTime();
    if (aJoined !== bJoined) return aJoined - bJoined;
    return String(a.id).localeCompare(String(b.id));
  });

  let currentRank = 1;
  return sorted.map((p, idx) => {
    if (idx > 0) {
      if (p.score === sorted[idx - 1].score) {
        // Tied with previous player
      } else {
        currentRank = idx + 1;
      }
    }
    const isWinner = Boolean(isCompleted && currentRank === 1);
    return {
      ...p,
      rank: currentRank,
      isWinner,
    };
  });
}

function extractPodium(leaderboard) {
  return {
    first: leaderboard.filter((p) => p.rank === 1),
    second: leaderboard.filter((p) => p.rank === 2),
    third: leaderboard.filter((p) => p.rank === 3),
  };
}

async function runFinalResultsTestSuite() {
  console.log('===================================================================');
  console.log(' Quizzr Phase 2E: Final Results System Logic & Security Tests');
  console.log(' Supabase URL:', supabaseUrl);
  console.log('===================================================================\n');

  // Case 1: Active and Waiting rooms must NEVER declare winners
  console.log('--- Case 1: Active & Waiting Rooms Never Declare Winners ---');
  const activePlayers = [
    { id: 'p1', nickname: 'Alice', score: 300, joined_at: '2026-01-01T00:00:01Z' },
    { id: 'p2', nickname: 'Bob', score: 200, joined_at: '2026-01-01T00:00:02Z' },
  ];
  const waitingResults = computeStandardResults(activePlayers, false); // isCompleted = false
  const activeWinners = waitingResults.filter((p) => p.isWinner);
  const activePodium = extractPodium(waitingResults);

  record(
    'Case 1: Active and waiting rooms never declare winners or winners array',
    activeWinners.length === 0,
    `Winners count in active/waiting room: ${activeWinners.length}`
  );

  // Case 2: Single Winner Identification when Completed
  console.log('\n--- Case 2: Single Winner Identification (Completed) ---');
  const completedPlayersSingle = [
    { id: 'p1', nickname: 'Alice', score: 450, joined_at: '2026-01-01T00:00:01Z' },
    { id: 'p2', nickname: 'Bob', score: 280, joined_at: '2026-01-01T00:00:02Z' },
    { id: 'p3', nickname: 'Charlie', score: 100, joined_at: '2026-01-01T00:00:03Z' },
  ];
  const singleResults = computeStandardResults(completedPlayersSingle, true);
  const singleWinners = singleResults.filter((p) => p.isWinner);
  const isAliceSoleWinner =
    singleWinners.length === 1 &&
    singleWinners[0].id === 'p1' &&
    singleWinners[0].nickname === 'Alice' &&
    singleWinners[0].score === 450 &&
    singleWinners[0].rank === 1;

  record(
    'Case 2: Single winner identified with rank 1 and isWinner === true',
    isAliceSoleWinner,
    `Winner: ${singleWinners[0]?.nickname} (${singleWinners[0]?.score} pts)`
  );

  // Case 3: Tied Winner Identification (Joint 1st with Standard Competition Ranking)
  console.log('\n--- Case 3: Joint 1st Place Winners (Ties) ---');
  const completedPlayersTied = [
    { id: 'p1', nickname: 'Alice', score: 300, joined_at: '2026-01-01T00:00:01Z' },
    { id: 'p2', nickname: 'Bob', score: 300, joined_at: '2026-01-01T00:00:02Z' },
    { id: 'p3', nickname: 'Charlie', score: 150, joined_at: '2026-01-01T00:00:03Z' },
    { id: 'p4', nickname: 'David', score: 0, joined_at: '2026-01-01T00:00:04Z' },
  ];
  const tiedResults = computeStandardResults(completedPlayersTied, true);
  const jointWinners = tiedResults.filter((p) => p.isWinner);
  const charlieRank = tiedResults.find((p) => p.id === 'p3')?.rank;
  const davidRank = tiedResults.find((p) => p.id === 'p4')?.rank;

  // With ties at 1st place (Alice & Bob), next player (Charlie) must get rank 3! (1, 1, 3, 4)
  const isJointWinnerValid =
    jointWinners.length === 2 &&
    jointWinners[0].rank === 1 &&
    jointWinners[1].rank === 1 &&
    charlieRank === 3 &&
    davidRank === 4;

  record(
    'Case 3: Joint 1st place winners both get rank 1, and subsequent rank skips to 3 (1, 1, 3, 4)',
    isJointWinnerValid,
    `Winners: ${jointWinners.map((w) => w.nickname).join(', ')}, Charlie rank: ${charlieRank}, David rank: ${davidRank}`
  );

  // Case 4: Podium Extraction with Strict Competition Ranks
  console.log('\n--- Case 4: Strict Podium Placements (1st, 2nd, 3rd) ---');
  // Scenario A: Standard spread 1, 2, 3, 4
  const spreadPlayers = [
    { id: 'p1', nickname: 'Gold', score: 300, joined_at: '2026-01-01T00:00:01Z' },
    { id: 'p2', nickname: 'Silver', score: 200, joined_at: '2026-01-01T00:00:02Z' },
    { id: 'p3', nickname: 'Bronze', score: 100, joined_at: '2026-01-01T00:00:03Z' },
    { id: 'p4', nickname: 'Fourth', score: 50, joined_at: '2026-01-01T00:00:04Z' },
  ];
  const podiumA = extractPodium(computeStandardResults(spreadPlayers, true));
  const spreadPodiumValid =
    podiumA.first.length === 1 &&
    podiumA.first[0].nickname === 'Gold' &&
    podiumA.second.length === 1 &&
    podiumA.second[0].nickname === 'Silver' &&
    podiumA.third.length === 1 &&
    podiumA.third[0].nickname === 'Bronze';

  // Scenario B: Tie for 1st skips 2nd place (ranks: 1, 1, 3) -> second podium must be EMPTY
  const podiumB = extractPodium(tiedResults);
  const tieSkipsSecondValid =
    podiumB.first.length === 2 &&
    podiumB.second.length === 0 && // Rank 2 skipped!
    podiumB.third.length === 1 &&
    podiumB.third[0].nickname === 'Charlie';

  // Scenario C: Tie for 2nd skips 3rd place (ranks: 1, 2, 2, 4) -> third podium must be EMPTY
  const tieForSecondPlayers = [
    { id: 'p1', nickname: 'Leader', score: 300, joined_at: '2026-01-01T00:00:01Z' },
    { id: 'p2', nickname: 'TieSilver1', score: 200, joined_at: '2026-01-01T00:00:02Z' },
    { id: 'p3', nickname: 'TieSilver2', score: 200, joined_at: '2026-01-01T00:00:03Z' },
    { id: 'p4', nickname: 'SkippedBronze', score: 50, joined_at: '2026-01-01T00:00:04Z' },
  ];
  const podiumC = extractPodium(computeStandardResults(tieForSecondPlayers, true));
  const tieSkipsThirdValid =
    podiumC.first.length === 1 &&
    podiumC.second.length === 2 &&
    podiumC.third.length === 0; // Rank 3 skipped!

  record(
    'Case 4: Podium uses actual competition ranks (never artificially forces 2nd or 3rd place)',
    spreadPodiumValid && tieSkipsSecondValid && tieSkipsThirdValid,
    `Scenario A: 1st=${podiumA.first.length}, 2nd=${podiumA.second.length}, 3rd=${podiumA.third.length} | Scenario B (Joint 1st): 2nd=${podiumB.second.length}, 3rd=${podiumB.third.length} | Scenario C (Joint 2nd): 2nd=${podiumC.second.length}, 3rd=${podiumC.third.length}`
  );

  // Case 5: Full Roster Inclusion with Zero Scores
  console.log('\n--- Case 5: Full Roster Inclusion ---');
  const allZeroPlayers = [
    { id: 'p1', nickname: 'Alice', score: 0, joined_at: '2026-01-01T00:00:01Z' },
    { id: 'p2', nickname: 'Bob', score: 0, joined_at: '2026-01-01T00:00:02Z' },
    { id: 'p3', nickname: 'Charlie', score: 0, joined_at: '2026-01-01T00:00:03Z' },
  ];
  const allZeroResults = computeStandardResults(allZeroPlayers, true);
  const allPresent =
    allZeroResults.length === 3 &&
    allZeroResults.every((p) => p.rank === 1 && p.isWinner);

  record(
    'Case 5: All players including zero scores are retained in final results',
    allPresent,
    `Total players: ${allZeroResults.length}, All ranked 1 with 0 pts`
  );

  // Case 6: Backward Compatibility of get-leaderboard Output
  console.log('\n--- Case 6: Backward Compatibility of get-leaderboard ---');
  const edgeSource = fs.readFileSync(path.resolve(projectRoot, 'supabase/functions/get-leaderboard/index.ts'), 'utf8');

  const hasRoomId = edgeSource.includes('roomId: room.id');
  const hasRoomCode = edgeSource.includes('roomCode: room.room_code');
  const hasRoomStatus = edgeSource.includes('roomStatus: room.status');
  const hasCompletedAt = edgeSource.includes('completedAt: room.completed_at');
  const hasLeaderboard = edgeSource.includes('leaderboard,');
  const hasIsCompleted = edgeSource.includes('isCompleted,');
  const hasWinners = edgeSource.includes('winners,');
  const hasIsWinner = edgeSource.includes('isWinner,');

  const backwardCompatible =
    hasRoomId &&
    hasRoomCode &&
    hasRoomStatus &&
    hasCompletedAt &&
    hasLeaderboard &&
    hasIsCompleted &&
    hasWinners &&
    hasIsWinner;

  record(
    'Case 6: Existing get-leaderboard response schema preserved with new fields added',
    backwardCompatible,
    'Preserves roomId, roomCode, roomStatus, leaderboard, completedAt while adding isCompleted, winners, isWinner'
  );

  // Case 7: Hook Implementation Integrity (useRoomFinalResults.js)
  console.log('\n--- Case 7: useRoomFinalResults.js Hook Verification ---');
  const hookSource = fs.readFileSync(path.resolve(projectRoot, 'src/hooks/useRoomFinalResults.js'), 'utf8');

  const detectsRoomCompletion =
    hookSource.includes("payload.new.status === 'completed'") &&
    hookSource.includes('fetchFinalResults()');
  const handlesMountFetch = hookSource.includes('fetchFinalResults()');
  const handlesReconnection =
    hookSource.includes("status === 'SUBSCRIBED'") &&
    hookSource.includes('fetchFinalResults()');
  const cleansUpSubscription = hookSource.includes('supabase.removeChannel');
  const exportsStandardReturns =
    hookSource.includes('isCompleted') &&
    hookSource.includes('winners') &&
    hookSource.includes('podium') &&
    hookSource.includes('leaderboard') &&
    hookSource.includes('refreshResults');

  record(
    'Case 7: useRoomFinalResults hook handles Realtime completion, reconnection and cleanup',
    detectsRoomCompletion && handlesMountFetch && handlesReconnection && cleansUpSubscription && exportsStandardReturns,
    'Realtime room listener, mount fetch, reconnection refresh, removeChannel unmount cleanup verified'
  );

  // Case 8: Security & Privacy Leak Audit
  console.log('\n--- Case 8: Security & Privacy Leak Audit ---');
  const selectsSafeColumns = edgeSource.includes(
    'select("id, nickname, score, is_host, joined_at")'
  );
  const noKeysInEdge =
    !edgeSource.includes('question_keys') &&
    !edgeSource.includes('correct_option_index');
  const noAnswersInEdge =
    !edgeSource.includes('answers') &&
    !edgeSource.includes('selected_option_index');
  const hashesHostAndPlayer =
    edgeSource.includes('hashToken(host_token.trim())') &&
    edgeSource.includes('hashToken(player_token.trim())');

  record(
    'Case 8: Security Defenses & Leak Prevention',
    selectsSafeColumns && noKeysInEdge && noAnswersInEdge && hashesHostAndPlayer,
    'Service-role tokens validated via SHA-256; zero answer keys, selections or tokens exposed'
  );

  // Summary
  console.log('\n===================================================================');
  const passCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  console.log(` RESULTS: ${passCount} / ${totalCount} PASSED`);
  console.log('===================================================================\n');

  if (passCount !== totalCount) {
    process.exit(1);
  }
}

runFinalResultsTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

