import type { Request } from "express";
import { isValidObjectId } from "mongoose";
import { ApiError } from "./ApiError";
import type { Position } from "./geo";

export function requireObjectId(value: unknown, label: string): string {
  if (!value || !isValidObjectId(value)) {
    throw new ApiError(400, `${label} must be a valid id`);
  }
  return String(value);
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, `${label} is required`);
  }
  return value.trim();
}

// Reads { lat, lng } and returns GeoJSON order [lng, lat]
export function parseLatLng(input: unknown, label: string): Position {
  const source = (input ?? {}) as { lat?: unknown; lng?: unknown };
  const read = (value: unknown): number => (value == null || value === "" ? NaN : Number(value));
  const lat = read(source.lat);
  const lng = read(source.lng);
  if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) {
    throw new ApiError(400, `${label} needs a valid lat (-90 to 90) and lng (-180 to 180)`);
  }
  return [lng, lat];
}

export function optionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function pagination(query: Request["query"]): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(String(query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
