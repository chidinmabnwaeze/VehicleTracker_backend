const Alert = require("../models/Alert");
const User = require("../models/User");
const Vehicle = require("../models/Vehicle");
const realtime = require("./realtime.service");
const { sendPush } = require("./notification.service");

const TITLES = {
  deviation: "Route deviation",
  stationary: "Vehicle stationary",
  traffic: "Heavy traffic",
  signal_lost: "Signal lost",
  arrival: "Arrived at destination",
};

// text continues the sentence after the driver and vehicle, e.g.
// "John Doe (ABC-123) " + "has left the planned route"
async function createAlert(trip, { type, severity, text, coordinates, meta }) {
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
    title: TITLES[type],
    message: `${who} ${text}`,
    location: coordinates ? { type: "Point", coordinates } : undefined,
    meta,
  });

  realtime.emitToUsers([trip.manager], "alert:new", alert.toJSON());

  sendPush(trip.manager, {
    title: alert.title,
    body: alert.message,
    data: { alertId: alert.id, tripId: String(trip._id), type },
  }).catch((err) => console.error("[push]", err.message));

  return alert;
}

module.exports = { createAlert };
