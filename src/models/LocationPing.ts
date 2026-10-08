import { Schema, model, type Types } from "mongoose";
import type { BatteryReading } from "../types/events";
import { pointSchema, type GeoPoint } from "./point.schema";
import { batterySchema } from "./TrackingEvent";

export interface ILocationPing {
  trip: Types.ObjectId;
  driver: Types.ObjectId;
  location: GeoPoint;
  speed?: number; // meters per second
  heading?: number; // degrees from north
  accuracy?: number; // meters
  battery?: BatteryReading;
  recordedAt: Date;
  createdAt: Date;
}

const locationPingSchema = new Schema<ILocationPing>(
  {
    trip: { type: Schema.Types.ObjectId, ref: "Trip", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    location: { type: pointSchema, required: true },
    speed: Number,
    heading: Number,
    accuracy: Number,
    battery: batterySchema,
    recordedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

locationPingSchema.index({ trip: 1, recordedAt: 1 });

export const LocationPing = model<ILocationPing>("LocationPing", locationPingSchema);
