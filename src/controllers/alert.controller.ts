import type { Request, Response } from "express";
import { ALERT_TYPES, Alert } from "../models/Alert";
import type { AlertType } from "../types/events";
import { ApiError } from "../utils/ApiError";
import { pagination, requireObjectId } from "../utils/validate";

export async function listAlerts(req: Request, res: Response): Promise<void> {
  const { page, limit, skip } = pagination(req.query);
  const filter: Record<string, unknown> = { manager: req.user._id };

  if (req.query.tripId) filter.trip = requireObjectId(req.query.tripId, "tripId");
  if (req.query.type) {
    const types = String(req.query.type).split(",");
    const unknown = types.find((type) => !ALERT_TYPES.includes(type as AlertType));
    if (unknown) throw new ApiError(400, `Unknown alert type: ${unknown}`);
    filter.type = { $in: types };
  }
  if (req.query.unread === "true") filter.readAt = null;

  const [alerts, total, unread] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Alert.countDocuments(filter),
    Alert.countDocuments({ manager: req.user._id, readAt: null }),
  ]);
  res.json({ data: alerts, meta: { page, limit, total, unread } });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const id = requireObjectId(req.params.id, "alert id");
  const alert = await Alert.findOne({ _id: id, manager: req.user._id });
  if (!alert) throw new ApiError(404, "Alert not found");
  if (!alert.readAt) {
    alert.readAt = new Date();
    await alert.save();
  }
  res.json({ data: alert });
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  const filter: Record<string, unknown> = { manager: req.user._id, readAt: null };
  if (req.query.tripId) filter.trip = requireObjectId(req.query.tripId, "tripId");
  const result = await Alert.updateMany(filter, { $set: { readAt: new Date() } });
  res.json({ data: { updated: result.modifiedCount } });
}
