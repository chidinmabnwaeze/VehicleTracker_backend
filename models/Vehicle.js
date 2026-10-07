const { Schema, model } = require("mongoose");

const vehicleSchema = new Schema(
  {
    manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
    plateNumber: { type: String, required: true, uppercase: true, trim: true },
    make: { type: String, trim: true },
    // not "model": that name clashes with mongoose document internals
    vehicleModel: { type: String, trim: true },
    type: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } },
);

vehicleSchema.index({ manager: 1, plateNumber: 1 }, { unique: true });

module.exports = model("Vehicle", vehicleSchema);
