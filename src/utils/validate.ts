import type { Request } from "express";
import { isValidObjectId } from "mongoose";
import type { BatteryReading } from "../types/events";
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

// Reads { lat, lng } (or latitude / longitude, as the browser Geolocation API
// names them) and returns GeoJSON order [lng, lat]
export function parseLatLng(input: unknown, label: string): Position {
  const source = (input ?? {}) as Record<string, unknown>;
  const read = (value: unknown): number => (value == null || value === "" ? NaN : Number(value));
  const lat = read(source.lat ?? source.latitude);
  const lng = read(source.lng ?? source.longitude);
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

// Reads { level, charging }. Anything unusable is treated as "not reported",
// which is what browsers without the Battery API (iOS, Firefox) send.
export function parseBattery(input: unknown): BatteryReading | undefined {
  if (!input || typeof input !== "object") return undefined;
  const source = input as Record<string, unknown>;
  const level = optionalNumber(source.level);
  if (level === undefined || level < 0 || level > 100) return undefined;
  return { level: Math.round(level), charging: source.charging === true };
}

// A client timestamp, defaulting to now
export function parseRecordedAt(input: unknown): Date {
  if (input == null || input === "") return new Date();
  const recordedAt = new Date(input as string | number);
  if (Number.isNaN(recordedAt.getTime())) {
    throw new ApiError(400, "timestamp must be a valid date");
  }
  // A device clock running ahead should not put records in the future
  return recordedAt.getTime() > Date.now() + 60_000 ? new Date() : recordedAt;
}

export function pagination(query: Request["query"]): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(String(query.page), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}
