// Demo data for building the frontend against: one manager, their drivers and
// vehicles, and trips in every status with routes, driven paths and alerts.
// Run with `npm run seed`, or `npm run seed -- --reset` to replace it.
import type { Types } from "mongoose";
import { planRoute } from "../controllers/trip.controller";
import { Alert } from "../models/Alert";
import { LocationPing } from "../models/LocationPing";
import { TrackingEvent } from "../models/TrackingEvent";
import { CLEAR_FLAGS, Trip, type TripRoute } from "../models/Trip";
import { User, type UserDocument } from "../models/User";
import { Vehicle, type VehicleDocument } from "../models/Vehicle";
import type {
  AlertSeverity,
  AlertType,
  BatteryReading,
  TripFlags,
  TripStatus,
} from "../types/events";
import type { Position } from "../utils/geo";

export const SEED_PASSWORD = "password123";
export const SEED_MANAGER = {
  name: "Adaeze Okonkwo",
  email: "manager@example.com",
  phone: "+234 803 555 0101",
};

const DRIVERS = [
  { name: "Emeka Obi", email: "emeka@gmail.com", phone: "+234 803 555 0111" },
  { name: "Tunde Bakare", email: "tunde@gmail.com", phone: "+234 805 555 0112" },
  { name: "Ibrahim Musa", email: "ibrahim@gmail.com", phone: "+234 806 555 0113" },
  { name: "Chinedu Eze", email: "chinedu@gmail.com", phone: "+234 807 555 0114" },
  { name: "Segun Adeyemi", email: "segun@gmail.com", phone: "+234 808 555 0115" },
  { name: "Yusuf Abdullahi", email: "yusuf@gmail.com", phone: "+234 809 555 0116" },
  { name: "Blessing Okafor", email: "blessing@gmail.com", phone: "+234 810 555 0117" },
];

const VEHICLES = [
  { plateNumber: "LND-482-XA", make: "Toyota", vehicleModel: "Hiace", type: "Van" },
  { plateNumber: "KJA-731-BC", make: "Mitsubishi", vehicleModel: "Canter", type: "Truck" },
  { plateNumber: "EPE-209-DF", make: "Suzuki", vehicleModel: "Carry", type: "Mini truck" },
  { plateNumber: "IKD-564-GH", make: "Bajaj", vehicleModel: "Boxer BM150", type: "Motorcycle" },
  { plateNumber: "APP-118-JK", make: "Mercedes-Benz", vehicleModel: "Sprinter", type: "Van" },
  { plateNumber: "FST-377-LM", make: "Honda", vehicleModel: "CG125", type: "Motorcycle" },
  { plateNumber: "BDG-640-NP", make: "Isuzu", vehicleModel: "NPR", type: "Truck" },
  // In the workshop, so it shows up as inactive
  { plateNumber: "MUS-905-QR", make: "Toyota", vehicleModel: "Dyna", type: "Truck", isActive: false },
];

interface SeedPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

const PLACES = {
  ikeja: { name: "Ikeja Warehouse", address: "Obafemi Awolowo Way, Ikeja, Lagos", lat: 6.6018, lng: 3.3515 },
  lekki: { name: "Lekki Phase 1 Store", address: "Admiralty Way, Lekki Phase 1, Lagos", lat: 6.4474, lng: 3.4723 },
  apapa: { name: "Apapa Port Depot", address: "Wharf Road, Apapa, Lagos", lat: 6.4433, lng: 3.3661 },
  ikorodu: { name: "Ikorodu Distribution Point", address: "Lagos Road, Ikorodu, Lagos", lat: 6.6194, lng: 3.5105 },
  yaba: { name: "Tejuosho Market", address: "Ojuelegba Road, Yaba, Lagos", lat: 6.5095, lng: 3.3711 },
  vi: { name: "Victoria Island Office", address: "Adeola Odeku Street, Victoria Island, Lagos", lat: 6.4281, lng: 3.4219 },
  surulere: { name: "Surulere Outlet", address: "Adeniran Ogunsanya Street, Surulere, Lagos", lat: 6.4926, lng: 3.3565 },
  ajah: { name: "Ajah Collection Centre", address: "Lekki-Epe Expressway, Ajah, Lagos", lat: 6.4698, lng: 3.5852 },
  oshodi: { name: "Oshodi Hub", address: "Agege Motor Road, Oshodi, Lagos", lat: 6.555, lng: 3.343 },
  festac: { name: "Festac Town Shop", address: "2nd Avenue, Festac Town, Lagos", lat: 6.4667, lng: 3.2833 },
  maryland: { name: "Maryland Mall", address: "Ikorodu Road, Maryland, Lagos", lat: 6.572, lng: 3.3672 },
  ikoyi: { name: "Ikoyi Residence", address: "Awolowo Road, Ikoyi, Lagos", lat: 6.4423, lng: 3.4273 },
} satisfies Record<string, SeedPlace>;

type PlaceKey = keyof typeof PLACES;
type Scenario = "on_route" | "deviated" | "stationary";

interface TripSpec {
  reference: string;
  cargo: string;
  notes?: string;
  from: PlaceKey;
  to: PlaceKey;
  driver: number; // index into DRIVERS
  vehicle: number; // index into VEHICLES
  status: TripStatus;
  // How long ago the trip was created
  createdMinutesAgo: number;
  // in_progress only: what the vehicle is doing right now
  scenario?: Scenario;
  // completed only: alerts that were raised along the way
  history?: AlertType[];
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const TRIPS: TripSpec[] = [
  // Waiting for the driver to start. Log in as Emeka or Yusuf to start one.
  { reference: "LKH-482-913", cargo: "40 cartons of Indomie noodles", from: "ikeja", to: "lekki", driver: 0, vehicle: 0, status: "pending", createdMinutesAgo: 35 },
  { reference: "LKH-517-204", cargo: "Office furniture, 12 pieces", notes: "Call the receiver on arrival", from: "apapa", to: "ikorodu", driver: 5, vehicle: 6, status: "pending", createdMinutesAgo: 90 },
  // On the road right now
  { reference: "LKH-603-771", cargo: "Pharmaceutical supplies, 18 boxes", notes: "Keep out of direct sunlight", from: "oshodi", to: "vi", driver: 1, vehicle: 1, status: "in_progress", scenario: "on_route", createdMinutesAgo: 70 },
  { reference: "LKH-648-320", cargo: "6 LG televisions", from: "yaba", to: "ajah", driver: 2, vehicle: 2, status: "in_progress", scenario: "deviated", createdMinutesAgo: 95 },
  { reference: "LKH-655-098", cargo: "Frozen fish, 20 crates", from: "apapa", to: "maryland", driver: 3, vehicle: 4, status: "in_progress", scenario: "stationary", createdMinutesAgo: 110 },
  // At the destination, waiting to be marked delivered
  { reference: "LKH-590-446", cargo: "Ankara textiles, 15 bales", from: "yaba", to: "surulere", driver: 4, vehicle: 3, status: "arrived", createdMinutesAgo: 80 },
  // History
  { reference: "LKH-401-287", cargo: "Soft drinks, 60 crates", from: "ikeja", to: "festac", driver: 0, vehicle: 0, status: "completed", createdMinutesAgo: (DAY + 3 * HOUR) / MIN, history: ["traffic"] },
  { reference: "LKH-388-152", cargo: "Dangote cement, 30 bags", from: "apapa", to: "ikoyi", driver: 4, vehicle: 1, status: "completed", createdMinutesAgo: (2 * DAY + 5 * HOUR) / MIN, history: ["deviation", "stationary"] },
  { reference: "LKH-352-609", cargo: "Phone accessories, 8 cartons", from: "maryland", to: "lekki", driver: 2, vehicle: 5, status: "completed", createdMinutesAgo: (4 * DAY + 2 * HOUR) / MIN },
  { reference: "LKH-340-875", cargo: "Bottled water, 100 packs", from: "oshodi", to: "ikorodu", driver: 5, vehicle: 6, status: "completed", createdMinutesAgo: (6 * DAY + 6 * HOUR) / MIN, history: ["signal_lost"] },
  { reference: "LKH-333-021", cargo: "Generator parts", notes: "Cancelled: customer rescheduled", from: "surulere", to: "ajah", driver: 5, vehicle: 2, status: "cancelled", createdMinutesAgo: (3 * DAY) / MIN },
];

const ALERT_TITLES: Record<AlertType, string> = {
  deviation: "Route deviation",
  stationary: "Vehicle stationary",
  traffic: "Heavy traffic",
  signal_lost: "Signal lost",
  arrival: "Arrived at destination",
};

const ALERT_SEVERITY: Record<AlertType, AlertSeverity> = {
  deviation: "critical",
  stationary: "warning",
  traffic: "warning",
  signal_lost: "critical",
  arrival: "info",
};

const ALERT_TEXT: Record<AlertType, (destination: string) => string> = {
  deviation: () => "has left the planned route (412 m off route)",
  stationary: () => "has not moved for 6 minutes",
  traffic: () => "is in heavy traffic, about 14 minutes slower than usual",
  signal_lost: () =>
    "has sent no location for 3 minutes. Last report: the app was sent to the background. Last battery reading: 11%.",
  arrival: (destination) => `has arrived at ${destination}`,
};

const toPlace = (place: SeedPlace) => ({
  name: place.name,
  address: place.address,
  location: { type: "Point" as const, coordinates: [place.lng, place.lat] },
});

// `count` positions from the start of the route up to `fraction` of the way along
function drivenPath(route: Position[], fraction: number, count: number): Position[] {
  const last = (route.length - 1) * fraction;
  const path: Position[] = [];
  for (let i = 0; i < count; i++) {
    const position = (last * i) / (count - 1);
    const index = Math.min(Math.floor(position), route.length - 2);
    const t = position - index;
    const [aLng, aLat] = route[index];
    const [bLng, bLat] = route[index + 1];
    path.push([aLng + (bLng - aLng) * t, aLat + (bLat - aLat) * t]);
  }
  return path;
}

async function routeFor(from: SeedPlace, to: SeedPlace): Promise<TripRoute> {
  try {
    return await planRoute([from.lng, from.lat], [to.lng, to.lat]);
  } catch (err) {
    console.warn(`[seed] no road route for ${from.name} -> ${to.name}: ${(err as Error).message}`);
    return {
      source: "straight_line",
      geometry: { type: "LineString", coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
    };
  }
}

interface SeedContext {
  manager: UserDocument;
  drivers: UserDocument[];
  vehicles: VehicleDocument[];
  now: number;
}

async function seedTrip(spec: TripSpec, ctx: SeedContext): Promise<void> {
  const from = PLACES[spec.from];
  const to = PLACES[spec.to];
  const driver = ctx.drivers[spec.driver];
  const vehicle = ctx.vehicles[spec.vehicle];
  const route = await routeFor(from, to);
  const coordinates = route.geometry?.coordinates ?? [];
  const durationMs = (route.durationSeconds ?? 40 * 60) * 1000;

  const createdAt = ctx.now - spec.createdMinutesAgo * MIN;
  const started = spec.status !== "pending" && spec.status !== "cancelled";
  const finished = spec.status === "arrived" || spec.status === "completed";
  const startedAt = createdAt + 20 * MIN;

  // How far along the route the vehicle got, and when it was last heard from
  const fraction = finished ? 1 : spec.scenario === "stationary" ? 0.55 : 0.4;
  const lastPingAt = finished ? startedAt + durationMs : ctx.now - 10 * 1000;
  const arrivedAt = finished ? lastPingAt : undefined;

  const path = started ? drivenPath(coordinates, fraction, 40) : [];
  if (spec.scenario === "deviated") {
    // The last few positions drift about 400 m north of the route
    for (let i = path.length - 5; i < path.length; i++) path[i] = [path[i][0], path[i][1] + 0.0037];
  }
  if (spec.scenario === "stationary") {
    // Parked for the last quarter of the pings
    for (let i = path.length - 10; i < path.length; i++) path[i] = path[path.length - 11];
  }

  const battery = (i: number): BatteryReading => ({
    level: Math.max(9, 88 - Math.floor(i * 1.2)),
    charging: false,
  });
  const pingTime = (i: number): Date =>
    new Date(startedAt + ((lastPingAt - startedAt) * i) / Math.max(1, path.length - 1));

  const flags: TripFlags = {
    ...CLEAR_FLAGS,
    deviated: spec.scenario === "deviated",
    stationary: spec.scenario === "stationary",
  };
  const lastIndex = path.length - 1;

  const trip = await Trip.create({
    manager: ctx.manager._id,
    driver: driver._id,
    vehicle: vehicle._id,
    reference: spec.reference,
    cargo: spec.cargo,
    notes: spec.notes,
    origin: toPlace(from),
    destination: toPlace(to),
    status: spec.status,
    route,
    flags,
    createdAt: new Date(createdAt),
    startedAt: started ? new Date(startedAt) : undefined,
    arrivedAt: arrivedAt ? new Date(arrivedAt) : undefined,
    completedAt: spec.status === "completed" ? new Date(lastPingAt + 6 * MIN) : undefined,
    cancelledAt: spec.status === "cancelled" ? new Date(createdAt + 50 * MIN) : undefined,
    eta:
      spec.status === "in_progress"
        ? new Date(ctx.now + durationMs * (1 - fraction))
        : arrivedAt
          ? new Date(arrivedAt)
          : undefined,
    lastLocation: started
      ? {
          location: { type: "Point", coordinates: path[lastIndex] },
          speed: spec.scenario === "stationary" || finished ? 0 : 11,
          heading: 140,
          accuracy: 8,
          recordedAt: pingTime(lastIndex),
        }
      : undefined,
    tracking: started
      ? { battery: battery(lastIndex), batteryAt: pingTime(lastIndex), lastSeenAt: pingTime(lastIndex) }
      : undefined,
  });

  if (path.length) {
    await LocationPing.insertMany(
      path.map((position, i) => ({
        trip: trip._id,
        driver: driver._id,
        location: { type: "Point", coordinates: position },
        speed: spec.scenario === "stationary" && i >= path.length - 10 ? 0 : 11,
        heading: 140,
        accuracy: 8,
        battery: battery(i),
        recordedAt: pingTime(i),
      })),
    );
    // The driver checked another app early in the trip
    await TrackingEvent.insertMany([
      { trip: trip._id, driver: driver._id, type: "backgrounded", battery: battery(5), recordedAt: pingTime(5) },
      { trip: trip._id, driver: driver._id, type: "resumed", battery: battery(6), recordedAt: pingTime(6) },
    ]);
  }

  // Alerts: what is happening now, what happened on the way, and the arrival
  const alerts: Array<{ type: AlertType; at: Date; position?: Position; read: boolean }> = [];
  if (spec.scenario === "deviated") {
    alerts.push({ type: "deviation", at: pingTime(lastIndex - 3), position: path[lastIndex - 3], read: false });
  }
  if (spec.scenario === "stationary") {
    alerts.push({ type: "stationary", at: pingTime(lastIndex - 2), position: path[lastIndex], read: false });
    alerts.push({ type: "traffic", at: pingTime(lastIndex - 12), position: path[lastIndex - 12], read: true });
  }
  (spec.history ?? []).forEach((type, i) => {
    const index = 12 + i * 10;
    alerts.push({ type, at: pingTime(index), position: path[index], read: true });
  });
  if (finished) {
    alerts.push({
      type: "arrival",
      at: new Date(lastPingAt),
      position: path[lastIndex],
      read: spec.status === "completed",
    });
  }

  if (alerts.length) {
    await Alert.insertMany(
      alerts.map((alert) => ({
        manager: ctx.manager._id,
        trip: trip._id,
        driver: driver._id,
        vehicle: vehicle._id,
        type: alert.type,
        severity: ALERT_SEVERITY[alert.type],
        title: ALERT_TITLES[alert.type],
        message: `${driver.name} (${vehicle.plateNumber}) ${ALERT_TEXT[alert.type](to.name)}`,
        location: alert.position ? { type: "Point", coordinates: alert.position } : undefined,
        readAt: alert.read ? new Date(alert.at.getTime() + 4 * MIN) : undefined,
        createdAt: alert.at,
        updatedAt: alert.at,
      })),
    );
  }
}

async function removeSeed(managerId: Types.ObjectId): Promise<void> {
  const trips = await Trip.find({ manager: managerId }).select("_id").lean();
  const tripIds = trips.map((trip) => trip._id);
  await Promise.all([
    LocationPing.deleteMany({ trip: { $in: tripIds } }),
    TrackingEvent.deleteMany({ trip: { $in: tripIds } }),
    Alert.deleteMany({ manager: managerId }),
    Trip.deleteMany({ manager: managerId }),
    Vehicle.deleteMany({ manager: managerId }),
    User.deleteMany({ manager: managerId }),
  ]);
  await User.deleteOne({ _id: managerId });
}

export interface SeedResult {
  created: boolean;
  drivers: number;
  vehicles: number;
  trips: number;
}

// Only ever touches the seed manager and what belongs to them
export async function seedDatabase({ reset = false } = {}): Promise<SeedResult> {
  const existing = await User.findOne({ email: SEED_MANAGER.email });
  if (existing) {
    if (!reset) return { created: false, drivers: 0, vehicles: 0, trips: 0 };
    await removeSeed(existing._id);
  }

  const manager = await User.create({ ...SEED_MANAGER, password: SEED_PASSWORD, role: "manager" });
  const drivers: UserDocument[] = [];
  for (const driver of DRIVERS) {
    drivers.push(
      await User.create({ ...driver, password: SEED_PASSWORD, role: "driver", manager: manager._id }),
    );
  }
  const vehicles: VehicleDocument[] = [];
  for (const vehicle of VEHICLES) {
    vehicles.push(await Vehicle.create({ ...vehicle, manager: manager._id }));
  }

  const ctx: SeedContext = { manager, drivers, vehicles, now: Date.now() };
  for (const spec of TRIPS) await seedTrip(spec, ctx);

  return { created: true, drivers: drivers.length, vehicles: vehicles.length, trips: TRIPS.length };
}

export const SEED_DRIVER_EMAILS = DRIVERS.map((driver) => driver.email);
