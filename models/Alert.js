const { Schema, model } = require("mongoose");
const pointSchema = require("./point.schema");

const ALERT_TYPES = ["deviation", "stationary", "traffic", "signal_lost", "arrival"];

const alertSchema = new Schema(
  {
    manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
    trip: { type: Schema.Types.ObjectId, ref: "Trip", required: true },
    driver: { type: Schema.Types.ObjectId, ref: "User", required: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle", required: true },
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: {
      type: String,
      enum: ["info", "warning", "critical"],
      default: "warning",
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    // Where the vehicle was when the alert was raised
    location: pointSchema,
    meta: Schema.Types.Mixed,
    readAt: Date,
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } },
);

alertSchema.index({ manager: 1, createdAt: -1 });
alertSchema.index({ trip: 1, createdAt: -1 });

module.exports = model("Alert", alertSchema);
module.exports.ALERT_TYPES = ALERT_TYPES;
