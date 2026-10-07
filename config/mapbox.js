const env = require("./env");
const ApiError = require("../utils/ApiError");

const DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving-traffic";

if (!env.mapboxToken) {
  console.warn(
    "[mapbox] MAPBOX_ACCESS_TOKEN not set - trips use a straight-line route and traffic detection is off",
  );
}

const isConfigured = () => Boolean(env.mapboxToken);

// from / to are [lng, lat]. Returns null when Mapbox finds no drivable route.
async function getRoute(from, to) {
  const url =
    `${DIRECTIONS_URL}/${from[0]},${from[1]};${to[0]},${to[1]}` +
    `?geometries=geojson&overview=full&access_token=${env.mapboxToken}`;

  let body;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    body = await response.json();
    if (!response.ok && body.code !== "NoRoute") {
      throw new Error(body.message || `HTTP ${response.status}`);
    }
  } catch (err) {
    throw new ApiError(502, `Could not get a route from Mapbox: ${err.message}`);
  }

  const route = body.routes && body.routes[0];
  if (!route) return null;

  return {
    geometry: route.geometry,
    distanceMeters: route.distance,
    // duration reflects live traffic, duration_typical the usual time
    durationSeconds: route.duration,
    typicalDurationSeconds: route.duration_typical,
  };
}

module.exports = { isConfigured, getRoute };
