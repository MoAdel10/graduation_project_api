const express = require("express");
const connection = require("./DB");
const cors = require("cors");
const mountRoutes = require("./Routes/Routes");
require("dotenv").config();
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 8000;
const isInDev = process.env.STATE; // if in development displays the http://url:port if anything else display domain [http://url]

// adding the setup for using ejs
app.set("view engine", "ejs");
app.set("views", "view");


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(cookieParser()); 

mountRoutes(app);

// just to test db-connection
// if dispalys time it works
app.get("/test-db", (req, res) => {
  connection.query("SELECT NOW() AS time", (err, results) => {
    if (err) return res.status(500).send("Database error");
    res.send(`Database connected! Server time: ${results[0].time}`);
  });
});

app.listen(PORT, () =>
  isInDev == "DEV"
    ? console.log(`✅ Server running on http://${process.env.URL}:${PORT}`)
    : console.log(`✅ Server running on http://${process.env.URL}`)
);
