import fs from "fs";
import path from "path";
import { cert, initializeApp } from "firebase-admin/app";
import { getMessaging as firebaseMessaging, type Messaging } from "firebase-admin/messaging";
import { env } from "./env";

// FIREBASE_SERVICE_ACCOUNT is either a path to the service account JSON file
// or the JSON itself. Without it push notifications are simply skipped.
let messaging: Messaging | null = null;

if (env.firebaseServiceAccount) {
  try {
    const raw = env.firebaseServiceAccount.trim();
    const credentials = JSON.parse(
      raw.startsWith("{") ? raw : fs.readFileSync(path.resolve(raw), "utf8"),
    );
    initializeApp({ credential: cert(credentials) });
    messaging = firebaseMessaging();
    console.log("[firebase] push notifications enabled");
  } catch (err) {
    console.error("[firebase] could not initialise, push disabled:", (err as Error).message);
  }
} else {
  console.warn("[firebase] FIREBASE_SERVICE_ACCOUNT not set - push notifications disabled");
}

export const getMessaging = (): Messaging | null => messaging;
