// The Socket.IO contract. This file imports nothing, so the frontend can
// copy it as is and type its own socket with the same event maps.
// Timestamps are ISO strings, distances are meters, speed is meters per second.

export type UserRole = "manager" | "driver";
export type TripStatus = "pending" | "in_progress" | "arrived" | "completed" | "cancelled";
export type AlertType =
  | "deviation"
  | "stationary"
  | "traffic"
  | "signal_lost"
  | "arrival"
  // A message the driver sent to their manager from the trip screen
  | "driver_message";
export type DeliveryType = "Parcel" | "Cargo";
// Whether pickup and drop-off are in the same state
export type DeliveryRange = "Intra-State" | "Inter-State";
export type AlertSeverity = "info" | "warning" | "critical";

// The driver's phone battery. Browsers without the Battery API (iOS, Firefox)
// cannot report it, so it is null or absent wherever it appears.
export interface BatteryReading {
  // 0 to 100
  level: number;
  charging: boolean;
}

// Why tracking was interrupted or resumed, as far as the driver's browser can tell
export type TrackingEventType =
  | "backgrounded"
  | "resumed"
  | "offline"
  | "online"
  | "location-denied"
  | "location-unavailable";

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
  battery?: BatteryReading | null;
  timestamp?: string | number;
}

// Driver -> server, when the app is backgrounded, goes offline or loses location
export interface TrackingEventPayload {
  tripId: string;
  type: TrackingEventType;
  battery?: BatteryReading | null;
  timestamp?: string | number;
}

export type TrackingEventAck = { ok: true } | { ok: false; error: string };

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
  battery: BatteryReading | null;
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

// Server -> manager, relaying what the driver's phone reported
export interface TripTrackingEvent {
  tripId: string;
  type: TrackingEventType;
  battery: BatteryReading | null;
  recordedAt: string;
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
  "trip:tracking": (event: TripTrackingEvent) => void;
  "alert:new": (alert: AlertEvent) => void;
}

export interface ClientToServerEvents {
  "location:update": (payload: LocationUpdatePayload, ack?: (reply: LocationAck) => void) => void;
  "tracking:event": (
    payload: TrackingEventPayload,
    ack?: (reply: TrackingEventAck) => void,
  ) => void;
}
