import type { Request, Response } from "express";
import { Trip } from "../models/Trip";
import { User, type UserDocument } from "../models/User";
import { ApiError } from "../utils/ApiError";
import { pagination, requireObjectId } from "../utils/validate";

const EDITABLE = ["name", "phone", "password", "isActive"] as const;

async function findDriver(req: Request): Promise<UserDocument> {
  const id = requireObjectId(req.params.id, "driver id");
  const driver = await User.findOne({ _id: id, role: "driver", manager: req.user._id });
  if (!driver) throw new ApiError(404, "Driver not found");
  return driver;
}

export async function createDriver(req: Request, res: Response): Promise<void> {
  const { name, email, password, phone } = req.body || {};
  const driver = await User.create({
    name,
    email,
    password,
    phone,
    role: "driver",
    manager: req.user._id,
  });
  res.status(201).json({ data: driver });
}

export async function listDrivers(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { role: "driver", manager: req.user._id };
  if (req.query.active !== undefined) filter.isActive = req.query.active === "true";

  const [drivers, total] = await Promise.all([
    User.find(filter).sort({ name: 1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  res.json({ data: drivers, meta: { page, limit, total } });
}

export async function getDriver(req: Request, res: Response): Promise<void> {
  res.json({ data: await findDriver(req) });
}

export async function updateDriver(req: Request, res: Response): Promise<void> {
  const driver = await findDriver(req);
  const body = req.body || {};
  for (const field of EDITABLE) {
    if (body[field] !== undefined) driver.set(field, body[field]);
  }
  await driver.save();
  res.json({ data: driver });
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
