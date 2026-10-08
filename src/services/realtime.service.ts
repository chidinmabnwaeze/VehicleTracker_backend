import type { Server } from "socket.io";
import type { Types } from "mongoose";
import type { UserDocument } from "../models/User";
import type { ClientToServerEvents, ServerToClientEvents } from "../types/events";

export interface SocketData {
  user: UserDocument;
}

export type TrackerServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

// Holds the Socket.IO server so services can push events without importing
// the socket setup. Every connected user sits in their own room.
let io: TrackerServer | null = null;

export const userRoom = (userId: string): string => `user:${userId}`;

export function setIO(server: TrackerServer): void {
  io = server;
}

export function emitToUsers<E extends keyof ServerToClientEvents>(
  userIds: Array<Types.ObjectId | string>,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  if (!io) return;
  const rooms = [...new Set(userIds.map((id) => userRoom(String(id))))];
  if (!rooms.length) return;
  // The event name and payload are checked by this function's own signature
  const target = io.to(rooms) as unknown as { emit(event: string, ...args: unknown[]): boolean };
  target.emit(event, ...args);
}
