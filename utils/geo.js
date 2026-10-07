// All coordinates are GeoJSON style: [lng, lat]. Distances are in meters.
const EARTH_RADIUS_M = 6371008.8;
const toRad = (degrees) => (degrees * Math.PI) / 180;

function haversineDistance(a, b) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Projects the segment onto a flat plane centred on the point, which is
// accurate enough over the short distances a route segment covers.
function distanceToSegment(point, start, end) {
  const cosLat = Math.cos(toRad(point[1]));
  const project = (c) => [
    toRad(c[0] - point[0]) * cosLat * EARTH_RADIUS_M,
    toRad(c[1] - point[1]) * EARTH_RADIUS_M,
  ];
  const [ax, ay] = project(start);
  const [bx, by] = project(end);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

// Shortest distance from a point to a LineString's coordinates
function distanceToLine(point, line) {
  if (line.length === 1) return haversineDistance(point, line[0]);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const distance = distanceToSegment(point, line[i], line[i + 1]);
    if (distance < min) min = distance;
  }
  return min;
}

module.exports = { haversineDistance, distanceToSegment, distanceToLine };
