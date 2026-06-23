// verify_snake_geometry.js
// Test script for the pure snake-geometry math used by the mobile race
// chart's tap-to-expand panel. Mirrors the existing standalone-test
// pattern used by verify_race_scoring_matches.js: a local copy of the
// pure functions, runnable under plain Node (no DOM needed for this math).

const STROKE_WIDTH = 28;
const ROW_PITCH = 36;
const CORNER_RADIUS = 14;
const PIXELS_PER_POINT = 24;
const SEGMENT_PALETTE_SIZE = 10;
const MIN_SEGMENT_LABEL_FRACTION = 0.04;

function computeSnakeRowCount(totalPoints, availableWidth) {
  if (totalPoints <= 0) return 1;
  const rowSpan = Math.max(1, availableWidth - STROKE_WIDTH);
  const totalLength = totalPoints * PIXELS_PER_POINT;
  return Math.max(1, Math.ceil(totalLength / rowSpan));
}

function buildSnakePathD(numRows, availableWidth) {
  const xLeft = STROKE_WIDTH / 2;
  const xRight = Math.max(xLeft + 1, availableWidth - STROKE_WIDTH / 2);
  const rowY = (i) => STROKE_WIDTH / 2 + i * ROW_PITCH;
  const insetToward = (edgeX) => (edgeX === xRight ? edgeX - CORNER_RADIUS : edgeX + CORNER_RADIUS);

  let d = '';
  for (let i = 0; i < numRows; i++) {
    const y = rowY(i);
    const goingRight = i % 2 === 0;
    const isLastRow = i === numRows - 1;
    const fromX = goingRight ? xLeft : xRight;
    const toX = goingRight ? xRight : xLeft;
    const lineToX = isLastRow ? toX : insetToward(toX);

    if (i === 0) d += `M ${fromX},${y} `;
    d += `L ${lineToX},${y} `;

    if (!isLastRow) {
      const cornerX = toX;
      const nextY = rowY(i + 1);
      const dropToY = nextY - CORNER_RADIUS;
      d += `Q ${cornerX},${y} ${cornerX},${y + CORNER_RADIUS} `;
      if (dropToY > y + CORNER_RADIUS) {
        d += `L ${cornerX},${dropToY} `;
      }
      const nextLineStartX = insetToward(cornerX);
      d += `Q ${cornerX},${nextY} ${nextLineStartX},${nextY} `;
    }
  }
  return d.trim();
}

function buildSnakeSegmentData(scoringMatches, totalPoints) {
  let cumulative = 0;
  return scoringMatches.map(m => {
    const fraction = totalPoints > 0 ? m.points / totalPoints : 0;
    const offset = cumulative;
    cumulative += fraction;
    return {
      matchNumber: m.matchNumber,
      points: m.points,
      fraction,
      offset,
      colorIndex: parseInt(m.matchNumber, 10) % SEGMENT_PALETTE_SIZE,
      showLabel: fraction >= MIN_SEGMENT_LABEL_FRACTION
    };
  });
}

let failed = false;

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    failed = true;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

function assertClose(actual, expected, label, epsilon = 1e-9) {
  if (Math.abs(actual - expected) > epsilon) {
    console.error(`  FAIL: ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
    failed = true;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

console.log("=== RUNNING SNAKE GEOMETRY TESTS ===");

console.log("\nTest #1: computeSnakeRowCount");
{
  assertEqual(computeSnakeRowCount(0, 300), 1, 'zero points still yields 1 row');
  assertEqual(computeSnakeRowCount(10, 300), 1, '10 pts at 24px/pt = 240px fits in one 272px row');
  assertEqual(computeSnakeRowCount(50, 300), 5, '50 pts = 1200px needs ceil(1200/272) = 5 rows');
  assertEqual(computeSnakeRowCount(20, 100), 7, '20 pts = 480px in a narrow 72px row needs ceil(480/72) = 7 rows');
}

console.log("\nTest #2: buildSnakePathD — single row has no corners");
{
  const d = buildSnakePathD(1, 300);
  assertEqual(d, 'M 14,14 L 286,14', 'single row is a plain straight line from left edge to right edge');
}

console.log("\nTest #3: buildSnakePathD — two rows produces one rounded turn");
{
  const d = buildSnakePathD(2, 300);
  assertEqual(
    d,
    'M 14,14 L 272,14 Q 286,14 286,28 L 286,36 Q 286,50 272,50 L 14,50',
    'two rows: row 0 left-to-right stopping short of the corner (272,14), ' +
    'a quarter-turn down to (286,28), a straight vertical drop to (286,36) ' +
    'since dropToY(36) is greater than y+radius(28), a quarter-turn into ' +
    'row 1 landing at (272,50), then row 1 right-to-left to the full left edge (14,50)'
  );
}

console.log("\nTest #4: buildSnakeSegmentData — fractions and cumulative offsets");
{
  const scoringMatches = [
    { matchNumber: '3', points: 2 },
    { matchNumber: '7', points: 6 },
    { matchNumber: '12', points: 2 }
  ];
  const segments = buildSnakeSegmentData(scoringMatches, 10);

  assertClose(segments[0].fraction, 0.2, 'match 3: 2/10 = 0.2');
  assertClose(segments[0].offset, 0, 'match 3 starts at offset 0');
  assertEqual(segments[0].showLabel, true, 'match 3 (0.2) is above the 0.04 label threshold');

  assertClose(segments[1].fraction, 0.6, 'match 7: 6/10 = 0.6');
  assertClose(segments[1].offset, 0.2, 'match 7 starts right after match 3 ends (offset 0.2)');

  assertClose(segments[2].fraction, 0.2, 'match 12: 2/10 = 0.2');
  assertClose(segments[2].offset, 0.8, 'match 12 starts at offset 0.8 (0.2 + 0.6)');

  assertEqual(segments[1].colorIndex, 7 % 10, 'match 7 colorIndex is matchNumber % 10');
}

console.log("\nTest #5: buildSnakeSegmentData — thin segment below label threshold");
{
  const scoringMatches = [{ matchNumber: '1', points: 1 }];
  const segments = buildSnakeSegmentData(scoringMatches, 1000);
  assertEqual(segments[0].showLabel, false, '1/1000 = 0.001 is below the 0.04 threshold, label hidden');
}

if (failed) {
  console.error("\nSome tests FAILED!");
  process.exit(1);
} else {
  console.log("\nAll snake geometry tests PASSED successfully!");
}
