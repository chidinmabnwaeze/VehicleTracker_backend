import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { bearerToken, userFromToken } from "../middleware/auth";
import * as realtime from "../services/realtime.service";
import * as tracking from "../services/tracking.service";
import type { LocationAck } from "../types/events";
import { ApiError } from "../utils/ApiError";

export function initSockets(httpServer: HttpServer): realtime.TrackerServer {
  const io: realtime.TrackerServer = new Server(httpServer, { cors: { origin: env.corsOrigin } });
  realtime.setIO(io);

  // Clients connect with io(url, { auth: { token } })
  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth.token as string | undefined) ||
        bearerToken(socket.handshake.headers.authorization);
      socket.data.user = await userFromToken(token);
      next();
    } catch (err) {
      next(new Error((err as Error).message));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(realtime.userRoom(user.id));

    // Driver app: socket.emit("location:update", { tripId, lat, lng, ... }, ack)
    socket.on("location:update", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : (_reply: LocationAck) => {};
      if (user.role !== "driver") {
        reply({ ok: false, error: "Only drivers can send location updates" });
        return;
      }
      try {
        const result = await tracking.recordLocation(payload?.tripId, user._id, payload);
        reply({ ok: true, ...result });
      } catch (err) {
        const expected = err instanceof ApiError;
        if (!expected) console.error("[socket] location:update", err);
        reply({
          ok: false,
          error: expected ? err.message : "Could not process location update",
        });
      }
    });
  });

  return io;
}
