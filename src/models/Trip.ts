import { Schema, model, type HydratedDocument, type Types } from "mongoose";
import type {
  BatteryReading,
  DeliveryRange,
  DeliveryType,
  TrackingEventType,
  TripFlags,
  TripStatus,
} from "../types/events";
import type { Position } from "../utils/geo";
import { pointSchema, type GeoPoint } from "./point.schema";
import { TRACKING_EVENT_TYPES, batterySchema } from "./TrackingEvent";

export const TRIP_STATUSES: TripStatus[] = [
  "pending",
  "in_progress",
  "arrived",
  "completed",
  "cancelled",
];

export const CLEAR_FLAGS: TripFlags = {
  deviated: false,
  stationary: false,
  traffic: false,
  signalLost: false,
};

export interface Place {
  name?: string;
  address?: string;
  // State or region, filled in by geocoding. Used to tell intra from inter-state.
  region?: string;
  location: GeoPoint;
}

export const DELIVERY_TYPES: DeliveryType[] = ["Parcel", "Cargo"];

// What is being delivered, as entered on the order form
export interface TripPackage {
  name?: string;
  deliveryType?: DeliveryType;
  category?: string;
  description?: string;
}

// Planned route the driver is expected to follow
export interface TripRoute {
  source?: "mapbox" | "straight_line";
  geometry?: { type: "LineString"; coordinates: Position[] };
  distanceMeters?: number;
  durationSeconds?: number;
}

export interface LastLocation {
  location: GeoPoint;
  speed?: number;
  heading?: number;
  accuracy?: number;
  recordedAt: Date;
}

// Latest state of the driver's phone, so a manager can judge why a trip went quiet
export interface DeviceTracking {
  battery?: BatteryReading;
  batteryAt?: Date;
  // When the last location ping arrived
  lastSeenAt?: Date;
  lastEvent?: { type: TrackingEventType; recordedAt: Date };
}

export interface ITrip {
  manager: Types.ObjectId;
  // An order is created first and a driver assigned after, so a pending trip
  // can be without one. The vehicle is the assigned driver's vehicle.
  driver?: Types.ObjectId;
  vehicle?: Types.ObjectId;
  // The tracking number shown to users, e.g. LKH-482-913. Generated when not given.
  reference?: string;
  cargo?: string;
  notes?: string;
  package?: TripPackage;
  range?: DeliveryRange;
  origin: Place;
  destination: Place;
  status: TripStatus;
  route?: TripRoute;
  lastLocation?: LastLocation;
  tracking?: DeviceTracking;
  eta?: Date;
  flags: TripFlags;
  startedAt?: Date;
  // When the driver marked the package as picked up
  pickedUpAt?: Date;
  arrivedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type TripDocument = HydratedDocument<ITrip>;

const placeSchema = new Schema<Place>(
  {
    name: { type: String, trim: true },
    address: { type: String, trim: true },
    region: { type: String, trim: true },
    location: { type: pointSchema, required: true },
  },
  { _id: false },
);

const tripSchema = new Schema<ITrip>(
  {
    manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User" },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    reference: { type: String, trim: true, uppercase: true },
    cargo: { type: String, trim: true },
    notes: { type: String, trim: true },
    package: {
      name: { type: String, trim: true },
      deliveryType: { type: String, enum: DELIVERY_TYPES },
      category: { type: String, trim: true },
      description: { type: String, trim: true },
    },
    range: { type: String, enum: ["Intra-State", "Inter-State"] },
    origin: { type: placeSchema, required: true },
    destination: { type: placeSchema, required: true },
    status: { type: String, enum: TRIP_STATUSES, default: "pending" },
    route: {
      source: { type: String, enum: ["mapbox", "straight_line"] },
      geometry: {
        type: { type: String, enum: ["LineString"] },
        coordinates: { type: [[Number]], default: undefined },
      },
      distanceMeters: Number,
      durationSeconds: Number,
    },
    lastLocation: {
      location: pointSchema,
      speed: Number,
      heading: Number,
      accuracy: Number,
      recordedAt: Date,
    },
    tracking: {
      battery: batterySchema,
      batteryAt: Date,
      lastSeenAt: Date,
      lastEvent: {
        type: { type: String, enum: TRACKING_EVENT_TYPES },
        recordedAt: Date,
      },
    },
    eta: Date,
    flags: {
      deviated: { type: Boolean, default: false },
      stationary: { type: Boolean, default: false },
      traffic: { type: Boolean, default: false },
      signalLost: { type: Boolean, default: false },
    },
    startedAt: Date,
    pickedUpAt: Date,
    arrivedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } },
);

tripSchema.index({ manager: 1, status: 1, createdAt: -1 });
tripSchema.index({ driver: 1, status: 1 });
tripSchema.index({ manager: 1, reference: 1 });

export const Trip = model<ITrip>("Trip", tripSchema);
