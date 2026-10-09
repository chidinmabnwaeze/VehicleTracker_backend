import { Schema, model, type Types } from "mongoose";
import type { AlertSeverity, AlertType } from "../types/events";
import { pointSchema, type GeoPoint } from "./point.schema";

export const ALERT_TYPES: AlertType[] = [
  "deviation",
  "stationary",
  "traffic",
  "signal_lost",
  "arrival",
  "driver_message",
];

export interface IAlert {
  manager: Types.ObjectId;
  trip: Types.ObjectId;
  driver: Types.ObjectId;
  vehicle: Types.ObjectId;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  // Where the vehicle was when the alert was raised
  location?: GeoPoint;
  meta?: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const alertSchema = new Schema<IAlert>(
  {
    manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
    trip: { type: Schema.Types.ObjectId, ref: "Trip", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: { type: String, enum: ["info", "warning", "critical"], default: "warning" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    location: pointSchema,
    meta: Schema.Types.Mixed,
    readAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } },
);

alertSchema.index({ manager: 1, createdAt: -1 });
alertSchema.index({ trip: 1, createdAt: -1 });

export const Alert = model<IAlert>("Alert", alertSchema);
