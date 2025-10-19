const express = require("express");
const connection = require("./DB");
const cors = require("cors");
const mountRoutes = require("./Routes/Routes")
require("dotenv").config();


const app = express();
const PORT = process.env.PORT || 8000;


app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.use(cors());

mountRoutes(app)


// just to test db-connection
// if dispalys time it works
app.get("/test-db", (req, res) => {
  connection.query("SELECT NOW() AS time", (err, results) => {
    if (err) return res.status(500).send("Database error");
    res.send(`Database connected! Server time: ${results[0].time}`);
  });
});





app.listen(PORT, () => console.log(`✅ Server running on http://${process.env.URL}${PORT}`));
