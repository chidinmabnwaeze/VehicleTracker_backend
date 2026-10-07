const path = require("path");
const env = require("./env");

// FIREBASE_SERVICE_ACCOUNT is either a path to the service account JSON file
// or the JSON itself. Without it push notifications are simply skipped.
let messaging = null;

if (env.firebaseServiceAccount) {
  try {
    const admin = require("firebase-admin");
    const raw = env.firebaseServiceAccount.trim();
    const credentials = raw.startsWith("{")
      ? JSON.parse(raw)
      : require(path.resolve(raw));
    admin.initializeApp({ credential: admin.credential.cert(credentials) });
    messaging = admin.messaging();
    console.log("[firebase] push notifications enabled");
  } catch (err) {
    console.error("[firebase] could not initialise, push disabled:", err.message);
  }
} else {
  console.warn(
    "[firebase] FIREBASE_SERVICE_ACCOUNT not set - push notifications disabled",
  );
}

module.exports = { getMessaging: () => messaging };
