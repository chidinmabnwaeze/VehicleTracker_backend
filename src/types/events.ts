// The Socket.IO contract. This file imports nothing, so the frontend can
// copy it as is and type its own socket with the same event maps.
// Timestamps are ISO strings, distances are meters, speed is meters per second.

export type UserRole = "manager" | "driver";
export type TripStatus = "pending" | "in_progress" | "arrived" | "completed" | "cancelled";
export type AlertType = "deviation" | "stationary" | "traffic" | "signal_lost" | "arrival";
export type AlertSeverity = "info" | "warning" | "critical";

export interface TripFlags {
  deviated: boolean;
  stationary: boolean;
  traffic: boolean;
  signalLost: boolean;
}

// Driver -> server
export interface LocationUpdatePayload {
  tripId: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  accuracy?: number;
  timestamp?: string | number;
}

export interface LocationResult {
  status: TripStatus;
  flags: TripFlags;
  // true when the ping was older than one already processed
  outOfOrder?: boolean;
}

export type LocationAck = ({ ok: true } & LocationResult) | { ok: false; error: string };

// Server -> manager
export interface TripLocationEvent {
  tripId: string;
  driverId: string;
  vehicleId: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  recordedAt: string;
  flags: TripFlags;
  distanceFromRouteMeters: number | null;
  distanceToDestinationMeters: number;
}

// Server -> manager and driver
export interface TripStatusEvent {
  tripId: string;
  status: TripStatus;
  at: string;
  eta: string | null;
}

// Server -> manager and driver. The route fields are present after a traffic check.
export interface TripUpdateEvent {
  tripId: string;
  flags: TripFlags;
  eta?: string;
  remainingDistanceMeters?: number;
  remainingDurationSeconds?: number;
  trafficDelaySeconds?: number;
}

// Server -> manager
export interface AlertEvent {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  trip: string;
  driver: string;
  vehicle: string;
  // GeoJSON point, coordinates are [lng, lat]
  location: { type: "Point"; coordinates: number[] } | null;
  meta: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface ServerToClientEvents {
  "trip:location": (event: TripLocationEvent) => void;
  "trip:status": (event: TripStatusEvent) => void;
  "trip:update": (event: TripUpdateEvent) => void;
  "alert:new": (alert: AlertEvent) => void;
}

export interface ClientToServerEvents {
  "location:update": (payload: LocationUpdatePayload, ack?: (reply: LocationAck) => void) => void;
}
