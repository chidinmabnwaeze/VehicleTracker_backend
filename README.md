# Vehicle Tracker backend

Tracks delivery vehicles in real time and alerts the manager when a driver leaves the planned route, stops moving, hits heavy traffic, goes silent, or arrives.

TypeScript, Express 5, MongoDB (Mongoose), Socket.IO, Redis, Mapbox Directions, Firebase Cloud Messaging.

## Running it

```bash
npm install
cp .env.example .env   # optional in development
npm run dev            # http://localhost:5000, restarts on change
npm run simulate       # in a second terminal: drives a fake delivery end to end
npm test
npm run typecheck
```

### Demo data

```bash
npm run seed                  # needs MONGO_URI; does nothing if the demo data is already there
npm run seed -- --reset       # replace the demo data
npm run simulate -- --seeded  # with the server running: drives a seeded trip live, one ping a second
```

The seed creates one manager, 7 drivers, 8 vehicles and 11 Lagos trips covering every status, with planned routes, driven paths, battery readings and alerts. It only ever touches the seed manager's data. Every account uses the password `password123`:

| Role | Email |
| --- | --- |
| Manager | `manager@example.com` |
| Driver with a pending trip to start | `emeka@example.com`, `yusuf@example.com` |
| Driver on the road | `tunde@example.com`, `ibrahim@example.com` (off route), `chinedu@example.com` (stationary) |
| Driver at the destination | `segun@example.com` |
| Driver with no trips | `blessing@example.com` |

The three seeded trips that are "on the road" are snapshots: nothing is sending their location, so each raises a real `signal_lost` alert about a minute after the server starts.

For production, `npm run build` compiles `src/` to `dist/` and `npm start` runs it.

The server starts with an empty `.env`. Each missing service has a development fallback:

| Variable | Without it |
| --- | --- |
| `MONGO_URI` | In-memory MongoDB. Data is lost on restart. |
| `REDIS_URL` | Live trip state is kept in process memory. |
| `MAPBOX_ACCESS_TOKEN` | Planned route is a straight line from origin to destination, and there are no traffic alerts or live ETA. |
| `FIREBASE_SERVICE_ACCOUNT` | No push notifications. Alerts still arrive over the socket and are stored. |
| `JWT_SECRET` | Random secret per start, so tokens die on restart. |

`MONGO_URI` and `JWT_SECRET` are required when `NODE_ENV=production`. Detection thresholds are also set in `.env`, see `.env.example`.

## How it works

1. A manager signs up, then creates drivers and vehicles.
2. The manager creates a trip (driver, vehicle, origin, destination). The backend plans the route with Mapbox and stores it.
3. The driver logs in, starts the trip, and the driver app streams GPS over the socket.
4. Every ping is stored, checked, and pushed to the manager as `trip:location`. Alerts go out as `alert:new`, are stored, and are sent as push notifications.

| Alert `type` | Severity | Raised when |
| --- | --- | --- |
| `deviation` | critical | More than 200 m from the planned route for 2 pings in a row |
| `stationary` | warning | Within a 30 m radius for 5 minutes |
| `traffic` | warning | Mapbox says the remaining drive is at least 5 minutes and 25% slower than usual (checked every 2 minutes, at most one alert per 15 minutes) |
| `signal_lost` | critical | No ping for 3 minutes during a trip. The message includes the phone's last battery reading and last tracking report, e.g. "Last report: the app was sent to the background. Last battery reading: 7%." |
| `arrival` | info | Within 100 m of the destination. The trip becomes `arrived`. |

Each alert fires once when the condition begins. It can fire again only after the condition has cleared. The current state is always in the trip's `flags` (`deviated`, `stationary`, `traffic`, `signalLost`), which are included in every `trip:location` event, so the frontend can clear a banner when a flag goes back to `false`.

## Driver device safeguards

These are the server side of the checks the driver app already makes. The server repeats them because a client check can be skipped.

| Safeguard | Behaviour |
| --- | --- |
| Low battery at start | `POST /trips/:id/start` with `battery` below 30% and not charging is rejected with code `low-battery`. Not enforced when no battery is sent, since iOS and Firefox cannot report it. Threshold: `MIN_START_BATTERY`. |
| One trip at a time | Starting a second trip is rejected with code `trip-in-progress`. |
| Delivered only at the destination | A driver can complete a trip only once it is `arrived`; otherwise code `destination-not-reached`. A manager can still close a trip early. |
| Battery tracking | Each ping may carry `battery`. The latest reading is kept on the trip as `tracking.battery`, alongside `tracking.lastSeenAt`. |
| Tracking interruptions | The app reports `backgrounded`, `resumed`, `offline`, `online`, `location-denied` and `location-unavailable`. They are stored, relayed to the manager as `trip:tracking`, and the latest is kept as `tracking.lastEvent`. |

## Conventions

- Base URL is `/api`. Send `Authorization: Bearer <token>` on everything except register and login.
- Success responses are `{ "data": ..., "meta": ... }`. Errors are `{ "message": "..." }` with a 4xx or 5xx status, plus a stable `code` where the frontend needs to branch (`low-battery`, `trip-in-progress`, `vehicle-in-use`, `destination-not-reached`).
- **Coordinates:** requests and socket events use `lat` and `lng` (`latitude` and `longitude` are also accepted, as is `recordedAt` for `timestamp`). Stored documents (trips, alerts) use GeoJSON, which is `[lng, lat]`. Mapbox GL takes that order directly.
- List endpoints accept `page` and `limit` (max 100).
- Speed is in meters per second, heading in degrees, accuracy and distances in meters.

## REST API

### Auth

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | `name, email, password, phone?` | Creates a manager. Returns `{ user, token }`. |
| POST | `/auth/login` | `email, password` | Managers and drivers. Returns `{ user, token }`. |
| GET | `/auth/me` | | Current user. |
| POST | `/auth/fcm-token` | `token` | Register this device for push. |
| DELETE | `/auth/fcm-token` | `token` | Call on logout. |

### Drivers and vehicles (manager only)

| Method | Path | Body |
| --- | --- | --- |
| POST | `/drivers` | `name, email, password, phone?` |
| GET | `/drivers` | query: `active=true\|false` |
| GET | `/drivers/:id` | |
| PATCH | `/drivers/:id` | `name?, phone?, password?, isActive?` |
| DELETE | `/drivers/:id` | Deactivates the driver. |
| POST | `/vehicles` | `plateNumber, make?, vehicleModel?, type?` |
| GET | `/vehicles` | query: `active=true\|false` |
| GET | `/vehicles/:id` | |
| PATCH | `/vehicles/:id` | any of the create fields, `isActive?` |
| DELETE | `/vehicles/:id` | Deactivates the vehicle. |

### Trips

| Method | Path | Who | Notes |
| --- | --- | --- | --- |
| POST | `/trips` | manager | Body below. |
| GET | `/trips` | both | Managers see their trips, drivers the ones assigned to them. Query: `status` (comma separated), `driverId`, `vehicleId`. The route geometry is left out of lists. |
| GET | `/trips/:id` | both | Includes `route.geometry` to draw the planned route. |
| GET | `/trips/:id/locations` | both | The path actually driven, oldest first. Query: `since`, `limit` (max 5000). |
| POST | `/trips/:id/start` | driver | `pending` to `in_progress`. Optional body: `{ "battery": { "level": 82, "charging": false } }`. |
| POST | `/trips/:id/location` | driver | HTTP fallback for the socket event, same body. |
| POST | `/trips/:id/events` | driver | Tracking interruption. Body: `type`, `battery?`, `timestamp?`. |
| GET | `/trips/:id/events` | both | Tracking interruptions for the trip, oldest first. |
| POST | `/trips/:id/complete` | both | To `completed`. Drivers need the trip to be `arrived`; managers can also complete an `in_progress` trip. |
| POST | `/trips/:id/cancel` | manager | |

```json
POST /api/trips
{
  "driverId": "...",
  "vehicleId": "...",
  "cargo": "40 cartons",
  "reference": "ORD-1042",
  "origin": { "name": "Ikeja Warehouse", "address": "...", "lat": 6.6018, "lng": 3.3515 },
  "destination": { "name": "Victoria Island Store", "lat": 6.4281, "lng": 3.4219 }
}
```

Trip status goes `pending` → `in_progress` → `arrived` → `completed`, or `cancelled`. For the live map, load `GET /trips?status=in_progress,arrived` once, then keep it current from the socket.

### Alerts (manager only)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/alerts` | Newest first. Query: `tripId`, `type` (comma separated), `unread=true`. `meta.unread` is the total unread count. |
| PATCH | `/alerts/:id/read` | |
| PATCH | `/alerts/read-all` | Optional query `tripId`. |

## Socket.IO

```js
import { io } from "socket.io-client";
const socket = io("http://localhost:5000", { auth: { token } });
```

A bad or missing token fails the connection with `connect_error`.

Every event and payload below is typed in [src/types/events.ts](src/types/events.ts). The file imports nothing, so a TypeScript frontend can copy it and type its socket as `Socket<ServerToClientEvents, ClientToServerEvents>`.

### Driver app sends

```js
socket.emit(
  "location:update",
  { tripId, lat, lng, speed, heading, accuracy, battery, timestamp }, // only tripId, lat, lng are required
  (reply) => {} // { ok: true, status, flags } or { ok: false, error }
);
```

Send every 5 to 15 seconds while the trip is `in_progress`, even when not moving. Stop when `reply.status` is `arrived`. `reply.flags.deviated` tells the driver app when to show its own off-route warning.

```js
socket.emit("tracking:event", { tripId, type: "backgrounded", battery, timestamp }, (reply) => {});
```

### Server sends

| Event | To | Payload |
| --- | --- | --- |
| `trip:location` | manager | `tripId, driverId, vehicleId, lat, lng, speed, heading, accuracy, battery, recordedAt, flags, distanceFromRouteMeters, distanceToDestinationMeters` |
| `trip:status` | manager, driver | `tripId, status, at, eta` on create, start, arrival, complete and cancel |
| `trip:update` | manager, driver | `tripId, flags` and, after a traffic check, `eta, remainingDistanceMeters, remainingDurationSeconds, trafficDelaySeconds` |
| `trip:tracking` | manager | `tripId, type, battery, recordedAt` when the driver's phone reports an interruption |
| `alert:new` | manager | The stored alert: `id, type, severity, title, message, trip, driver, vehicle, location, meta, createdAt` |

## Layout

```
src/server.ts            entry point: database, HTTP, sockets, signal monitor
src/app.ts               express app
src/config/              env, database, redis store, mapbox, firebase
src/models/              User, Vehicle, Trip, LocationPing, Alert
src/controllers/ routes/ REST API
src/services/tracking    detection for every location ping
src/services/alert       stores an alert, emits it, sends the push
src/sockets/             socket auth and the location:update event
src/types/events.ts      socket event types, shareable with the frontend
scripts/simulate.ts      fake delivery for testing without a frontend
```
