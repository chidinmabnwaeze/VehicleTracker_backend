import type { Request, Response } from "express";
import { Trip } from "../models/Trip";
import { Vehicle, type VehicleDocument } from "../models/Vehicle";
import { ApiError } from "../utils/ApiError";
import { pagination, requireObjectId } from "../utils/validate";

const EDITABLE = ["plateNumber", "make", "vehicleModel", "type", "isActive"] as const;

async function findVehicle(req: Request): Promise<VehicleDocument> {
  const id = requireObjectId(req.params.id, "vehicle id");
  const vehicle = await Vehicle.findOne({ _id: id, manager: req.user._id });
  if (!vehicle) throw new ApiError(404, "Vehicle not found");
  return vehicle;
}

export async function createVehicle(req: Request, res: Response): Promise<void> {
  const { plateNumber, make, vehicleModel, type } = req.body || {};
  const vehicle = await Vehicle.create({
    manager: req.user._id,
    plateNumber,
    make,
    vehicleModel,
    type,
  });
  res.status(201).json({ data: vehicle });
}

export async function listVehicles(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { manager: req.user._id };
  if (req.query.active !== undefined) filter.isActive = req.query.active === "true";

  const [vehicles, total] = await Promise.all([
    Vehicle.find(filter).sort({ plateNumber: 1 }).skip(skip).limit(limit),
    Vehicle.countDocuments(filter),
  ]);
  res.json({ data: vehicles, meta: { page, limit, total } });
}

export async function getVehicle(req: Request, res: Response): Promise<void> {
  res.json({ data: await findVehicle(req) });
}

export async function updateVehicle(req: Request, res: Response): Promise<void> {
  const vehicle = await findVehicle(req);
  const body = req.body || {};
  for (const field of EDITABLE) {
    if (body[field] !== undefined) vehicle.set(field, body[field]);
  }
  await vehicle.save();
  res.json({ data: vehicle });
}

// Vehicles are deactivated rather than deleted so past trips keep their vehicle
export async function deactivateVehicle(req: Request, res: Response): Promise<void> {
  const vehicle = await findVehicle(req);
  const busy = await Trip.exists({ vehicle: vehicle._id, status: "in_progress" });
  if (busy) throw new ApiError(409, "Vehicle has a trip in progress");
  vehicle.isActive = false;
  await vehicle.save();
  res.json({ data: vehicle });
}
