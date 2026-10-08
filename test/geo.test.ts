import assert from "node:assert";
import test from "node:test";
import { distanceToLine, haversineDistance } from "../src/utils/geo";

const near = (actual: number, expected: number, tolerance: number): void =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

test("haversineDistance: one degree of latitude is about 111.2 km", () => {
  near(haversineDistance([3.35, 6.0], [3.35, 7.0]), 111195, 100);
});

test("haversineDistance: same point is zero", () => {
  assert.strictEqual(haversineDistance([3.35, 6.5], [3.35, 6.5]), 0);
});

test("distanceToLine: point on the line is zero", () => {
  const line = [[3.0, 6.0], [3.0, 7.0]];
  near(distanceToLine([3.0, 6.5], line), 0, 0.5);
});

test("distanceToLine: perpendicular offset from a segment", () => {
  const line = [[3.0, 6.0], [3.0, 7.0]];
  // 0.01 degrees of longitude at latitude 6.5
  const expected = haversineDistance([3.0, 6.5], [3.01, 6.5]);
  near(distanceToLine([3.01, 6.5], line), expected, 1);
});

test("distanceToLine: beyond the end measures to the nearest endpoint", () => {
  const line = [[3.0, 6.0], [3.0, 7.0]];
  near(distanceToLine([3.0, 7.01], line), haversineDistance([3.0, 7.0], [3.0, 7.01]), 1);
});

test("distanceToLine: uses the closest of several segments", () => {
  const line = [[3.0, 6.0], [3.0, 6.5], [3.5, 6.5]];
  near(distanceToLine([3.25, 6.501], line), haversineDistance([3.25, 6.5], [3.25, 6.501]), 1);
});
