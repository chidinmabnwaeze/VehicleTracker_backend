const { Server } = require("socket.io");
const env = require("../config/env");
const { userFromToken } = require("../middleware/auth");
const realtime = require("../services/realtime.service");
const tracking = require("../services/tracking.service");

function initSockets(httpServer) {
  const io = new Server(httpServer, { cors: { origin: env.corsOrigin } });
  realtime.setIO(io);

  // Clients connect with io(url, { auth: { token } })
  io.use(async (socket, next) => {
    try {
      const header = socket.handshake.headers.authorization || "";
      const token =
        (socket.handshake.auth && socket.handshake.auth.token) ||
        (header.startsWith("Bearer ") ? header.slice(7) : null);
      socket.data.user = await userFromToken(token);
      next();
    } catch (err) {
      next(new Error(err.message));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.join(realtime.userRoom(user.id));

    // Driver app: socket.emit("location:update", { tripId, lat, lng, ... }, ack)
    socket.on("location:update", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (user.role !== "driver") {
        return reply({ ok: false, error: "Only drivers can send location updates" });
      }
      try {
        const result = await tracking.recordLocation(payload && payload.tripId, user.id, payload);
        reply({ ok: true, ...result });
      } catch (err) {
        if (!err.statusCode) console.error("[socket] location:update", err);
        reply({
          ok: false,
          error: err.statusCode ? err.message : "Could not process location update",
        });
      }
    });
  });

  return io;
}

module.exports = { initSockets };
