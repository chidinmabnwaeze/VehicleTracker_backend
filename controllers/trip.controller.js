const Trip = require("../models/Trip");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const LocationPing = require("../models/LocationPing");
const mapbox = require("../config/mapbox");
const ApiError = require("../utils/ApiError");
const { haversineDistance } = require("../utils/geo");
const { requireObjectId, parseLatLng, pagination } = require("../utils/validate");
const realtime = require("../services/realtime.service");
const tracking = require("../services/tracking.service");

const CLEAR_FLAGS = { deviated: false, stationary: false, traffic: false, signalLost: false };
const STATUSES = ["pending", "in_progress", "arrived", "completed", "cancelled"];
const POPULATE = [
  { path: "driver", select: "name email phone" },
  { path: "vehicle", select: "plateNumber make vehicleModel type" },
];

// Managers see the trips they created, drivers the trips assigned to them
const scope = (user) =>
  user.role === "manager" ? { manager: user.id } : { driver: user.id };

async function findTrip(req, { withRoute = false } = {}) {
  const id = requireObjectId(req.params.id, "trip id");
  const query = Trip.findOne({ _id: id, ...scope(req.user) });
  if (!withRoute) query.select("-route.geometry");
  const trip = await query;
  if (!trip) throw new ApiError(404, "Trip not found");
  return trip;
}

const fullTrip = (id) => Trip.findById(id).populate(POPULATE);

function parsePlace(input, label) {
  if (!input || typeof input !== "object") {
    throw new ApiError(400, `${label} is required, with lat and lng`);
  }
  return {
    name: input.name,
    address: input.address,
    location: { type: "Point", coordinates: parseLatLng(input, label) },
  };
}

async function planRoute(from, to) {
  if (!mapbox.isConfigured()) {
    return {
      source: "straight_line",
      geometry: { type: "LineString", coordinates: [from, to] },
      distanceMeters: Math.round(haversineDistance(from, to)),
    };
  }
  const route = await mapbox.getRoute(from, to);
  if (!route) {
    throw new ApiError(422, "No drivable route found between origin and destination");
  }
  return {
    source: "mapbox",
    geometry: route.geometry,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.typicalDurationSeconds || route.durationSeconds,
  };
}

function emitStatus(trip) {
  realtime.emitToUsers([trip.manager, trip.driver], "trip:status", {
    tripId: trip.id,
    status: trip.status,
    at: new Date(),
    eta: trip.eta || null,
  });
}

async function createTrip(req, res) {
  const body = req.body || {};
  const driverId = requireObjectId(body.driverId, "driverId");
  const vehicleId = requireObjectId(body.vehicleId, "vehicleId");
  const origin = parsePlace(body.origin, "origin");
  const destination = parsePlace(body.destination, "destination");

  const [driver, vehicle] = await Promise.all([
    User.findOne({ _id: driverId, role: "driver", manager: req.user.id, isActive: true }),
    Vehicle.findOne({ _id: vehicleId, manager: req.user.id, isActive: true }),
  ]);
  if (!driver) throw new ApiError(404, "Driver not found or inactive");
  if (!vehicle) throw new ApiError(404, "Vehicle not found or inactive");

  const route = await planRoute(origin.location.coordinates, destination.location.coordinates);

  const trip = await Trip.create({
    manager: req.user.id,
    driver: driver._id,
    vehicle: vehicle._id,
    reference: body.reference,
    cargo: body.cargo,
    notes: body.notes,
    origin,
    destination,
    route,
  });

  emitStatus(trip);
  res.status(201).json({ data: await fullTrip(trip._id) });
}

async function listTrips(req, res) {
  const { page, limit, skip } = pagination(req.query);
  const filter = scope(req.user);

  if (req.query.status) {
    const statuses = String(req.query.status).split(",");
    const unknown = statuses.find((status) => !STATUSES.includes(status));
    if (unknown) throw new ApiError(400, `Unknown status: ${unknown}`);
    filter.status = { $in: statuses };
  }
  if (req.user.role === "manager") {
    if (req.query.driverId) filter.driver = requireObjectId(req.query.driverId, "driverId");
    if (req.query.vehicleId) filter.vehicle = requireObjectId(req.query.vehicleId, "vehicleId");
  }

  const [trips, total] = await Promise.all([
    Trip.find(filter)
      .select("-route.geometry")
      .populate(POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Trip.countDocuments(filter),
  ]);
  res.json({ data: trips, meta: { page, limit, total } });
}

async function getTrip(req, res) {
  const trip = await findTrip(req, { withRoute: true });
  res.json({ data: await trip.populate(POPULATE) });
}

async function startTrip(req, res) {
  const trip = await findTrip(req);
  if (trip.status !== "pending") {
    throw new ApiError(409, `Trip is ${trip.status} and cannot be started`);
  }
  const [driverBusy, vehicleBusy] = await Promise.all([
    Trip.exists({ driver: trip.driver, status: "in_progress" }),
    Trip.exists({ vehicle: trip.vehicle, status: "in_progress" }),
  ]);
  if (driverBusy) throw new ApiError(409, "You already have a trip in progress");
  if (vehicleBusy) throw new ApiError(409, "This vehicle is already on a trip");

  trip.status = "in_progress";
  trip.startedAt = new Date();
  if (trip.route && trip.route.durationSeconds) {
    trip.eta = new Date(Date.now() + trip.route.durationSeconds * 1000);
  }
  await trip.save();
  await tracking.initTrip(trip.id);

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
}

async function completeTrip(req, res) {
  const trip = await findTrip(req);
  if (!["in_progress", "arrived"].includes(trip.status)) {
    throw new ApiError(409, `Trip is ${trip.status} and cannot be completed`);
  }
  trip.status = "completed";
  trip.completedAt = new Date();
  trip.flags = CLEAR_FLAGS;
  await trip.save();
  await tracking.clearTrip(trip.id);

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
}

async function cancelTrip(req, res) {
  const trip = await findTrip(req);
  if (!["pending", "in_progress", "arrived"].includes(trip.status)) {
    throw new ApiError(409, `Trip is ${trip.status} and cannot be cancelled`);
  }
  trip.status = "cancelled";
  trip.cancelledAt = new Date();
  trip.flags = CLEAR_FLAGS;
  await trip.save();
  await tracking.clearTrip(trip.id);

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
}

// HTTP fallback for drivers who cannot hold a socket connection
async function postLocation(req, res) {
  const result = await tracking.recordLocation(req.params.id, req.user.id, req.body);
  res.status(201).json({ data: result });
}

// The path the vehicle actually took, oldest first
async function listLocations(req, res) {
  const trip = await findTrip(req);
  const filter = { trip: trip._id };
  if (req.query.since) {
    const since = new Date(req.query.since);
    if (Number.isNaN(since.getTime())) throw new ApiError(400, "since must be a valid date");
    filter.recordedAt = { $gt: since };
  }
  const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 1000));

  const pings = await LocationPing.find(filter).sort({ recordedAt: 1 }).limit(limit).lean();
  res.json({
    data: pings.map((ping) => ({
      lat: ping.location.coordinates[1],
      lng: ping.location.coordinates[0],
      speed: ping.speed ?? null,
      heading: ping.heading ?? null,
      accuracy: ping.accuracy ?? null,
      recordedAt: ping.recordedAt,
    })),
  });
}

module.exports = {
  createTrip,
  listTrips,
  getTrip,
  startTrip,
  completeTrip,
  cancelTrip,
  postLocation,
  listLocations,
};
