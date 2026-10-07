// Drives a fake delivery against a running server so the whole pipeline can be
// seen working without a frontend:  npm run simulate
// The trip goes off route, stops for a while, then arrives. Pings carry
// back-dated timestamps 20 s apart, so minutes of driving take a few seconds.
const { io } = require("socket.io-client");

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const ORIGIN = { name: "Ikeja Warehouse", lat: 6.6018, lng: 3.3515 };
const DESTINATION = { name: "Victoria Island Store", lat: 6.4281, lng: 3.4219 };
const STEPS = 60;
const PING_GAP_SECONDS = 20;
const SEND_EVERY_MS = 100;

async function api(method, path, token, body) {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${json.message}`);
  return json.data;
}

const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE_URL, { auth: { token } });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });

// Evenly spaced points along the planned route, as [lng, lat]
function samplePath(coordinates) {
  const points = [];
  for (let i = 0; i <= STEPS; i++) {
    const position = (i / STEPS) * (coordinates.length - 1);
    const index = Math.min(Math.floor(position), coordinates.length - 2);
    const t = position - index;
    const [aLng, aLat] = coordinates[index];
    const [bLng, bLat] = coordinates[index + 1];
    points.push([aLng + (bLng - aLng) * t, aLat + (bLat - aLat) * t]);
  }
  return points;
}

function buildPings(path) {
  const pings = [];
  path.forEach(([lng, lat], i) => {
    // Roughly 550 m sideways for a few pings: a route deviation
    const offRoute = i >= 20 && i < 25;
    pings.push({ lat, lng: offRoute ? lng + 0.005 : lng });
    // Parked for 15 minutes: a stationary vehicle
    if (i === 40) for (let n = 0; n < 45; n++) pings.push({ lat, lng });
  });
  return pings;
}

async function main() {
  const stamp = Date.now();
  const password = "password123";

  const manager = await api("POST", "/auth/register", null, {
    name: "Sim Manager",
    email: `manager.${stamp}@example.com`,
    password,
  });
  const driver = await api("POST", "/drivers", manager.token, {
    name: "Sim Driver",
    email: `driver.${stamp}@example.com`,
    password,
  });
  const vehicle = await api("POST", "/vehicles", manager.token, {
    plateNumber: `SIM-${String(stamp).slice(-5)}`,
    make: "Toyota",
    vehicleModel: "Hiace",
  });
  const created = await api("POST", "/trips", manager.token, {
    driverId: driver.id,
    vehicleId: vehicle.id,
    cargo: "40 cartons",
    origin: ORIGIN,
    destination: DESTINATION,
  });
  console.log(`Trip ${created.id} created, route source: ${created.route.source}`);

  const seen = [];
  let locations = 0;
  const managerSocket = await connect(manager.token);
  managerSocket.on("trip:location", () => locations++);
  managerSocket.on("trip:status", (event) => console.log(`[manager] trip:status -> ${event.status}`));
  managerSocket.on("trip:update", (event) => console.log("[manager] trip:update ->", JSON.stringify(event)));
  managerSocket.on("alert:new", (alert) => {
    seen.push(alert.type);
    console.log(`[manager] alert:new  -> ${alert.type} (${alert.severity}): ${alert.message}`);
  });

  const driverLogin = await api("POST", "/auth/login", null, {
    email: `driver.${stamp}@example.com`,
    password,
  });
  const trip = await api("POST", `/trips/${created.id}/start`, driverLogin.token);
  const driverSocket = await connect(driverLogin.token);

  const pings = buildPings(samplePath(trip.route.geometry.coordinates));
  const startTime = Date.now() - pings.length * PING_GAP_SECONDS * 1000;
  for (let i = 0; i < pings.length; i++) {
    const reply = await driverSocket.emitWithAck("location:update", {
      tripId: trip.id,
      ...pings[i],
      speed: 12,
      accuracy: 8,
      timestamp: new Date(startTime + i * PING_GAP_SECONDS * 1000).toISOString(),
    });
    if (!reply.ok) throw new Error(`location:update rejected: ${reply.error}`);
    await new Promise((resolve) => setTimeout(resolve, SEND_EVERY_MS));
  }
  await new Promise((resolve) => setTimeout(resolve, 500));

  await api("POST", `/trips/${trip.id}/complete`, driverLogin.token);
  const alerts = await api("GET", `/alerts?tripId=${trip.id}`, manager.token);
  console.log(`\nManager received ${locations} live locations and ${seen.length} alerts (${alerts.length} stored)`);

  managerSocket.close();
  driverSocket.close();

  const missing = ["deviation", "stationary", "arrival"].filter((type) => !seen.includes(type));
  if (missing.length) {
    console.error(`Missing expected alerts: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Deviation, stationary and arrival alerts all fired.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
