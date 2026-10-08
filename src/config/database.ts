import mongoose from "mongoose";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { env } from "./env";

let memoryServer: MongoMemoryServer | null = null;

export async function connectDatabase(): Promise<void> {
  let uri = env.mongoUri;

  if (!uri) {
    if (env.isProduction) throw new Error("MONGO_URI is required in production");
    // Dev fallback so the API can run before a real database is set up.
    // Imported lazily because it is a dev dependency.
    const { MongoMemoryServer } = await import("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri("vehicle_tracker");
    console.warn(
      "[database] MONGO_URI not set - using an in-memory MongoDB, data is lost when the server stops",
    );
  }

  await mongoose.connect(uri);
  console.log("[database] MongoDB connected");
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}
