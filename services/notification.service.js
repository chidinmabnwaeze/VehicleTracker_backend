const { getMessaging } = require("../config/firebase");
const User = require("../models/User");

const DEAD_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
];

// Sends a push to every device the user registered. data values must be strings.
async function sendPush(userId, { title, body, data }) {
  const messaging = getMessaging();
  if (!messaging) return;

  const user = await User.findById(userId).select("+fcmTokens");
  const tokens = (user && user.fcmTokens) || [];
  if (!tokens.length) return;

  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
  });

  const dead = tokens.filter((token, i) => {
    const error = result.responses[i].error;
    return error && DEAD_TOKEN_CODES.includes(error.code);
  });
  if (dead.length) {
    await User.updateOne({ _id: userId }, { $pull: { fcmTokens: { $in: dead } } });
  }
}

module.exports = { sendPush };
