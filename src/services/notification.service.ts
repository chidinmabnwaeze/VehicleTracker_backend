import type { Types } from "mongoose";
import { getMessaging } from "../config/firebase";
import { User } from "../models/User";

const DEAD_TOKEN_CODES = [
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
];

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

// Sends a push to every device the user registered
export async function sendPush(
  userId: Types.ObjectId | string,
  { title, body, data }: PushMessage,
): Promise<void> {
  const messaging = getMessaging();
  if (!messaging) return;

  const user = await User.findById(userId).select("+fcmTokens");
  const tokens = user?.fcmTokens ?? [];
  if (!tokens.length) return;

  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: { title, body },
    data,
  });

  const dead = tokens.filter((_token, i) => {
    const error = result.responses[i].error;
    return error !== undefined && DEAD_TOKEN_CODES.includes(error.code);
  });
  if (dead.length) {
    await User.updateOne({ _id: userId }, { $pull: { fcmTokens: { $in: dead } } });
  }
}
