const express = require("express");
const connection = require("./DB");
const cors = require("cors");
const http = require("http");
const mountRoutes = require("./Routes/Routes");
require("dotenv").config();
const cookieParser = require("cookie-parser");
// Fix 1: Removed the stray 'socketAuth' word from this line
const { init } = require("./Utils/socketManager");
const { NotificationSystem } = require("./Utils/classes/NotificationSystem");
const { ChatSystem } = require("./Utils/classes/ChatSystem"); 
const socketAuth = require("./Middleware/socketAuth");

const app = express();
const PORT = process.env.PORT || 8000;
const isInDev = process.env.STATE;

const server = http.createServer(app);
const io = init(server);

// Middleware and Systems
io.use(socketAuth);
const notifier = new NotificationSystem(io, connection);
const chatManager = new ChatSystem(io, connection);

// App Settings
app.set("view engine", "ejs");
app.set("views", "view");
app.set("notifier", notifier);
app.set("chatManager", chatManager);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(cookieParser());
app.use("/uploads", express.static("uploads"));

mountRoutes(app);

// Socket Logic

app.get("/test-db", (req, res) => {
  connection.query("SELECT NOW() AS time", (err, results) => {
    if (err) return res.status(500).send("Database error");
    res.send(`Database connected! Server time: ${results[0].time}`);
  });
});

io.on("connection", (socket) => {
  const userId = socket.user.userId;
  socket.join(userId);
  console.log(`👤 User ${userId} joined their private room.`);

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected");
  });
});

// Fix 2: Unified server.listen (Removed the duplicate call)
server.listen(PORT, () =>
  isInDev === "DEV"
    ? console.log(`✅ Server & Sockets running on http://${process.env.URL}:${PORT}`)
    : console.log(`✅ Server & Sockets running on http://${process.env.URL}`)
);

module.exports = { app, server };