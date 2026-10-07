// Holds the Socket.IO server so services can push events without importing
// the socket setup. Every connected user sits in their own room.
let io = null;

const userRoom = (userId) => `user:${userId}`;

function setIO(server) {
  io = server;
}

function emitToUsers(userIds, event, payload) {
  if (!io) return;
  const rooms = [...new Set(userIds.filter(Boolean).map((id) => userRoom(String(id))))];
  if (rooms.length) io.to(rooms).emit(event, payload);
}

module.exports = { setIO, userRoom, emitToUsers };
