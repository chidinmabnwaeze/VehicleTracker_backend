import { Schema } from "mongoose";
import type { Position } from "../utils/geo";

export interface GeoPoint {
  type: "Point";
  coordinates: Position;
}

export const pointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) => value.length === 2,
        message: "coordinates must be [lng, lat]",
      },
    },
  },
  { _id: false },
);
