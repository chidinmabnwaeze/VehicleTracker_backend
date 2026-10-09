import type { Request, Response } from "express";
import { Trip } from "../models/Trip";
import { User } from "../models/User";

// The numbers on the manager's overview cards
export async function getStats(req: Request, res: Response): Promise<void> {
  const manager = req.user._id;
  const [totalRiders, routeDeviations, activeDeliveries, totalDeliveries] = await Promise.all([
    User.countDocuments({ role: "driver", manager, isActive: true }),
    // Trips that are off their planned route right now
    Trip.countDocuments({ manager, status: "in_progress", "flags.deviated": true }),
    Trip.countDocuments({ manager, status: { $in: ["in_progress", "arrived"] } }),
    Trip.countDocuments({ manager, status: "completed" }),
  ]);
  res.json({ data: { totalRiders, routeDeviations, activeDeliveries, totalDeliveries } });
}
