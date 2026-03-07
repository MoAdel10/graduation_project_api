const jwt = require("jsonwebtoken");
require("dotenv").config();

/**
 * Socket.io Middleware to verify JWT during handshake
 */
const socketAuth = (socket, next) => {
  // 1. Check all possible locations for the token
  // Use headers for Postman, and handshake.auth for the real Frontend
  const token = 
    socket.handshake.headers?.token || 
    socket.handshake.auth?.token || 
    socket.handshake.query?.token;

  if (!token) {
    const err = new Error("Authentication error: Token missing");
    err.data = { content: "Please log in to receive real-time updates" };
    return next(err);
  }

  // Verify using secret key
  jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
    if (err) {
      const authErr = new Error("Authentication error: Invalid token");
      authErr.data = { content: "Your session has expired" };
      return next(authErr);
    }

    // Attach decoded user to the socket object
    socket.user = decoded;
    
    next();
  });
};

module.exports = socketAuth;