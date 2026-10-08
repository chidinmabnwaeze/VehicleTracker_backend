import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";
import { User, type UserDocument } from "../models/User";
import type { UserRole } from "../types/events";
import { ApiError } from "../utils/ApiError";

export const signToken = (user: UserDocument): string =>
  jwt.sign({ sub: user.id, role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"],
  });

// Shared by the HTTP middleware and the socket handshake
export async function userFromToken(token: string | null | undefined): Promise<UserDocument> {
  if (!token) throw new ApiError(401, "Authentication required");
  let userId: string | undefined;
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    userId = typeof payload === "string" ? undefined : payload.sub;
  } catch {
    throw new ApiError(401, "Invalid or expired token");
  }
  const user = userId ? await User.findById(userId) : null;
  if (!user || !user.isActive) throw new ApiError(401, "Account not found or disabled");
  return user;
}

export function bearerToken(header: string | undefined): string | null {
  return header && header.startsWith("Bearer ") ? header.slice(7) : null;
}

export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.user = await userFromToken(bearerToken(req.headers.authorization));
  next();
}

export const authorize =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, "You do not have permission to do this");
    }
    next();
  };
