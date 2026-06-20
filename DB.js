const mysql = require("mysql2");
require("dotenv").config();
const bcrypt = require("bcrypt");

const DATABASE_NAME = process.env.DB_NAME || "RealEstateDB";

// ── Connection Pool (exported) ─────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: process.env.DB_PORT || 3306,
  database: DATABASE_NAME,
  multipleStatements: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
});

// ── Temporary connection for DB + table initialisation ─────────────────────
const initConn = mysql.createConnection({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  port: process.env.DB_PORT || 3306,
  multipleStatements: true,
});

initConn.connect((err) => {
  if (err) {
    console.error("❌ Error connecting to MySQL:", err.message);
    throw new Error(`Error connecting to MySQL: ${err.message}`);
  }
  console.log(
    `✅ Connected to MySQL server at: ${initConn.config.host}:${initConn.config.port}`,
  );

  initConn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DATABASE_NAME}\`;`,
    (err) => {
      if (err) {
        console.error("❌ Error creating database:", err.message);
        initConn.end();
        throw new Error(`Error creating database: ${err.message}`);
      }
      console.log(`📂 Database "${DATABASE_NAME}" is ready.`);

      initConn.changeUser({ database: DATABASE_NAME }, (err) => {
        if (err) {
          console.error("❌ Error selecting database:", err.message);
          initConn.end();
          throw new Error(`Error selecting database: ${err.message}`);
        }
        console.log(`🔄 Using database: ${DATABASE_NAME}`);
        createTables(initConn);
      });
    },
  );
});

// ── Table DDL ──────────────────────────────────────────────────────────────
function createTables(conn) {
  const usersTable = `
CREATE TABLE IF NOT EXISTS users (
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
  CREATE TABLE IF NOT EXISTS property (
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

    is_visible BOOLEAN DEFAULT TRUE,
    is_verified BOOLEAN DEFAULT FALSE,
    is_available BOOLEAN DEFAULT FALSE,
    is_furnished BOOLEAN DEFAULT FALSE,
    is_sponsored BOOLEAN DEFAULT FALSE,
    property_type ENUM('for_sale','for_rent') DEFAULT 'for_rent',
    rate FLOAT,

    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;

  const rentingRequestTable = `
  CREATE TABLE IF NOT EXISTS renting_request (
    request_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    property_id INT NOT NULL,
    renter_id CHAR(36) NOT NULL,
    renting_type ENUM('DAY', 'MONTH') NOT NULL DEFAULT 'DAY',
    request_state ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'PAYMENT_PENDING', 'PAID', 'REFUND_REQUESTED', 'REFUND_DENIED', 'REFUND_PROCESSING', 'REFUNDED') DEFAULT 'PENDING',
    total_price DECIMAL(10, 2) NOT NULL,
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    payment_id VARCHAR(255),
    reason TEXT NULL,
    denied_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES property(property_id) ON DELETE CASCADE,
    FOREIGN KEY (renter_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;
  const leaseTable = `
  CREATE TABLE IF NOT EXISTS lease (
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
    FOREIGN KEY (renter_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES property(property_id) ON DELETE CASCADE
  );
`;

  const invoiceTable = `
  CREATE TABLE IF NOT EXISTS invoices (
    invoice_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    lease_id CHAR(36) NOT NULL,
    renter_id CHAR(36) NOT NULL,
    owner_id CHAR(36) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    due_date DATE NOT NULL,
    status ENUM('UNPAID', 'PAID', 'OVERDUE', 'VOID') DEFAULT 'UNPAID',
    kashier_order_id VARCHAR(255),
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lease_id) REFERENCES lease(lease_id) ON DELETE CASCADE,
    FOREIGN KEY (renter_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;

  const adminsTable = `
  CREATE TABLE IF NOT EXISTS admins (
    admin_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin', 'super_admin') DEFAULT 'admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`;

  const verificationRequestsTable = `
  CREATE TABLE IF NOT EXISTS verificationrequests (
    request_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    property_id INT NOT NULL, 
    user_id CHAR(36) NOT NULL,
    admin_id CHAR(36) DEFAULT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    rejection_reason TEXT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES property(property_id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES admins(admin_id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;

  const paymentIntentsTable = `
  CREATE TABLE IF NOT EXISTS paymentintents (
    payment_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id CHAR(36) NOT NULL,
    property_id INT NULL,
    payment_type ENUM('rent', 'withdraw', 'refund') NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    payment_method ENUM('card', 'wallet', 'bank_transfer') NOT NULL,
    status ENUM('pending', 'succeeded', 'failed', 'canceled') DEFAULT 'pending',
    transfer_id VARCHAR(64) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;

  const notificationTable = `
  CREATE TABLE IF NOT EXISTS notifications (
    notification_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    sender VARCHAR(36) NOT NULL,
    receiver VARCHAR(36) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    notification_title VARCHAR(255) NOT NULL,
    notification_body TEXT,
    metadata JSON,
    viewed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_receiver (receiver),
    INDEX idx_viewed (viewed)
  );
`;

  const listingSubscriptionsTable = `
  CREATE TABLE IF NOT EXISTS listingsubscriptions (
    subscription_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    property_id INT NOT NULL,
    owner_id CHAR(36) NOT NULL,
    plan_months INT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status ENUM('UNPAID', 'PAID') DEFAULT 'UNPAID',
    kashier_order_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (property_id) REFERENCES property(property_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
  );
`;

  const chatTable = `CREATE TABLE IF NOT EXISTS chats (
    chat_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    owner_id CHAR(36) NOT NULL,
    renter_id CHAR(36) NOT NULL,
    property_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    UNIQUE INDEX idx_unique_chat (owner_id, renter_id, property_id),
    
    FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (renter_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES property(property_id) ON DELETE CASCADE
);
`;

  const messagesTable = `CREATE TABLE IF NOT EXISTS messages (
    message_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    chat_id CHAR(36) NOT NULL,
    sender_id CHAR(36) NOT NULL,
    content TEXT NOT NULL,
    is_read BOOLEAN DEFAULT FALSE,
    property_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
);`;

  const sponserdTable = `CREATE TABLE IF NOT EXISTS sponsored_listings (
    promotion_id INT AUTO_INCREMENT PRIMARY KEY,
    property_id INT NOT NULL, 
    
    start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    end_date DATETIME NOT NULL,
    amount_paid DECIMAL(10,2),
    
    is_active BOOLEAN DEFAULT FALSE,
    is_paid BOOLEAN DEFAULT FALSE,
    payment_ref VARCHAR(255) DEFAULT NULL,

    FOREIGN KEY (property_id) REFERENCES property(property_id) ON DELETE CASCADE
);`;

  const reviewsTable = `CREATE TABLE IF NOT EXISTS reviews (
    review_id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
    user_id CHAR(36) NOT NULL,
    property_id INT NOT NULL,
    rent_id CHAR(36) DEFAULT NULL,
    rating DECIMAL(2, 1) NOT NULL,
    phrase TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (property_id) REFERENCES property(property_id) ON DELETE CASCADE,
    FOREIGN KEY (rent_id) REFERENCES lease(lease_id) ON DELETE SET NULL
);`;

  // --- Execution Logic ---

  conn.query(adminsTable, async (err) => {
    if (err)
      return console.error("❌ Error creating admins table:", err.message);
    console.log("✅ admins table ready");

    try {
      const superEmail = process.env.SUPERADMIN_EMAIL;
      const superPassword = process.env.SUPERADMIN_PASSWORD;
      const saltRounds = parseInt(process.env.SALT_ROUNDS || 10);

      conn.query(
        "SELECT * FROM admins WHERE role = 'super_admin' LIMIT 1",
        async (err, results) => {
          if (err) return console.error("❌ Error checking superadmin:", err);
          if (results.length === 0) {
            const hashed = await bcrypt.hash(superPassword, saltRounds);
            conn.query(
              "INSERT INTO admins (email, password, role) VALUES (?, ?, 'super_admin')",
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

  conn.query(usersTable, (err) => {
    if (err)
      return console.error("❌ Error creating users table:", err.message);
    console.log("✅ users table ready");

    const defaultUser = {
      first_name: "Default",
      second_name: "User",
      email: "default@example.com",
      password: "$2b$10$YAzxENe2MbnVNPHp0lchpuaHF4kHG9ST3SKMT/TORQu1ugukIsObq",
      is_verified: true,
    };

    const insertUserQuery = `
      INSERT IGNORE INTO users (first_name, second_name, email, password, is_verified)
      VALUES (?, ?, ?, ?, ?);
    `;

    conn.query(
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

    conn.query(propertyTable, (err) => {
      if (err)
        return console.error("❌ Error creating property table:", err.message);
      console.log("✅ property table ready");

      const dependentTables = [
        { name: "Renting Request", sql: rentingRequestTable },
        { name: "lease", sql: leaseTable },
        { name: "Invoice", sql: invoiceTable },
        { name: "Verification Requests", sql: verificationRequestsTable },
        { name: "Payment Intents", sql: paymentIntentsTable },
        { name: "Notifications", sql: notificationTable },
        { name: "Chats", sql: chatTable },
        { name: "Messages", sql: messagesTable },
        { name: "Listing Subscriptions", sql: listingSubscriptionsTable },
        { name: "Sponser Listing", sql: sponserdTable },
        { name: "reviews", sql: reviewsTable },
      ];
      dependentTables.forEach((table) => {
        conn.query(table.sql, (err) => {
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

module.exports = pool;
