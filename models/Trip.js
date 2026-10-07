const { Schema, model } = require("mongoose");
const pointSchema = require("./point.schema");

const placeSchema = new Schema(
  {
    name: { type: String, trim: true },
    address: { type: String, trim: true },
    location: { type: pointSchema, required: true },
  },
  { _id: false },
);

const tripSchema = new Schema(
  {
    manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    reference: { type: String, trim: true },
    cargo: { type: String, trim: true },
    notes: { type: String, trim: true },
    origin: { type: placeSchema, required: true },
    destination: { type: placeSchema, required: true },
    status: {
      type: String,
      enum: ["pending", "in_progress", "arrived", "completed", "cancelled"],
      default: "pending",
    },
    // Planned route the driver is expected to follow
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
    eta: Date,
    flags: {
      deviated: { type: Boolean, default: false },
      stationary: { type: Boolean, default: false },
      traffic: { type: Boolean, default: false },
      signalLost: { type: Boolean, default: false },
    },
    startedAt: Date,
    arrivedAt: Date,
    completedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } },
);

tripSchema.index({ manager: 1, status: 1, createdAt: -1 });
tripSchema.index({ driver: 1, status: 1 });

module.exports = model("Trip", tripSchema);
