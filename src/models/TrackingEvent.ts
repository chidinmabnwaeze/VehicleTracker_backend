import { Schema, model, type Types } from "mongoose";
import type { BatteryReading, TrackingEventType } from "../types/events";

export const TRACKING_EVENT_TYPES: TrackingEventType[] = [
  "backgrounded",
  "resumed",
  "offline",
  "online",
  "location-denied",
  "location-unavailable",
];

export const batterySchema = new Schema<BatteryReading>(
  {
    level: { type: Number, required: true, min: 0, max: 100 },
    charging: { type: Boolean, required: true },
  },
  { _id: false },
);

// What the driver's phone reported about its own tracking, kept so a manager
// can see why a trip went quiet
export interface ITrackingEvent {
  trip: Types.ObjectId;
  driver: Types.ObjectId;
  type: TrackingEventType;
  battery?: BatteryReading;
  recordedAt: Date;
  createdAt: Date;
}

const trackingEventSchema = new Schema<ITrackingEvent>(
  {
    trip: { type: Schema.Types.ObjectId, ref: "Trip", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: TRACKING_EVENT_TYPES, required: true },
    battery: batterySchema,
    recordedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

trackingEventSchema.index({ trip: 1, recordedAt: 1 });

export const TrackingEvent = model<ITrackingEvent>("TrackingEvent", trackingEventSchema);
