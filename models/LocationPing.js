const { Schema, model } = require("mongoose");
const pointSchema = require("./point.schema");

const locationPingSchema = new Schema(
  {
    trip: { type: Schema.Types.ObjectId, ref: "Trip", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    location: { type: pointSchema, required: true },
    speed: Number, // meters per second
    heading: Number, // degrees from north
    accuracy: Number, // meters
    recordedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

locationPingSchema.index({ trip: 1, recordedAt: 1 });

module.exports = model("LocationPing", locationPingSchema);
