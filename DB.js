const mysql = require("mysql2");
require("dotenv").config();
const bcrypt = require("bcrypt");
const { name } = require("ejs");

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
    throw new Error(`Error connecting to MySQL: ${err.message}`);
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
        throw new Error(`Error creating database: ${err.message}`);
      }
      console.log(`📂 Database "${DATABASE_NAME}" is ready.`);

      connection.changeUser({ database: DATABASE_NAME }, (err) => {
        if (err) {
          console.error("❌ Error selecting database:", err.message);
          throw new Error(`Error selecting database: ${err.message}`);
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
  balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,     
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
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),

    -- Pricing (NEW)
    pricing_unit ENUM('DAY','MONTH','YEAR') NOT NULL DEFAULT 'DAY',
    price_value DECIMAL(10,2) NOT NULL,      -- owner chosen value (per unit)
    price_per_day DECIMAL(10,2) NOT NULL,    -- normalized daily price (used for all calculations)

    size VARCHAR(50),
    bedrooms_no INT,
    beds_no INT,
    bathrooms_no INT,
    images JSON,
    ownership_proofs JSON,
    
    listing_status ENUM('inactive', 'active', 'under_negotiation', 'sold', 'expired') DEFAULT 'inactive',
    listing_expiry DATETIME NULL,

    is_verified BOOLEAN DEFAULT FALSE,
    is_furnished BOOLEAN DEFAULT FALSE,
    property_type ENUM('for_sale','for_rent') DEFAULT 'for_rent',
    rate FLOAT,

    FOREIGN KEY (owner_id) REFERENCES Users(user_id) ON DELETE CASCADE
  );
`;

  const rentingRequestTable = `
  CREATE TABLE IF NOT EXISTS renting_request (
    request_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    property_id INT NOT NULL,
    renter_id CHAR(36) NOT NULL,
    renting_type ENUM('DAY', 'MONTH') NOT NULL DEFAULT 'DAY',
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
    request_id CHAR(36) NOT NULL,
    renter_id CHAR(36) NOT NULL,
    owner_id CHAR(36) NOT NULL,
    property_id INT NOT NULL,
    renting_type ENUM('DAY', 'MONTH') NOT NULL,
    status ENUM('UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED','OVERDUE') NOT NULL DEFAULT 'UPCOMING',
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    next_billing_date DATE,
    FOREIGN KEY (request_id) REFERENCES renting_request(request_id) ON DELETE CASCADE,
    FOREIGN KEY (renter_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES Property(property_id) ON DELETE CASCADE
  );
`;

  const invoiceTable = `
  CREATE TABLE IF NOT EXISTS Invoices (
    invoice_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    lease_id CHAR(36) NOT NULL,
    renter_id CHAR(36) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    due_date DATE NOT NULL,
    status ENUM('UNPAID', 'PAID', 'OVERDUE', 'VOID') DEFAULT 'UNPAID',
    kashier_order_id VARCHAR(255), -- The custom ID you'll send to Kashier
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lease_id) REFERENCES Lease(lease_id) ON DELETE CASCADE,
    FOREIGN KEY (renter_id) REFERENCES Users(user_id) ON DELETE CASCADE
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

  const paymentIntentsTable = `
  CREATE TABLE IF NOT EXISTS PaymentIntents (
    payment_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id CHAR(36) NOT NULL,
    property_id INT NOT NULL,
    payment_type ENUM('rent', 'withdraw', 'refund') NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('card', 'wallet') NOT NULL,
    status ENUM('pending', 'succeeded', 'failed', 'canceled') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES Property(property_id) ON DELETE CASCADE
  );
`;

  const notificationTable = `
  CREATE TABLE IF NOT EXISTS Notifications (
    notification_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    sender VARCHAR(36) NOT NULL,    -- Can be a User ID or a 'SYSTEM' identifier
    receiver VARCHAR(36) NOT NULL,  -- The target User ID
    event_type VARCHAR(50) NOT NULL, --  'PAYMENT_SUCCESS', 'RENT_REQUEST'
    notification_title VARCHAR(255) NOT NULL,
    notification_body TEXT,
    metadata JSON,               -- Stores { reference_id: ..., type: ... }
    viewed BOOLEAN DEFAULT FALSE, -- true/false
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    
    INDEX idx_receiver (receiver),
    INDEX idx_viewed (viewed)
  );
`;

  const purchaseRequestsTable = `
  CREATE TABLE IF NOT EXISTS PurchaseRequests (
    request_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    property_id INT NOT NULL,
    buyer_id CHAR(36) NOT NULL,
    owner_id CHAR(36) NOT NULL,

    message TEXT,
    status ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED') DEFAULT 'PENDING',
    contact_unlocked BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (property_id) REFERENCES Property(property_id) ON DELETE CASCADE,
    FOREIGN KEY (buyer_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    UNIQUE KEY unique_request (buyer_id, property_id)
  );
`;

  const chatTable = `CREATE TABLE IF NOT EXISTS Chats (
    chat_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    owner_id CHAR(36) NOT NULL,
    renter_id CHAR(36) NOT NULL,
    property_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- This UNIQUE constraint prevents duplicate threads for the same property/users
    UNIQUE INDEX idx_unique_chat (owner_id, renter_id, property_id),
    
    -- Foreign Keys
    FOREIGN KEY (owner_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (renter_id) REFERENCES Users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES Property(property_id) ON DELETE CASCADE
);
`;

  const messagesTable = `CREATE TABLE IF NOT EXISTS Messages (
    message_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    chat_id CHAR(36) NOT NULL,
    sender_id CHAR(36) NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign Keys
    FOREIGN KEY (chat_id) REFERENCES Chats(chat_id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES Users(user_id) ON DELETE CASCADE
);`;
  // --- Execution Logic ---

  connection.query(adminsTable, async (err) => {
    if (err)
      return console.error("❌ Error creating Admins table:", err.message);
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
                if (err)
                  return console.error("❌ Error inserting superadmin:", err);
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
    if (err)
      return console.error("❌ Error creating Users table:", err.message);
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
      [
        defaultUser.first_name,
        defaultUser.second_name,
        defaultUser.email,
        defaultUser.password,
        defaultUser.is_verified,
      ],
      (err) => {
        if (err)
          return console.error("❌ Error inserting default user:", err.message);
        console.log("👤 Default user ensured for frontend");
      },
    );

    connection.query(propertyTable, (err) => {
      if (err)
        return console.error("❌ Error creating Property table:", err.message);
      console.log("✅ Property table ready");

      const dependentTables = [
        { name: "Renting Request", sql: rentingRequestTable },
        { name: "Lease", sql: leaseTable },
        { name: "Invoice", sql: invoiceTable },
        { name: "Verification Requests", sql: verificationRequestsTable },
        { name: "Payment Intents", sql: paymentIntentsTable },
        { name: "Notifications", sql: notificationTable },
        { name: "Purchase Requests", sql: purchaseRequestsTable },
        { name: "Chats", sql: chatTable },
        { name: "Messages", sql: messagesTable },
      ];
      dependentTables.forEach((table) => {
        connection.query(table.sql, (err) => {
          if (err)
            return console.error(
              `❌ Error creating ${table.name} table:`,
              err.message,
            );
          console.log(`✅ ${table.name} table ready`);
        });
      });
    });
  });
}

module.exports = connection;
