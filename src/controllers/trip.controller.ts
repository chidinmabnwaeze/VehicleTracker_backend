import type { Request, Response } from "express";
import * as mapbox from "../config/mapbox";
import { env } from "../config/env";
import { LocationPing } from "../models/LocationPing";
import { TrackingEvent } from "../models/TrackingEvent";
import {
  CLEAR_FLAGS,
  DELIVERY_TYPES,
  TRIP_STATUSES,
  Trip,
  type Place,
  type TripDocument,
  type TripPackage,
  type TripRoute,
} from "../models/Trip";
import { User, type UserDocument } from "../models/User";
import { Vehicle, type VehicleDocument } from "../models/Vehicle";
import { createAlert } from "../services/alert.service";
import * as realtime from "../services/realtime.service";
import * as tracking from "../services/tracking.service";
import type { DeliveryRange, DeliveryType, TripStatus } from "../types/events";
import { ApiError } from "../utils/ApiError";
import { haversineDistance, type Position } from "../utils/geo";
import {
  pagination,
  parseBattery,
  parseLatLng,
  requireObjectId,
  requireString,
} from "../utils/validate";

const POPULATE = [
  { path: "driver", select: "name email phone" },
  { path: "vehicle", select: "plateNumber make vehicleModel type" },
];

// Managers see the trips they created, drivers the trips assigned to them
const scope = (user: UserDocument): Record<string, unknown> =>
  user.role === "manager" ? { manager: user._id } : { driver: user._id };

// A trip is addressed by its id or by its tracking number (reference)
function tripKey(param: unknown): Record<string, unknown> {
  const key = String(param ?? "").trim();
  if (!key) throw new ApiError(400, "trip id is required");
  return /^[0-9a-f]{24}$/i.test(key) ? { _id: key } : { reference: key.toUpperCase() };
}

async function findTrip(req: Request, { withRoute = false } = {}): Promise<TripDocument> {
  const query = Trip.findOne({ ...tripKey(req.params.id), ...scope(req.user) });
  if (!withRoute) query.select("-route.geometry");
  const trip = await query;
  if (!trip) throw new ApiError(404, "Trip not found");
  return trip;
}

const fullTrip = (id: TripDocument["_id"]) => Trip.findById(id).populate(POPULATE);

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

// Accepts { lat, lng }, or just an address (a string or { address }) that is
// looked up with Mapbox. The name keeps what the user typed.
async function resolvePlace(input: unknown, label: string): Promise<Place> {
  const source = (typeof input === "string" ? { address: input } : input) as Record<
    string,
    unknown
  > | null;
  if (!source || typeof source !== "object") throw new ApiError(400, `${label} is required`);

  const name = text(source.name);
  const address = text(source.address);
  const hasCoordinates = (source.lat ?? source.latitude) != null;

  if (!hasCoordinates) {
    if (!address) throw new ApiError(400, `${label} needs an address, or a lat and lng`);
    if (!mapbox.isConfigured()) {
      throw new ApiError(
        400,
        `${label} needs a lat and lng: address lookup is off because MAPBOX_ACCESS_TOKEN is not set`,
      );
    }
    const found = await mapbox.geocode(address);
    if (!found) {
      throw new ApiError(
        422,
        `Could not find "${address}". Try a more specific ${label} address`,
        "address-not-found",
      );
    }
    return {
      name: name || address,
      address: found.address,
      region: found.region,
      location: { type: "Point", coordinates: found.coordinates },
    };
  }

  const coordinates = parseLatLng(source, label);
  // Bare coordinates (e.g. "use my location") are named by a reverse lookup.
  // That is a nicety, so a failed lookup does not fail the request.
  const region = text(source.region);
  const found =
    mapbox.isConfigured() && (!address || !region)
      ? await mapbox.reverseGeocode(coordinates).catch(() => null)
      : null;
  return {
    name: name || found?.name || undefined,
    address: address || found?.address || undefined,
    region: region || found?.region,
    location: { type: "Point", coordinates },
  };
}

function parsePackage(input: unknown): TripPackage | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const deliveryType = text(source.deliveryType);
  if (deliveryType && !DELIVERY_TYPES.includes(deliveryType as DeliveryType)) {
    throw new ApiError(400, `deliveryType must be one of: ${DELIVERY_TYPES.join(", ")}`);
  }
  return {
    name: text(source.name),
    deliveryType: deliveryType as DeliveryType | undefined,
    category: text(source.category),
    description: text(source.description),
  };
}

// Unknown when either place could not be tied to a state
function rangeOf(origin: Place, destination: Place): DeliveryRange | undefined {
  if (!origin.region || !destination.region) return undefined;
  return origin.region === destination.region ? "Intra-State" : "Inter-State";
}

// A tracking number such as LKH-482-913, unique among the manager's trips
async function newReference(managerId: UserDocument["_id"]): Promise<string> {
  const part = (): string => String(Math.floor(100 + Math.random() * 900));
  for (let attempt = 0; attempt < 10; attempt++) {
    const reference = `LKH-${part()}-${part()}`;
    if (!(await Trip.exists({ manager: managerId, reference }))) return reference;
  }
  throw new ApiError(500, "Could not generate a tracking number, please try again");
}

// The driver for a trip and the vehicle they will use: the one given, or
// otherwise the vehicle assigned to that driver
async function resolveAssignment(
  managerId: UserDocument["_id"],
  body: Record<string, unknown>,
): Promise<{ driver: UserDocument; vehicle: VehicleDocument }> {
  const driverId = requireObjectId(body.driverId, "driverId");
  const driver = await User.findOne({
    _id: driverId,
    role: "driver",
    manager: managerId,
    isActive: true,
  });
  if (!driver) throw new ApiError(404, "Driver not found or inactive");

  const vehicleId = body.vehicleId ? requireObjectId(body.vehicleId, "vehicleId") : driver.vehicle;
  if (!vehicleId) {
    throw new ApiError(409, "This driver has no vehicle assigned", "driver-has-no-vehicle");
  }
  const vehicle = await Vehicle.findOne({ _id: vehicleId, manager: managerId, isActive: true });
  if (!vehicle) throw new ApiError(404, "Vehicle not found or inactive");
  return { driver, vehicle };
}

export async function planRoute(from: Position, to: Position): Promise<TripRoute> {
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
  // The driver is optional: an order can be created first and assigned after
  const assignment = body.driverId ? await resolveAssignment(req.user._id, body) : null;
  const [origin, destination] = await Promise.all([
    resolvePlace(body.origin, "origin"),
    resolvePlace(body.destination, "destination"),
  ]);
  // Closer than the arrival radius and the trip would count as arrived the moment it starts
  const apart = haversineDistance(origin.location.coordinates, destination.location.coordinates);
  if (apart <= env.tracking.arrivalRadiusM) {
    throw new ApiError(
      400,
      "Pickup and delivery locations are the same place. Choose two different locations",
      "same-location",
    );
  }

  const route = await planRoute(origin.location.coordinates, destination.location.coordinates);

  const trip = await Trip.create({
    manager: req.user._id,
    driver: assignment?.driver._id,
    vehicle: assignment?.vehicle._id,
    reference: text(body.reference) || (await newReference(req.user._id)),
    cargo: body.cargo,
    notes: body.notes,
    package: parsePackage(body.package),
    range: rangeOf(origin, destination),
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

// Gives a pending trip to a driver, along with that driver's vehicle
export async function assignTrip(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  if (trip.status !== "pending") {
    throw new ApiError(409, `Trip is ${trip.status} and can no longer be assigned`);
  }
  const { driver, vehicle } = await resolveAssignment(req.user._id, req.body || {});
  trip.driver = driver._id;
  trip.vehicle = vehicle._id;
  await trip.save();

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
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
  if (driverBusy) {
    throw new ApiError(409, "You already have a trip in progress", "trip-in-progress");
  }
  if (vehicleBusy) throw new ApiError(409, "This vehicle is already on a trip", "vehicle-in-use");

  // A phone that dies mid-trip takes the tracking with it. Not enforced where
  // the browser cannot report battery (iOS, Firefox).
  const minBattery = env.tracking.minStartBattery;
  const battery = parseBattery(req.body?.battery);
  if (battery && !battery.charging && battery.level < minBattery) {
    throw new ApiError(
      409,
      `Battery is at ${battery.level}%. Charge to at least ${minBattery}% or plug in before starting a trip`,
      "low-battery",
    );
  }

  trip.status = "in_progress";
  trip.startedAt = new Date();
  if (trip.route?.durationSeconds) {
    trip.eta = new Date(Date.now() + trip.route.durationSeconds * 1000);
  }
  if (battery) trip.tracking = { battery, batteryAt: trip.startedAt };
  await trip.save();
  await tracking.initTrip(trip.id);

  emitStatus(trip);
  res.json({ data: await fullTrip(trip._id) });
}

// The driver has collected the package
export async function pickupTrip(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  if (trip.status !== "in_progress" && trip.status !== "arrived") {
    throw new ApiError(409, `Trip is ${trip.status}; pickup can only be marked during the trip`);
  }
  if (!trip.pickedUpAt) {
    trip.pickedUpAt = new Date();
    await trip.save();
    emitStatus(trip);
  }
  res.json({ data: await fullTrip(trip._id) });
}

// A note from the driver to their manager (traffic, a breakdown, ...), raised as an alert
export async function postMessage(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  if (trip.status !== "in_progress" && trip.status !== "arrived") {
    throw new ApiError(409, `Trip is ${trip.status}; messages can only be sent during the trip`);
  }
  const category = requireString(req.body?.category, "category").slice(0, 60);
  const description = requireString(req.body?.description, "description").slice(0, 500);

  await createAlert(trip, {
    type: "driver_message",
    severity: "info",
    title: `New Message: ${category}`,
    text: description,
    verbatim: true,
    coordinates: trip.lastLocation?.location?.coordinates,
    meta: { category },
  });
  res.status(204).end();
}

export async function completeTrip(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  if (trip.status !== "in_progress" && trip.status !== "arrived") {
    throw new ApiError(409, `Trip is ${trip.status} and cannot be completed`);
  }
  // A driver can only mark a delivery done at the destination. A manager can
  // still close a trip early.
  if (req.user.role === "driver" && trip.status !== "arrived") {
    throw new ApiError(
      409,
      "You have not reached the destination yet",
      "destination-not-reached",
    );
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

export async function postTrackingEvent(req: Request, res: Response): Promise<void> {
  await tracking.recordTrackingEvent(req.params.id, req.user._id, req.body);
  res.status(204).end();
}

// What the driver's phone reported during the trip, oldest first
export async function listTrackingEvents(req: Request, res: Response): Promise<void> {
  const trip = await findTrip(req);
  const events = await TrackingEvent.find({ trip: trip._id }).sort({ recordedAt: 1 }).lean();
  res.json({
    data: events.map((event) => ({
      type: event.type,
      battery: event.battery ?? null,
      recordedAt: event.recordedAt,
    })),
  });
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
      battery: ping.battery ?? null,
      recordedAt: ping.recordedAt,
    })),
  });
}
