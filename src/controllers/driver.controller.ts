import type { Request, Response } from "express";
import { Trip } from "../models/Trip";
import { User, type UserDocument } from "../models/User";
import { Vehicle } from "../models/Vehicle";
import { ApiError } from "../utils/ApiError";
import { pagination, requireObjectId } from "../utils/validate";

const EDITABLE = ["name", "phone", "password", "isActive"] as const;

const VEHICLE = { path: "vehicle", select: "plateNumber make vehicleModel type" };

// A driver uses one vehicle, and a vehicle belongs to one driver
async function assignableVehicleId(
  req: Request,
  value: unknown,
  driverId?: UserDocument["_id"],
): Promise<string> {
  const vehicleId = requireObjectId(value, "vehicleId");
  const vehicle = await Vehicle.exists({ _id: vehicleId, manager: req.user._id, isActive: true });
  if (!vehicle) throw new ApiError(404, "Vehicle not found or inactive");
  const taken = await User.exists({
    role: "driver",
    vehicle: vehicleId,
    isActive: true,
    _id: { $ne: driverId },
  });
  if (taken) throw new ApiError(409, "This vehicle is already assigned to another driver");
  return vehicleId;
}

async function findDriver(req: Request): Promise<UserDocument> {
  const id = requireObjectId(req.params.id, "driver id");
  const driver = await User.findOne({ _id: id, role: "driver", manager: req.user._id });
  if (!driver) throw new ApiError(404, "Driver not found");
  return driver;
}

export async function createDriver(req: Request, res: Response): Promise<void> {
  const { name, email, password, phone, vehicleId } = req.body || {};
  const driver = await User.create({
    name,
    email,
    password,
    phone,
    role: "driver",
    manager: req.user._id,
    vehicle: vehicleId ? await assignableVehicleId(req, vehicleId) : undefined,
  });
  res.status(201).json({ data: await driver.populate(VEHICLE) });
}

export async function listDrivers(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { role: "driver", manager: req.user._id };
  if (req.query.active !== undefined) filter.isActive = req.query.active === "true";
  // Drivers who can be given a trip now: active, with a vehicle, not out on one
  if (req.query.available === "true") {
    const busy = await Trip.distinct("driver", {
      manager: req.user._id,
      status: { $in: ["in_progress", "arrived"] },
    });
    filter.isActive = true;
    filter.vehicle = { $ne: null };
    filter._id = { $nin: busy };
  }

  const [drivers, total] = await Promise.all([
    User.find(filter).populate(VEHICLE).sort({ name: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ data: drivers, meta: { page, limit, total } });
}

export async function getDriver(req: Request, res: Response): Promise<void> {
  res.json({ data: await (await findDriver(req)).populate(VEHICLE) });
}

export async function updateDriver(req: Request, res: Response): Promise<void> {
  const driver = await findDriver(req);
  const body = req.body || {};
  for (const field of EDITABLE) {
    if (body[field] !== undefined) driver.set(field, body[field]);
  }
  // null takes the vehicle away
  if (body.vehicleId !== undefined) {
    driver.set(
      "vehicle",
      body.vehicleId ? await assignableVehicleId(req, body.vehicleId, driver._id) : undefined,
    );
  }
  await driver.save();
  res.json({ data: await driver.populate(VEHICLE) });
}

// Drivers are deactivated rather than deleted so past trips keep their driver
export async function deactivateDriver(req: Request, res: Response): Promise<void> {
  const driver = await findDriver(req);
  const busy = await Trip.exists({ driver: driver._id, status: "in_progress" });
  if (busy) throw new ApiError(409, "Driver has a trip in progress");
  driver.isActive = false;
  await driver.save();
  res.json({ data: driver });
}
