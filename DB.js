const mysql = require("mysql2");
require("dotenv").config();



const DATABASE_NAME = process.env.DB_NAME || "RealEstateDB";

const connection = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: process.env.DB_PORT || 33066,
  multipleStatements: true,
});

connection.connect((err) => {
  if (err) {
    console.error("❌ Error connecting to MySQL:", err.message);
    process.exit(1);
  } else {
    console.log(`✅ Connected to MySQL server at: ${connection.config.host}`);
    initializeDatabase();
  }
});

function initializeDatabase() {
  // 1️⃣ Create database if it doesn’t exist
  connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${DATABASE_NAME}\`;`,
    (err) => {
      if (err) {
        console.error("❌ Error creating database:", err.message);
        process.exit(1);
      }
      console.log(`📂 Database "${DATABASE_NAME}" is ready.`);

      // 2️⃣ Switch to the database
      connection.changeUser({ database: DATABASE_NAME }, (err) => {
        if (err) {
          console.error("❌ Error selecting database:", err.message);
          process.exit(1);
        }
        console.log(`🔄 Using database: ${DATABASE_NAME}`);
        createTables();
      });
    }
  );
}

function createTables() {
  const usersTable = `
    CREATE TABLE IF NOT EXISTS Users (
      user_id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(100),
      second_name VARCHAR(100),
      email VARCHAR(255) UNIQUE,
      password VARCHAR(255),
      properties JSON,
      favorites JSON,
      is_online BOOLEAN DEFAULT FALSE
    );
  `;

  const propertyTable = `
    CREATE TABLE IF NOT EXISTS Property (
      property_id INT AUTO_INCREMENT PRIMARY KEY,
      owner_id INT,
      property_name VARCHAR(255),
      property_desc TEXT,
      location VARCHAR(255),
      price_per_day DECIMAL(10,2),
      size VARCHAR(50),
      bedrooms_no INT,
      beds_no INT,
      bathrooms_no INT,
      images JSON,
      ownership_proofs JSON,
      is_available BOOLEAN DEFAULT TRUE,
      rate FLOAT,
      FOREIGN KEY (owner_id) REFERENCES Users(user_id) ON DELETE CASCADE
    );
  `;

  const rentalTable = `
    CREATE TABLE IF NOT EXISTS Rental (
      rental_id INT AUTO_INCREMENT PRIMARY KEY,
      renter_id INT,
      lessor_id INT,
      property_id INT,
      rentend_on DATE,
      rent_duration INT,
      end_date DATE,
      price_per_day DECIMAL(10,2),
      total_price DECIMAL(10,2),
      status VARCHAR(50),
      FOREIGN KEY (renter_id) REFERENCES Users(user_id),
      FOREIGN KEY (lessor_id) REFERENCES Users(user_id),
      FOREIGN KEY (property_id) REFERENCES Property(property_id)
    );
  `;

  const rentalLogsTable = `
    CREATE TABLE IF NOT EXISTS Rental_logs (
      rental_id INT AUTO_INCREMENT PRIMARY KEY,
      renter_id INT,
      lessor_id INT,
      property_id INT,
      rentend_on DATE,
      rent_duration INT,
      end_date DATE,
      price_per_day DECIMAL(10,2),
      total_price DECIMAL(10,2),
      FOREIGN KEY (renter_id) REFERENCES Users(user_id),
      FOREIGN KEY (lessor_id) REFERENCES Users(user_id),
      FOREIGN KEY (property_id) REFERENCES Property(property_id)
    );
  `;

  connection.query(usersTable, (err) => {
    if (err)
      return console.error("❌ Error creating Users table:", err.message);
    console.log("✅ Users table ready");

    connection.query(propertyTable, (err) => {
      if (err)
        return console.error("❌ Error creating Property table:", err.message);
      console.log("✅ Property table ready");

      connection.query(rentalTable, (err) => {
        if (err)
          return console.error("❌ Error creating Rental table:", err.message);
        console.log("✅ Rental table ready");

        connection.query(rentalLogsTable, (err) => {
          if (err)
            return console.error(
              "❌ Error creating Rental_logs table:",
              err.message
            );
          console.log("✅ Rental_logs table ready");
        });
      });
    });
  });
}

module.exports = connection;
