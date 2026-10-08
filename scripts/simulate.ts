// Drives a fake delivery against a running server so the whole pipeline can be
// seen working without a frontend:  npm run simulate
// The trip goes off route, stops for a while, then arrives. Pings carry
// back-dated timestamps 20 s apart, so minutes of driving take a few seconds.
import { io, type Socket } from "socket.io-client";
import type { AlertType, ClientToServerEvents, ServerToClientEvents } from "../src/types/events";
import type { Position } from "../src/utils/geo";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Session {
  token: string;
  user: { id: string };
}
interface Entity {
  id: string;
}
interface TripResponse extends Entity {
  route: { source: string; geometry: { coordinates: Position[] } };
}

const BASE_URL = process.env.API_URL || "http://localhost:5000";
const ORIGIN = { name: "Ikeja Warehouse", lat: 6.6018, lng: 3.3515 };
const DESTINATION = { name: "Victoria Island Store", lat: 6.4281, lng: 3.4219 };
const STEPS = 60;
const PING_GAP_SECONDS = 20;
const SEND_EVERY_MS = 100;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function api<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (response.status === 204 ? {} : await response.json()) as {
    data: T;
    message?: string;
  };
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${json.message}`);
  return json.data;
}

const connect = (token: string): Promise<ClientSocket> =>
  new Promise((resolve, reject) => {
    const socket: ClientSocket = io(BASE_URL, { auth: { token } });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });

// Evenly spaced points along the planned route
function samplePath(coordinates: Position[]): Position[] {
  const points: Position[] = [];
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

function buildPings(path: Position[]): Array<{ lat: number; lng: number }> {
  const pings: Array<{ lat: number; lng: number }> = [];
  path.forEach(([lng, lat], i) => {
    // Roughly 550 m sideways for a few pings: a route deviation
    const offRoute = i >= 20 && i < 25;
    pings.push({ lat, lng: offRoute ? lng + 0.005 : lng });
    // Parked for 15 minutes: a stationary vehicle
    if (i === 40) for (let n = 0; n < 45; n++) pings.push({ lat, lng });
  });
  return pings;
}

async function main(): Promise<void> {
  const stamp = Date.now();
  const password = "password123";

  const manager = await api<Session>("POST", "/auth/register", undefined, {
    name: "Sim Manager",
    email: `manager.${stamp}@example.com`,
    password,
  });
  const driver = await api<Entity>("POST", "/drivers", manager.token, {
    name: "Sim Driver",
    email: `driver.${stamp}@example.com`,
    password,
  });
  const vehicle = await api<Entity>("POST", "/vehicles", manager.token, {
    plateNumber: `SIM-${String(stamp).slice(-5)}`,
    make: "Toyota",
    vehicleModel: "Hiace",
  });
  const created = await api<TripResponse>("POST", "/trips", manager.token, {
    driverId: driver.id,
    vehicleId: vehicle.id,
    cargo: "40 cartons",
    origin: ORIGIN,
    destination: DESTINATION,
  });
  console.log(`Trip ${created.id} created, route source: ${created.route.source}`);

  const seen: AlertType[] = [];
  let locations = 0;
  const managerSocket = await connect(manager.token);
  managerSocket.on("trip:location", () => locations++);
  managerSocket.on("trip:status", (event) =>
    console.log(`[manager] trip:status -> ${event.status}`),
  );
  managerSocket.on("trip:update", (event) =>
    console.log("[manager] trip:update ->", JSON.stringify(event)),
  );
  managerSocket.on("trip:tracking", (event) =>
    console.log(`[manager] trip:tracking -> ${event.type}, battery ${event.battery?.level}%`),
  );
  managerSocket.on("alert:new", (alert) => {
    seen.push(alert.type);
    console.log(`[manager] alert:new  -> ${alert.type} (${alert.severity}): ${alert.message}`);
  });

  const driverLogin = await api<Session>("POST", "/auth/login", undefined, {
    email: `driver.${stamp}@example.com`,
    password,
  });
  const trip = await api<TripResponse>("POST", `/trips/${created.id}/start`, driverLogin.token, {
    battery: { level: 82, charging: false },
  });
  const driverSocket = await connect(driverLogin.token);

  const pings = buildPings(samplePath(trip.route.geometry.coordinates));
  const startTime = Date.now() - pings.length * PING_GAP_SECONDS * 1000;
  for (let i = 0; i < pings.length; i++) {
    const reply = await driverSocket.emitWithAck("location:update", {
      tripId: trip.id,
      ...pings[i],
      speed: 12,
      accuracy: 8,
      battery: { level: Math.max(5, 82 - Math.floor(i / 4)), charging: false },
      timestamp: new Date(startTime + i * PING_GAP_SECONDS * 1000).toISOString(),
    });
    if (!reply.ok) throw new Error(`location:update rejected: ${reply.error}`);
    // The driver switches to another app for a moment
    if (i === 10 || i === 12) {
      await driverSocket.emitWithAck("tracking:event", {
        tripId: trip.id,
        type: i === 10 ? "backgrounded" : "resumed",
        battery: { level: 80, charging: false },
      });
    }
    await sleep(SEND_EVERY_MS);
  }
  await sleep(500);

  await api("POST", `/trips/${trip.id}/complete`, driverLogin.token);
  const alerts = await api<Entity[]>("GET", `/alerts?tripId=${trip.id}`, manager.token);
  console.log(
    `\nManager received ${locations} live locations and ${seen.length} alerts (${alerts.length} stored)`,
  );

  managerSocket.close();
  driverSocket.close();

  const expected: AlertType[] = ["deviation", "stationary", "arrival"];
  const missing = expected.filter((type) => !seen.includes(type));
  if (missing.length) {
    console.error(`Missing expected alerts: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("Deviation, stationary and arrival alerts all fired.");
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
