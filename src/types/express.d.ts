import type { UserDocument } from "../models/User";

declare global {
  namespace Express {
    interface Request {
      // Set by the authenticate middleware. Only read it in routes behind it.
      user: UserDocument;
    }
  }
}
