const { Server } = require("socket.io");

let io = null;

module.exports = {
  init: (httpServer) => {
    io = new Server(httpServer, {
      cors: { origin: "*" }
    });
    return io;
  },
  getIO: () => {
    if (!io) {
      throw new Error("Socket.io not initialized!");
    }
    return io;
  },
};