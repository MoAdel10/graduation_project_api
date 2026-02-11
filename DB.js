const mysql = require("mysql2");
require("dotenv").config();
const bcrypt = require("bcrypt");

const DATABASE_NAME = process.env.DB_NAME || "RealEstateDB";

const connection = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: process.env.DB_PORT || 3306,
  multipleStatements: true,
});

connection.connect((err) => {
  if (err) {
    console.error("❌ Error connecting to MySQL:", err.message);
    process.exit(1);
  } else {
    console.log(
      `✅ Connected to MySQL server at: ${connection.config.host}:${connection.config.port}`,
    );
    initializeDatabase();
  }
});

function initializeDatabase() {
  connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${DATABASE_NAME}\`;`,
    (err) => {
      if (err) {
        console.error("❌ Error creating database:", err.message);
        process.exit(1);
      }
      console.log(`📂 Database "${DATABASE_NAME}" is ready.`);

      connection.changeUser({ database: DATABASE_NAME }, (err) => {
        if (err) {
          console.error("❌ Error selecting database:", err.message);
          process.exit(1);
        }
        console.log(`🔄 Using database: ${DATABASE_NAME}`);
        createTables();
      });
    },
  );
}

function createTables() {
  const usersTable = `
CREATE TABLE IF NOT EXISTS Users (
  user_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  first_name VARCHAR(100),
  second_name VARCHAR(100),
  email VARCHAR(255) UNIQUE,
  password VARCHAR(255),
  properties JSON,
  favorites JSON,
  is_online BOOLEAN DEFAULT FALSE,
  is_verified BOOLEAN DEFAULT FALSE,
  otp_code VARCHAR(255),
  otp_expires_at DATETIME,
  reset_token VARCHAR(255),         
  reset_expires_at DATETIME           
);
`;

  const propertyTable = ` 
  CREATE TABLE IF NOT EXISTS Property (
    property_id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id CHAR(36),
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
    is_verified BOOLEAN DEFAULT FALSE,
    rate FLOAT,
    FOREIGN KEY (owner_id) REFERENCES Users(user_id) ON DELETE CASCADE
  );
`;

  const rentingRequestTable = `
  CREATE TABLE IF NOT EXISTS renting_request (
    request_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    property_id INT NOT NULL,
    renter_id CHAR(36) NOT NULL,
    request_state ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'PAYMENT_PENDING', 'PAID') DEFAULT 'PENDING',
    total_price DECIMAL(10, 2) NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    payment_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES Property(property_id) ON DELETE CASCADE,
    FOREIGN KEY (renter_id) REFERENCES Users(user_id) ON DELETE CASCADE
  );
`;

  const leaseTable = `
  CREATE TABLE IF NOT EXISTS Lease (
    lease_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    renter_id CHAR(36) NOT NULL,
    owner_id CHAR(36) NOT NULL,
    property_id INT NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    FOREIGN KEY (renter_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES Property(property_id) ON DELETE CASCADE
  );
`;

  const rentalTable = `
  CREATE TABLE IF NOT EXISTS Rental (
    rental_id INT AUTO_INCREMENT PRIMARY KEY,
    renter_id CHAR(36),
    lessor_id CHAR(36),
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
    renter_id CHAR(36),
    lessor_id CHAR(36),
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

  const adminsTable = `
  CREATE TABLE IF NOT EXISTS Admins (
    admin_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'super_admin') DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

  const verificationRequestsTable = `
  CREATE TABLE IF NOT EXISTS VerificationRequests (
    request_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    property_id INT NOT NULL, 
    user_id CHAR(36) NOT NULL,
    admin_id CHAR(36) DEFAULT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    rejection_reason TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES Property(property_id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES Admins(admin_id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
  );
`;

  // --- Execution Logic ---

  connection.query(adminsTable, async (err) => {
    if (err) return console.error("❌ Error creating Admins table:", err.message);
    console.log("✅ Admins table ready");

    try {
      const superEmail = process.env.SUPERADMIN_EMAIL;
      const superPassword = process.env.SUPERADMIN_PASSWORD;
      const saltRounds = parseInt(process.env.SALT_ROUNDS || 10);

      connection.query(
        "SELECT * FROM Admins WHERE role = 'super_admin' LIMIT 1",
        async (err, results) => {
          if (err) return console.error("❌ Error checking superadmin:", err);
          if (results.length === 0) {
            const hashed = await bcrypt.hash(superPassword, saltRounds);
            connection.query(
              "INSERT INTO Admins (email, password, role) VALUES (?, ?, 'super_admin')",
              [superEmail, hashed],
              (err) => {
                if (err) return console.error("❌ Error inserting superadmin:", err);
                console.log("🟢 Superadmin created automatically");
              },
            );
          } else {
            console.log("🔵 Superadmin already exists — skipping creation");
          }
        },
      );
    } catch (err) {
      console.error("❌ Unexpected error during superadmin creation:", err);
    }
  });

  connection.query(usersTable, (err) => {
    if (err) return console.error("❌ Error creating Users table:", err.message);
    console.log("✅ Users table ready");

    const defaultUser = {
      first_name: "Default",
      second_name: "User",
      email: "default@example.com",
      password: "$2b$10$YAzxENe2MbnVNPHp0lchpuaHF4kHG9ST3SKMT/TORQu1ugukIsObq", //Password$123
      is_verified: true,
    };

    // Simplified to INSERT IGNORE to prevent syntax issues with subqueries
    const insertUserQuery = `
      INSERT IGNORE INTO Users (first_name, second_name, email, password, is_verified)
      VALUES (?, ?, ?, ?, ?);
    `;

    connection.query(
      insertUserQuery,
      [defaultUser.first_name, defaultUser.second_name, defaultUser.email, defaultUser.password, defaultUser.is_verified],
      (err) => {
        if (err) return console.error("❌ Error inserting default user:", err.message);
        console.log("👤 Default user ensured for frontend");
      },
    );

    connection.query(propertyTable, (err) => {
      if (err) return console.error("❌ Error creating Property table:", err.message);
      console.log("✅ Property table ready");

      const dependentTables = [
        { name: "Renting Request", sql: rentingRequestTable },
        { name: "Lease", sql: leaseTable },
        { name: "Rental", sql: rentalTable },
        { name: "Rental Logs", sql: rentalLogsTable },
        { name: "Verification Requests", sql: verificationRequestsTable }
      ];

      dependentTables.forEach((table) => {
        connection.query(table.sql, (err) => {
          if (err) return console.error(`❌ Error creating ${table.name} table:`, err.message);
          console.log(`✅ ${table.name} table ready`);
        });
      });
    });
  });
}

module.exports = connection;