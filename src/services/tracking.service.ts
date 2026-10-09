import type { Types } from "mongoose";
import { env } from "../config/env";
import * as mapbox from "../config/mapbox";
import * as store from "../config/redis";
import { LocationPing } from "../models/LocationPing";
import { TRACKING_EVENT_TYPES, TrackingEvent } from "../models/TrackingEvent";
import { CLEAR_FLAGS, Trip, type LastLocation, type TripDocument } from "../models/Trip";
import type {
  BatteryReading,
  LocationResult,
  TrackingEventType,
  TripFlags,
  TripLocationEvent,
} from "../types/events";
import { ApiError } from "../utils/ApiError";
import { distanceToLine, haversineDistance, type Position } from "../utils/geo";
import {
  optionalNumber,
  parseBattery,
  parseLatLng,
  parseRecordedAt,
  requireObjectId,
} from "../utils/validate";
import { createAlert, type AlertInput } from "./alert.service";
import * as realtime from "./realtime.service";

const cfg = env.tracking;
const STATE_TTL_SECONDS = 24 * 60 * 60;
const SWEEP_INTERVAL_MS = 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Live detection state for a trip in progress, kept in Redis
interface TripState {
  lastPingAt?: number;
  lastRecordedAt?: number;
  signalLost?: boolean;
  offRouteCount?: number;
  deviated?: boolean;
  anchor?: { coordinates: Position; at: number };
  stationary?: boolean;
  traffic?: boolean;
  lastTrafficCheckAt?: number;
  lastTrafficAlertAt?: number;
}

interface NormalizedLocation {
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  battery?: BatteryReading;
  recordedAt: Date;
}

type PendingAlert = Omit<AlertInput, "coordinates">;

const stateKey = (tripId: string): string => `trip:state:${tripId}`;
const loadState = async (tripId: string): Promise<TripState> =>
  (await store.getJSON<TripState>(stateKey(tripId))) ?? {};
const saveState = (tripId: string, state: TripState): Promise<void> =>
  store.setJSON(stateKey(tripId), state, STATE_TTL_SECONDS);

const flagsOf = (state: TripState): TripFlags => ({
  deviated: Boolean(state.deviated),
  stationary: Boolean(state.stationary),
  traffic: Boolean(state.traffic),
  signalLost: Boolean(state.signalLost),
});

// Work for one trip runs one at a time so concurrent pings cannot
// overwrite each other's state or raise the same alert twice.
const queues = new Map<string, Promise<unknown>>();
function enqueue<T>(tripId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(tripId) ?? Promise.resolve();
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
const routeCache = new Map<string, Position[] | null>();
async function getRouteCoordinates(tripId: string): Promise<Position[] | null> {
  const cached = routeCache.get(tripId);
  if (cached !== undefined) return cached;
  const trip = await Trip.findById(tripId).select("route.geometry").lean();
  const coordinates = trip?.route?.geometry?.coordinates ?? null;
  routeCache.set(tripId, coordinates);
  return coordinates;
}

export async function initTrip(tripId: string): Promise<void> {
  routeCache.delete(tripId);
  await saveState(tripId, { lastPingAt: Date.now() });
}

export async function clearTrip(tripId: string): Promise<void> {
  routeCache.delete(tripId);
  await store.del(stateKey(tripId));
}

function normalizeLocation(raw: unknown): NormalizedLocation {
  const input = (raw ?? {}) as Record<string, unknown>;
  const [lng, lat] = parseLatLng(input, "location");
  return {
    lat,
    lng,
    speed: optionalNumber(input.speed),
    heading: optionalNumber(input.heading),
    accuracy: optionalNumber(input.accuracy),
    battery: parseBattery(input.battery),
    recordedAt: parseRecordedAt(input.timestamp ?? input.recordedAt),
  };
}

// Entry point for both the socket event and the HTTP fallback.
// raw comes straight from the client, so it is validated here.
export async function recordLocation(
  tripId: unknown,
  driverId: Types.ObjectId | string,
  raw: unknown,
): Promise<LocationResult> {
  const id = requireObjectId(tripId, "tripId");
  const location = normalizeLocation(raw);
  return enqueue(id, () => processLocation(id, driverId, location));
}

async function processLocation(
  tripId: string,
  driverId: Types.ObjectId | string,
  loc: NormalizedLocation,
): Promise<LocationResult> {
  const trip = await Trip.findById(tripId).select("-route.geometry");
  if (!trip) throw new ApiError(404, "Trip not found");
  if (!trip.driver.equals(driverId)) {
    throw new ApiError(403, "You are not the driver of this trip");
  }
  if (trip.status !== "in_progress") {
    throw new ApiError(
      409,
      `Trip is ${trip.status}; location is only accepted while it is in progress`,
    );
  }

  const coordinates: Position = [loc.lng, loc.lat];
  await LocationPing.create({
    trip: trip._id,
    driver: trip.driver,
    location: { type: "Point", coordinates },
    speed: loc.speed,
    heading: loc.heading,
    accuracy: loc.accuracy,
    battery: loc.battery,
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
  const destination = trip.destination.location.coordinates;
  const distanceToDestination = haversineDistance(coordinates, destination);

  if (reliable && distanceToDestination <= cfg.arrivalRadiusM) {
    return markArrived(trip, loc, coordinates);
  }

  const pending: PendingAlert[] = [];
  let distanceFromRoute: number | null = null;

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
    Trip.updateOne(
      { _id: trip._id, status: "in_progress" },
      { $set: { lastLocation, flags, ...deviceUpdate(loc) } },
    ),
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

  if (trafficCheckDue) checkTraffic(tripId, coordinates, destination);

  return { status: trip.status, flags };
}

function checkDeviation(state: TripState, distanceFromRoute: number): PendingAlert | null {
  if (distanceFromRoute <= cfg.deviationThresholdM) {
    state.offRouteCount = 0;
    state.deviated = false;
    return null;
  }
  state.offRouteCount = (state.offRouteCount ?? 0) + 1;
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

function checkStationary(
  state: TripState,
  coordinates: Position,
  recordedMs: number,
): PendingAlert | null {
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

async function markArrived(
  trip: TripDocument,
  loc: NormalizedLocation,
  coordinates: Position,
): Promise<LocationResult> {
  const arrived = await Trip.findOneAndUpdate(
    { _id: trip._id, status: "in_progress" },
    {
      $set: {
        status: "arrived",
        arrivedAt: loc.recordedAt,
        lastLocation: buildLastLocation(loc, coordinates),
        flags: CLEAR_FLAGS,
        ...deviceUpdate(loc),
      },
    },
    { returnDocument: "after" },
  ).select("-route.geometry");
  // Cancelled or completed while this ping was being processed
  if (!arrived) return { status: trip.status, flags: CLEAR_FLAGS };

  await clearTrip(trip.id);

  realtime.emitToUsers([trip.manager], "trip:location", {
    ...locationPayload(trip, loc),
    flags: CLEAR_FLAGS,
    distanceFromRouteMeters: null,
    distanceToDestinationMeters: 0,
  });
  realtime.emitToUsers([trip.manager, trip.driver], "trip:status", {
    tripId: trip.id,
    status: "arrived",
    at: loc.recordedAt.toISOString(),
    eta: null,
  });
  await createAlert(trip, {
    type: "arrival",
    severity: "info",
    text: `has arrived at ${trip.destination.name || "the destination"}`,
    coordinates,
  });

  return { status: "arrived", flags: CLEAR_FLAGS };
}

function buildLastLocation(loc: NormalizedLocation, coordinates: Position): LastLocation {
  return {
    location: { type: "Point", coordinates },
    speed: loc.speed,
    heading: loc.heading,
    accuracy: loc.accuracy,
    recordedAt: loc.recordedAt,
  };
}

// Fields of trip.tracking refreshed by a location ping
function deviceUpdate(loc: NormalizedLocation): Record<string, unknown> {
  return {
    "tracking.lastSeenAt": new Date(),
    ...(loc.battery
      ? { "tracking.battery": loc.battery, "tracking.batteryAt": loc.recordedAt }
      : {}),
  };
}

function locationPayload(
  trip: TripDocument,
  loc: NormalizedLocation,
): Omit<TripLocationEvent, "flags" | "distanceFromRouteMeters" | "distanceToDestinationMeters"> {
  return {
    tripId: trip.id,
    driverId: String(trip.driver),
    vehicleId: String(trip.vehicle),
    lat: loc.lat,
    lng: loc.lng,
    speed: loc.speed ?? null,
    heading: loc.heading ?? null,
    accuracy: loc.accuracy ?? null,
    battery: loc.battery ?? null,
    recordedAt: loc.recordedAt.toISOString(),
  };
}

// The driver app reports when it is backgrounded, goes offline or loses
// location access. These are stored and relayed, and the latest one is used to
// explain a signal_lost alert. They do not count as location pings.
export async function recordTrackingEvent(
  tripId: unknown,
  driverId: Types.ObjectId | string,
  raw: unknown,
): Promise<void> {
  const id = requireObjectId(tripId, "tripId");
  const input = (raw ?? {}) as Record<string, unknown>;
  const type = input.type as TrackingEventType;
  if (!TRACKING_EVENT_TYPES.includes(type)) {
    throw new ApiError(400, `type must be one of: ${TRACKING_EVENT_TYPES.join(", ")}`);
  }
  const battery = parseBattery(input.battery);
  const recordedAt = parseRecordedAt(input.timestamp ?? input.recordedAt);

  const trip = await Trip.findById(id).select("-route.geometry");
  if (!trip) throw new ApiError(404, "Trip not found");
  if (!trip.driver.equals(driverId)) {
    throw new ApiError(403, "You are not the driver of this trip");
  }
  if (trip.status !== "in_progress") {
    throw new ApiError(
      409,
      `Trip is ${trip.status}; tracking events are only accepted while it is in progress`,
    );
  }

  await Promise.all([
    TrackingEvent.create({ trip: trip._id, driver: trip.driver, type, battery, recordedAt }),
    Trip.updateOne(
      { _id: trip._id },
      {
        $set: {
          "tracking.lastEvent": { type, recordedAt },
          ...(battery ? { "tracking.battery": battery, "tracking.batteryAt": recordedAt } : {}),
        },
      },
    ),
  ]);

  realtime.emitToUsers([trip.manager], "trip:tracking", {
    tripId: trip.id,
    type,
    battery: battery ?? null,
    recordedAt: recordedAt.toISOString(),
  });
}

const INTERRUPTIONS: Partial<Record<TrackingEventType, string>> = {
  backgrounded: "the app was sent to the background",
  offline: "the phone went offline",
  "location-denied": "location access was turned off",
  "location-unavailable": "the phone could not get a location fix",
};

// What the phone last said about itself, appended to a signal_lost alert so
// the manager can tell a dead battery from a closed app
function describeDevice(trip: TripDocument): string {
  const parts: string[] = [];
  const reason = trip.tracking?.lastEvent && INTERRUPTIONS[trip.tracking.lastEvent.type];
  if (reason) parts.push(`Last report: ${reason}.`);
  const battery = trip.tracking?.battery;
  parts.push(
    battery
      ? `Last battery reading: ${battery.level}%${battery.charging ? ", charging" : ""}.`
      : "Battery level was not reported.",
  );
  return parts.join(" ");
}

// Traffic is checked at most every trafficCheckSeconds per trip
function isTrafficCheckDue(state: TripState): boolean {
  if (!mapbox.isConfigured()) return false;
  const now = Date.now();
  if (state.lastTrafficCheckAt && now - state.lastTrafficCheckAt < cfg.trafficCheckSeconds * 1000) {
    return false;
  }
  state.lastTrafficCheckAt = now;
  return true;
}

// The Mapbox call happens outside the trip queue so it never holds up location pings
function checkTraffic(tripId: string, from: Position, to: Position): void {
  mapbox
    .getRoute(from, to)
    .then((route) =>
      route ? enqueue(tripId, () => applyTraffic(tripId, route, from)) : undefined,
    )
    .catch((err: Error) => console.error("[traffic]", err.message));
}

async function applyTraffic(
  tripId: string,
  route: mapbox.PlannedRoute,
  coordinates: Position,
): Promise<void> {
  const trip = await Trip.findById(tripId).select("-route.geometry");
  if (!trip || trip.status !== "in_progress") return;

  const state = await loadState(tripId);
  const now = Date.now();
  const typical = route.typicalDurationSeconds;
  const delaySeconds = typical ? Math.max(0, route.durationSeconds - typical) : 0;
  const heavy =
    typical !== undefined &&
    typical > 0 &&
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
    eta: eta.toISOString(),
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
async function checkSignal(tripId: string): Promise<void> {
  const trip = await Trip.findById(tripId).select("-route.geometry");
  if (!trip || trip.status !== "in_progress") return;

  const state = await loadState(tripId);
  const lastSeen =
    state.lastPingAt ??
    trip.tracking?.lastSeenAt?.getTime() ??
    trip.startedAt?.getTime() ??
    Date.now();
  const silentMs = Date.now() - lastSeen;
  if (state.signalLost || silentMs < cfg.signalLostMinutes * MINUTE_MS) return;

  state.signalLost = true;
  const flags = flagsOf(state);
  await Promise.all([
    saveState(tripId, state),
    Trip.updateOne({ _id: trip._id, status: "in_progress" }, { $set: { flags } }),
  ]);

  realtime.emitToUsers([trip.manager], "trip:update", { tripId: trip.id, flags });
  await createAlert(trip, {
    type: "signal_lost",
    severity: "critical",
    text: `has sent no location for ${Math.floor(silentMs / MINUTE_MS)} minutes. ${describeDevice(trip)}`,
    coordinates: trip.lastLocation?.location?.coordinates,
    meta: {
      lastSeenAt: new Date(lastSeen).toISOString(),
      battery: trip.tracking?.battery ?? null,
      lastEvent: trip.tracking?.lastEvent?.type ?? null,
    },
  });
}

async function sweep(): Promise<void> {
  const trips = await Trip.find({ status: "in_progress" }).select("_id").lean();
  await Promise.all(
    trips.map((trip) => {
      const id = String(trip._id);
      return enqueue(id, () => checkSignal(id)).catch((err: Error) =>
        console.error("[monitor]", id, err.message),
      );
    }),
  );
}

export function startMonitor(): () => void {
  const timer = setInterval(() => {
    sweep().catch((err: Error) => console.error("[monitor]", err.message));
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
