import { Schema, model, type HydratedDocument, type Types } from "mongoose";

export interface IVehicle {
  manager: Types.ObjectId;
  plateNumber: string;
  make?: string;
  // not "model": that name clashes with mongoose document internals
  vehicleModel?: string;
  type?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type VehicleDocument = HydratedDocument<IVehicle>;

const vehicleSchema = new Schema<IVehicle>(
  {
    manager: { type: Schema.Types.ObjectId, ref: "User", required: true },
    plateNumber: { type: String, required: true, uppercase: true, trim: true },
    make: { type: String, trim: true },
    vehicleModel: { type: String, trim: true },
    type: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true, versionKey: false } },
);

vehicleSchema.index({ manager: 1, plateNumber: 1 }, { unique: true });

export const Vehicle = model<IVehicle>("Vehicle", vehicleSchema);
