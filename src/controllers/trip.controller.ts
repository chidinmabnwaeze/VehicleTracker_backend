import type { Request, Response } from "express";
import * as mapbox from "../config/mapbox";
import { LocationPing } from "../models/LocationPing";
import {
  CLEAR_FLAGS,
  TRIP_STATUSES,
  Trip,
  type Place,
  type TripDocument,
  type TripRoute,
} from "../models/Trip";
import { User, type UserDocument } from "../models/User";
import { Vehicle } from "../models/Vehicle";
import * as realtime from "../services/realtime.service";
import * as tracking from "../services/tracking.service";
import type { TripStatus } from "../types/events";
import { ApiError } from "../utils/ApiError";
import { haversineDistance, type Position } from "../utils/geo";
import { pagination, parseLatLng, requireObjectId } from "../utils/validate";

const POPULATE = [
  { path: "driver", select: "name email phone" },
  { path: "vehicle", select: "plateNumber make vehicleModel type" },
];

// Managers see the trips they created, drivers the trips assigned to them
const scope = (user: UserDocument): Record<string, unknown> =>
  user.role === "manager" ? { manager: user._id } : { driver: user._id };

async function findTrip(req: Request, { withRoute = false } = {}): Promise<TripDocument> {
  const id = requireObjectId(req.params.id, "trip id");
  const query = Trip.findOne({ _id: id, ...scope(req.user) });
  if (!withRoute) query.select("-route.geometry");
  const trip = await query;
  if (!trip) throw new ApiError(404, "Trip not found");
  return trip;
}

const fullTrip = (id: TripDocument["_id"]) => Trip.findById(id).populate(POPULATE);

function parsePlace(input: unknown, label: string): Place {
  if (!input || typeof input !== "object") {
    throw new ApiError(400, `${label} is required, with lat and lng`);
  }
  const place = input as { name?: string; address?: string };
  return {
    name: place.name,
    address: place.address,
    location: { type: "Point", coordinates: parseLatLng(input, label) },
  };
}

async function planRoute(from: Position, to: Position): Promise<TripRoute> {
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

function emitStatus(trip: TripDocument): void {
  realtime.emitToUsers([trip.manager, trip.driver], "trip:status", {
    tripId: trip.id,
    status: trip.status,
    at: new Date().toISOString(),
    eta: trip.eta ? trip.eta.toISOString() : null,
  });
}

export async function createTrip(req: Request, res: Response): Promise<void> {
  const body = req.body || {};
  const driverId = requireObjectId(body.driverId, "driverId");
  const vehicleId = requireObjectId(body.vehicleId, "vehicleId");
  const origin = parsePlace(body.origin, "origin");
  const destination = parsePlace(body.destination, "destination");

  const [driver, vehicle] = await Promise.all([
    User.findOne({ _id: driverId, role: "driver", manager: req.user._id, isActive: true }),
    Vehicle.findOne({ _id: vehicleId, manager: req.user._id, isActive: true }),
  ]);
  if (!driver) throw new ApiError(404, "Driver not found or inactive");
  if (!vehicle) throw new ApiError(404, "Vehicle not found or inactive");

  const route = await planRoute(origin.location.coordinates, destination.location.coordinates);

  const trip = await Trip.create({
    manager: req.user._id,
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

export async function listTrips(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = pagination(req.query);
  const filter = scope(req.user);

  if (req.query.status) {
    const statuses = String(req.query.status).split(",");
    const unknown = statuses.find((status) => !TRIP_STATUSES.includes(status as TripStatus));
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

export async function getTrip(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req, { withRoute: true });
  res.json({ data: await trip.populate(POPULATE) });
}

export async function startTrip(req: Request, res: Response): Promise<void> {
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
  if (trip.route?.durationSeconds) {
    trip.eta = new Date(Date.now() + trip.route.durationSeconds * 1000);
  }
  await trip.save();
  await tracking.initTrip(trip.id);

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
}

export async function completeTrip(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  if (trip.status !== "in_progress" && trip.status !== "arrived") {
    throw new ApiError(409, `Trip is ${trip.status} and cannot be completed`);
  }
  trip.status = "completed";
  trip.completedAt = new Date();
  trip.flags = { ...CLEAR_FLAGS };
  await trip.save();
  await tracking.clearTrip(trip.id);

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
}

export async function cancelTrip(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  if (trip.status === "completed" || trip.status === "cancelled") {
    throw new ApiError(409, `Trip is ${trip.status} and cannot be cancelled`);
  }
  trip.status = "cancelled";
  trip.cancelledAt = new Date();
  trip.flags = { ...CLEAR_FLAGS };
  await trip.save();
  await tracking.clearTrip(trip.id);

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
}

// HTTP fallback for drivers who cannot hold a socket connection
export async function postLocation(req: Request, res: Response): Promise<void> {
  const result = await tracking.recordLocation(req.params.id, req.user._id, req.body);
  res.status(201).json({ data: result });
}

// The path the vehicle actually took, oldest first
export async function listLocations(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  const filter: Record<string, unknown> = { trip: trip._id };
  if (req.query.since) {
    const since = new Date(String(req.query.since));
    if (Number.isNaN(since.getTime())) throw new ApiError(400, "since must be a valid date");
    filter.recordedAt = { $gt: since };
  }
  const limit = Math.min(5000, Math.max(1, parseInt(String(req.query.limit), 10) || 1000));

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
