import type { Request, Response } from "express";
import { signToken } from "../middleware/auth";
import { User } from "../models/User";
import { ApiError } from "../utils/ApiError";
import { requireString } from "../utils/validate";

// Public sign up creates a manager. Drivers are created by their manager.
export async function register(req: Request, res: Response): Promise<void> {
  const { name, email, password, phone } = req.body || {};
  const user = await User.create({ name, email, password, phone, role: "manager" });
  res.status(201).json({ data: { user, token: signToken(user) } });
}

export async function login(req: Request, res: Response): Promise<void> {
  const email = requireString(req.body?.email, "email").toLowerCase();
  const password = requireString(req.body?.password, "password");

  const user = await User.findOne({ email }).select("+password");
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, "Incorrect email or password");
  }
  if (!user.isActive) throw new ApiError(403, "This account has been disabled");

  res.json({ data: { user, token: signToken(user) } });
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json({ data: req.user });
}

// Registers a device for push notifications
export async function addFcmToken(req: Request, res: Response): Promise<void> {
  const token = requireString(req.body?.token, "token");
  await User.updateOne({ _id: req.user._id }, { $addToSet: { fcmTokens: token } });
  res.status(204).end();
}

export async function removeFcmToken(req: Request, res: Response): Promise<void> {
  const token = requireString(req.body?.token, "token");
  await User.updateOne({ _id: req.user._id }, { $pull: { fcmTokens: token } });
  res.status(204).end();
}
