const mongoose = require("mongoose");
const env = require("./env");

let memoryServer = null;

async function connectDatabase() {
  let uri = env.mongoUri;

  if (!uri) {
    if (env.isProduction) throw new Error("MONGO_URI is required in production");
    // Dev fallback so the API can run before a real database is set up
    const { MongoMemoryServer } = require("mongodb-memory-server");
    memoryServer = await MongoMemoryServer.create();
    uri = memoryServer.getUri("vehicle_tracker");
    console.warn(
      "[database] MONGO_URI not set - using an in-memory MongoDB, data is lost when the server stops",
    );
  }

  await mongoose.connect(uri);
  console.log("[database] MongoDB connected");
}

async function disconnectDatabase() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop();
}

module.exports = { connectDatabase, disconnectDatabase };
