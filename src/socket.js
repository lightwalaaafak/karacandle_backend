import { Server } from "socket.io";

let io;

export function initSocket(httpServer, allowedOrigin) {
  io = new Server(httpServer, {
    cors: {
      origin: allowedOrigin || "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("Admin socket connected:", socket.id);
    socket.on("disconnect", () => {
      console.log("Admin socket disconnected:", socket.id);
    });
  });

  return io;
}

export function emitEvent(event, payload) {
  if (!io) {
    console.warn(`Socket not initialized, dropped event: ${event}`);
    return;
  }
  io.emit(event, payload);
}
