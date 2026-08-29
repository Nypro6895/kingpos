export const STAFF_TURN_TONE_LEVEL_COUNT = 5;

function normalizeTurnCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

// Relative mapping keeps the staff board focused on fairness: equal turn counts
// share a tone, while the current highest count gets the strongest tone.
export function getStaffTurnToneLevel(
  largeTurns: number,
  allLargeTurns: readonly number[],
) {
  const normalizedTurns = normalizeTurnCount(largeTurns);
  const distinctTurns = Array.from(
    new Set([...allLargeTurns, normalizedTurns].map(normalizeTurnCount)),
  ).sort((left, right) => left - right);

  if (distinctTurns.length <= 1) {
    return 0;
  }

  const turnIndex = distinctTurns.indexOf(normalizedTurns);

  return Math.round(
    (turnIndex / (distinctTurns.length - 1)) *
      (STAFF_TURN_TONE_LEVEL_COUNT - 1),
  );
}
