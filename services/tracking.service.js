const env = require("../config/env");
const store = require("../config/redis");
const mapbox = require("../config/mapbox");
const Trip = require("../models/Trip");
const LocationPing = require("../models/LocationPing");
const ApiError = require("../utils/ApiError");
const { haversineDistance, distanceToLine } = require("../utils/geo");
const { requireObjectId, parseLatLng, optionalNumber } = require("../utils/validate");
const realtime = require("./realtime.service");
const { createAlert } = require("./alert.service");

const cfg = env.tracking;
const STATE_TTL_SECONDS = 24 * 60 * 60;
const SWEEP_INTERVAL_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;

const stateKey = (tripId) => `trip:state:${tripId}`;
const loadState = async (tripId) => (await store.getJSON(stateKey(tripId))) || {};
const saveState = (tripId, state) => store.setJSON(stateKey(tripId), state, STATE_TTL_SECONDS);

const flagsOf = (state) => ({
  deviated: Boolean(state.deviated),
  stationary: Boolean(state.stationary),
  traffic: Boolean(state.traffic),
  signalLost: Boolean(state.signalLost),
});

// Work for one trip runs one at a time so concurrent pings cannot
// overwrite each other's state or raise the same alert twice.
const queues = new Map();
function enqueue(tripId, task) {
  const previous = queues.get(tripId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  queues.set(tripId, next);
  next
    .catch(() => {})
    .finally(() => {
      if (queues.get(tripId) === next) queues.delete(tripId);
    });
  return next;
}

// Planned route coordinates per active trip, so they are not re-read on every ping
const routeCache = new Map();
async function getRouteCoordinates(tripId) {
  if (routeCache.has(tripId)) return routeCache.get(tripId);
  const trip = await Trip.findById(tripId).select("route.geometry").lean();
  const coordinates =
    (trip && trip.route && trip.route.geometry && trip.route.geometry.coordinates) || null;
  routeCache.set(tripId, coordinates);
  return coordinates;
}

async function initTrip(tripId) {
  routeCache.delete(String(tripId));
  await saveState(String(tripId), { lastPingAt: Date.now() });
}

async function clearTrip(tripId) {
  routeCache.delete(String(tripId));
  await store.del(stateKey(String(tripId)));
}

function normalizeLocation(raw) {
  const [lng, lat] = parseLatLng(raw, "location");
  let recordedAt = new Date();
  if (raw.timestamp != null) {
    recordedAt = new Date(raw.timestamp);
    if (Number.isNaN(recordedAt.getTime())) {
      throw new ApiError(400, "timestamp must be a valid date");
    }
    // A device clock running ahead should not put pings in the future
    if (recordedAt.getTime() > Date.now() + MINUTE_MS) recordedAt = new Date();
  }
  return {
    lat,
    lng,
    speed: optionalNumber(raw.speed),
    heading: optionalNumber(raw.heading),
    accuracy: optionalNumber(raw.accuracy),
    recordedAt,
  };
}

// Entry point for both the socket event and the HTTP fallback
function recordLocation(tripId, driverId, raw) {
  const id = requireObjectId(tripId, "tripId");
  const location = normalizeLocation(raw || {});
  return enqueue(id, () => processLocation(id, driverId, location));
}

async function processLocation(tripId, driverId, loc) {
  const trip = await Trip.findById(tripId).select("-route.geometry");
  if (!trip) throw new ApiError(404, "Trip not found");
  if (!trip.driver.equals(driverId)) {
    throw new ApiError(403, "You are not the driver of this trip");
  }
  if (trip.status !== "in_progress") {
    throw new ApiError(409, `Trip is ${trip.status}; location is only accepted while it is in progress`);
  }

  const coordinates = [loc.lng, loc.lat];
  await LocationPing.create({
    trip: trip._id,
    driver: trip.driver,
    location: { type: "Point", coordinates },
    speed: loc.speed,
    heading: loc.heading,
    accuracy: loc.accuracy,
    recordedAt: loc.recordedAt,
  });

  const state = await loadState(tripId);
  state.lastPingAt = Date.now();
  state.signalLost = false;

  // A ping older than one already processed is kept for history only
  const recordedMs = loc.recordedAt.getTime();
  if (state.lastRecordedAt && recordedMs < state.lastRecordedAt) {
    await saveState(tripId, state);
    return { status: trip.status, flags: flagsOf(state), outOfOrder: true };
  }
  state.lastRecordedAt = recordedMs;

  const reliable = loc.accuracy === undefined || loc.accuracy <= cfg.maxAccuracyM;
  const distanceToDestination = haversineDistance(
    coordinates,
    trip.destination.location.coordinates,
  );

  if (reliable && distanceToDestination <= cfg.arrivalRadiusM) {
    return markArrived(trip, loc, coordinates);
  }

  const pending = [];
  let distanceFromRoute = null;

  if (reliable) {
    const route = await getRouteCoordinates(tripId);
    if (route) {
      distanceFromRoute = distanceToLine(coordinates, route);
      const alert = checkDeviation(state, distanceFromRoute);
      if (alert) pending.push(alert);
    }
    const alert = checkStationary(state, coordinates, recordedMs);
    if (alert) pending.push(alert);
  }

  const trafficCheckDue = isTrafficCheckDue(state);
  const lastLocation = buildLastLocation(loc, coordinates);
  const flags = flagsOf(state);
  await Promise.all([
    saveState(tripId, state),
    Trip.updateOne({ _id: trip._id, status: "in_progress" }, { $set: { lastLocation, flags } }),
  ]);

  realtime.emitToUsers([trip.manager], "trip:location", {
    ...locationPayload(trip, loc),
    flags,
    distanceFromRouteMeters: distanceFromRoute === null ? null : Math.round(distanceFromRoute),
    distanceToDestinationMeters: Math.round(distanceToDestination),
  });

  for (const alert of pending) {
    await createAlert(trip, { ...alert, coordinates });
  }

  if (trafficCheckDue) {
    checkTraffic(tripId, coordinates, trip.destination.location.coordinates);
  }

  return { status: trip.status, flags };
}

function checkDeviation(state, distanceFromRoute) {
  if (distanceFromRoute <= cfg.deviationThresholdM) {
    state.offRouteCount = 0;
    state.deviated = false;
    return null;
  }
  state.offRouteCount = (state.offRouteCount || 0) + 1;
  if (state.deviated || state.offRouteCount < cfg.deviationConfirmPings) return null;

  state.deviated = true;
  const meters = Math.round(distanceFromRoute);
  return {
    type: "deviation",
    severity: "critical",
    text: `has left the planned route (${meters} m off route)`,
    meta: { distanceFromRouteMeters: meters },
  };
}

function checkStationary(state, coordinates, recordedMs) {
  const anchor = state.anchor;
  if (!anchor || haversineDistance(anchor.coordinates, coordinates) > cfg.stationaryRadiusM) {
    state.anchor = { coordinates, at: recordedMs };
    state.stationary = false;
    return null;
  }
  const stoppedMs = recordedMs - anchor.at;
  if (state.stationary || stoppedMs < cfg.stationaryMinutes * MINUTE_MS) return null;

  state.stationary = true;
  const minutes = Math.floor(stoppedMs / MINUTE_MS);
  return {
    type: "stationary",
    severity: "warning",
    text: `has not moved for ${minutes} minutes`,
    meta: {
      stationarySince: new Date(anchor.at).toISOString(),
      inTraffic: Boolean(state.traffic),
    },
  };
}

async function markArrived(trip, loc, coordinates) {
  const arrived = await Trip.findOneAndUpdate(
    { _id: trip._id, status: "in_progress" },
    {
      $set: {
        status: "arrived",
        arrivedAt: loc.recordedAt,
        lastLocation: buildLastLocation(loc, coordinates),
        flags: flagsOf({}),
      },
    },
    { returnDocument: "after" },
  ).select("-route.geometry");
  // Cancelled or completed while this ping was being processed
  if (!arrived) return { status: trip.status, flags: flagsOf({}) };

  await clearTrip(trip.id);

  realtime.emitToUsers([trip.manager], "trip:location", {
    ...locationPayload(trip, loc),
    flags: flagsOf({}),
    distanceFromRouteMeters: null,
    distanceToDestinationMeters: 0,
  });
  realtime.emitToUsers([trip.manager, trip.driver], "trip:status", {
    tripId: trip.id,
    status: "arrived",
    at: arrived.arrivedAt,
  });
  await createAlert(trip, {
    type: "arrival",
    severity: "info",
    text: `has arrived at ${trip.destination.name || "the destination"}`,
    coordinates,
  });

  return { status: "arrived", flags: flagsOf({}) };
}

function buildLastLocation(loc, coordinates) {
  return {
    location: { type: "Point", coordinates },
    speed: loc.speed,
    heading: loc.heading,
    accuracy: loc.accuracy,
    recordedAt: loc.recordedAt,
  };
}

function locationPayload(trip, loc) {
  return {
    tripId: trip.id,
    driverId: String(trip.driver),
    vehicleId: String(trip.vehicle),
    lat: loc.lat,
    lng: loc.lng,
    speed: loc.speed ?? null,
    heading: loc.heading ?? null,
    accuracy: loc.accuracy ?? null,
    recordedAt: loc.recordedAt,
  };
}

// Traffic is checked at most every trafficCheckSeconds per trip. The Mapbox
// call happens outside the trip queue so it never holds up location pings.
function isTrafficCheckDue(state) {
  if (!mapbox.isConfigured()) return false;
  const now = Date.now();
  if (state.lastTrafficCheckAt && now - state.lastTrafficCheckAt < cfg.trafficCheckSeconds * 1000) {
    return false;
  }
  state.lastTrafficCheckAt = now;
  return true;
}

function checkTraffic(tripId, from, to) {
  mapbox
    .getRoute(from, to)
    .then((route) => route && enqueue(tripId, () => applyTraffic(tripId, route, from)))
    .catch((err) => console.error("[traffic]", err.message));
}

async function applyTraffic(tripId, route, coordinates) {
  const trip = await Trip.findById(tripId).select("-route.geometry");
  if (!trip || trip.status !== "in_progress") return;

  const state = await loadState(tripId);
  const now = Date.now();
  const typical = route.typicalDurationSeconds;
  const delaySeconds = typical ? Math.max(0, route.durationSeconds - typical) : 0;
  const heavy =
    Boolean(typical) &&
    delaySeconds >= cfg.trafficDelayMinutes * 60 &&
    route.durationSeconds >= typical * cfg.trafficDelayRatio;

  const cooledDown =
    !state.lastTrafficAlertAt ||
    now - state.lastTrafficAlertAt >= cfg.trafficAlertCooldownMinutes * MINUTE_MS;
  const shouldAlert = heavy && !state.traffic && cooledDown;
  state.traffic = heavy;
  if (shouldAlert) state.lastTrafficAlertAt = now;

  const eta = new Date(now + route.durationSeconds * 1000);
  const flags = flagsOf(state);
  await Promise.all([
    saveState(tripId, state),
    Trip.updateOne({ _id: trip._id, status: "in_progress" }, { $set: { eta, flags } }),
  ]);

  realtime.emitToUsers([trip.manager, trip.driver], "trip:update", {
    tripId: trip.id,
    flags,
    eta,
    remainingDistanceMeters: Math.round(route.distanceMeters),
    remainingDurationSeconds: Math.round(route.durationSeconds),
    trafficDelaySeconds: Math.round(delaySeconds),
  });

  if (shouldAlert) {
    const minutes = Math.round(delaySeconds / 60);
    await createAlert(trip, {
      type: "traffic",
      severity: "warning",
      text: `is in heavy traffic, about ${minutes} minutes slower than usual`,
      coordinates,
      meta: { trafficDelaySeconds: Math.round(delaySeconds), eta: eta.toISOString() },
    });
  }
}

// A trip whose driver app stops sending (dead phone, no network, app closed)
// produces no pings to react to, so it is caught by a periodic sweep instead.
async function checkSignal(tripId) {
  const trip = await Trip.findById(tripId).select("-route.geometry");
  if (!trip || trip.status !== "in_progress") return;

  const state = await loadState(tripId);
  const lastSeen = state.lastPingAt || trip.startedAt.getTime();
  const silentMs = Date.now() - lastSeen;
  if (state.signalLost || silentMs < cfg.signalLostMinutes * MINUTE_MS) return;

  state.signalLost = true;
  const flags = flagsOf(state);
  await Promise.all([
    saveState(tripId, state),
    Trip.updateOne({ _id: trip._id, status: "in_progress" }, { $set: { flags } }),
  ]);

  realtime.emitToUsers([trip.manager], "trip:update", { tripId: trip.id, flags });
  const last = trip.lastLocation && trip.lastLocation.location;
  await createAlert(trip, {
    type: "signal_lost",
    severity: "critical",
    text: `has sent no location for ${Math.floor(silentMs / MINUTE_MS)} minutes`,
    coordinates: last ? last.coordinates : undefined,
    meta: { lastSeenAt: new Date(lastSeen).toISOString() },
  });
}

async function sweep() {
  const trips = await Trip.find({ status: "in_progress" }).select("_id").lean();
  await Promise.all(
    trips.map((trip) => {
      const id = String(trip._id);
      return enqueue(id, () => checkSignal(id)).catch((err) =>
        console.error("[monitor]", id, err.message),
      );
    }),
  );
}

function startMonitor() {
  const timer = setInterval(() => {
    sweep().catch((err) => console.error("[monitor]", err.message));
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { recordLocation, initTrip, clearTrip, startMonitor };
