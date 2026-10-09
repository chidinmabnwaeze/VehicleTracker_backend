import { Alert } from "../models/Alert";
import type { TripDocument } from "../models/Trip";
import { User } from "../models/User";
import { Vehicle } from "../models/Vehicle";
import type { AlertEvent, AlertSeverity, AlertType } from "../types/events";
import type { Position } from "../utils/geo";
import { sendPush } from "./notification.service";
import * as realtime from "./realtime.service";

const TITLES: Record<AlertType, string> = {
  deviation: "Route deviation",
  stationary: "Vehicle stationary",
  traffic: "Heavy traffic",
  signal_lost: "Signal lost",
  arrival: "Arrived at destination",
  driver_message: "New message",
};

export interface AlertInput {
  type: AlertType;
  severity: AlertSeverity;
  // Continues the sentence after the driver and vehicle, e.g.
  // "John Doe (ABC-123) " + "has left the planned route"
  text: string;
  coordinates?: Position;
  meta?: Record<string, unknown>;
  // Replaces the default title for the alert type
  title?: string;
  // Use text as the whole message, without the driver and vehicle prefix
  verbatim?: boolean;
}

export async function createAlert(
  trip: TripDocument,
  { type, severity, text, coordinates, meta, title, verbatim }: AlertInput,
): Promise<void> {
  // Alerts are about a driver on a trip; an unassigned order has neither
  if (!trip.driver || !trip.vehicle) return;
  const [driver, vehicle] = await Promise.all([
    User.findById(trip.driver).select("name"),
    Vehicle.findById(trip.vehicle).select("plateNumber"),
  ]);
  const who = `${driver ? driver.name : "Driver"} (${vehicle ? vehicle.plateNumber : "vehicle"})`;

  const alert = await Alert.create({
    manager: trip.manager,
    trip: trip._id,
    driver: trip.driver,
    vehicle: trip.vehicle,
    type,
    severity,
    title: title || TITLES[type],
    message: verbatim ? text : `${who} ${text}`,
    location: coordinates ? { type: "Point", coordinates } : undefined,
    meta,
  });

  const event: AlertEvent = {
    id: String(alert._id),
    type,
    severity,
    title: alert.title,
    message: alert.message,
    trip: String(trip._id),
    driver: String(trip.driver),
    vehicle: String(trip.vehicle),
    location: coordinates ? { type: "Point", coordinates } : null,
    meta: meta ?? null,
    readAt: null,
    createdAt: alert.createdAt.toISOString(),
  };
  realtime.emitToUsers([trip.manager], "alert:new", event);

  sendPush(trip.manager, {
    title: alert.title,
    body: alert.message,
    data: { alertId: event.id, tripId: event.trip, type },
  }).catch((err: Error) => console.error("[push]", err.message));
}
