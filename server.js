const http = require("http");
const env = require("./config/env");
const app = require("./app");
const { connectDatabase, disconnectDatabase } = require("./config/database");
const store = require("./config/redis");
const { initSockets } = require("./sockets");
const tracking = require("./services/tracking.service");

async function start() {
  await connectDatabase();

  const server = http.createServer(app);
  const io = initSockets(server);
  const stopMonitor = tracking.startMonitor();

  server.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
  });

  const shutdown = async () => {
    stopMonitor();
    io.close();
    await Promise.allSettled([disconnectDatabase(), store.disconnect()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
