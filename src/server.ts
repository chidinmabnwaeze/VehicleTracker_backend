import http from "http";
import app from "./app";
import { connectDatabase, disconnectDatabase } from "./config/database";
import { env } from "./config/env";
import * as store from "./config/redis";
import * as tracking from "./services/tracking.service";
import { initSockets } from "./sockets";

async function start(): Promise<void> {
  await connectDatabase();

  const server = http.createServer(app);
  const io = initSockets(server);
  const stopMonitor = tracking.startMonitor();

  server.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
  });

  const shutdown = async (): Promise<void> => {
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
