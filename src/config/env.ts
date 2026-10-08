import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const num = (value: string | undefined, fallback: number): number =>
  value === undefined || value === "" || Number.isNaN(Number(value))
    ? fallback
    : Number(value);

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  if (isProduction) throw new Error("JWT_SECRET is required in production");
  jwtSecret = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[config] JWT_SECRET not set - using a random secret, tokens will stop working when the server restarts",
  );
}

const corsOrigin: string | string[] = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim())
  : "*";

export const env = {
  nodeEnv,
  isProduction,
  port: num(process.env.PORT, 5000),
  corsOrigin,
  mongoUri: process.env.MONGO_URI,
  redisUrl: process.env.REDIS_URL,
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  mapboxToken: process.env.MAPBOX_ACCESS_TOKEN,
  firebaseServiceAccount: process.env.FIREBASE_SERVICE_ACCOUNT,
  tracking: {
    // Within this distance of the destination the trip is marked as arrived
    arrivalRadiusM: num(process.env.ARRIVAL_RADIUS_M, 100),
    // Further than this from the planned route counts as off route
    deviationThresholdM: num(process.env.DEVIATION_THRESHOLD_M, 200),
    // Consecutive off-route pings needed before alerting (filters GPS jumps)
    deviationConfirmPings: num(process.env.DEVIATION_CONFIRM_PINGS, 2),
    // Staying within this radius for stationaryMinutes counts as stationary
    stationaryRadiusM: num(process.env.STATIONARY_RADIUS_M, 30),
    stationaryMinutes: num(process.env.STATIONARY_MINUTES, 5),
    // No pings for this long during a trip raises a signal_lost alert
    signalLostMinutes: num(process.env.SIGNAL_LOST_MINUTES, 3),
    trafficCheckSeconds: num(process.env.TRAFFIC_CHECK_SECONDS, 120),
    // Traffic alert needs both: delay of at least N minutes and N x typical time
    trafficDelayMinutes: num(process.env.TRAFFIC_DELAY_MINUTES, 5),
    trafficDelayRatio: num(process.env.TRAFFIC_DELAY_RATIO, 1.25),
    trafficAlertCooldownMinutes: num(process.env.TRAFFIC_ALERT_COOLDOWN_MINUTES, 15),
    // Pings less accurate than this are stored but not used for detection
    maxAccuracyM: num(process.env.MAX_ACCURACY_M, 100),
  },
};
