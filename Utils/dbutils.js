const connection = require("../DB");

// Fetch all admins
const getAllAdmins = () => {
  return new Promise((resolve, reject) => {
    const sql = "SELECT admin_id, email, role FROM Admins";
    connection.query(sql, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Fetch all users
const getAllUsers = () => {
  return new Promise((resolve, reject) => {
    const sql = "SELECT user_id, first_name,second_name, email FROM Users";
    connection.query(sql, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

// Fetch all properties
const getAllProperties = () => {
  return new Promise((resolve, reject) => {
    const sql = "SELECT property_id, property_name, location,is_verified FROM property";
    connection.query(sql, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

const getProperty = (id) => {
  return new Promise((resolve, reject) => {
    const sql = "SELECT * FROM property where property_id = ?";
    connection.query(sql,[id], (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

const getLatestRequestIDByProperty = (property_id) => {
  return new Promise((resolve, reject) => {
    // Sort by created_at descending and take the top 1
    const sql = `
      SELECT request_id 
      FROM VerificationRequests 
      WHERE property_id = ? AND status = 'pending'
      ORDER BY created_at DESC 
      LIMIT 1
    `;

    connection.query(sql, [property_id], (err, results) => {
      if (err) return reject(err);
      // Return the ID string if found, otherwise null
      resolve(results.length > 0 ? results[0].request_id : null);
    });
  });
};

const getAllVerifcationRequests = () => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT 
        vr.request_id, 
        vr.status, 
        vr.created_at,
        p.property_id, 
        p.property_name, 
        p.location,
        u.first_name, 
        u.second_name, 
        u.email AS owner_email
      FROM VerificationRequests vr
      INNER JOIN Property p ON vr.property_id = p.property_id
      INNER JOIN Users u ON p.owner_id = u.user_id
      INNER JOIN (
        -- Subquery to find the latest request timestamp per property
        SELECT property_id, MAX(created_at) as latest_request
        FROM VerificationRequests
        WHERE status = 'pending'
        GROUP BY property_id
      ) latest ON vr.property_id = latest.property_id AND vr.created_at = latest.latest_request
      WHERE vr.status = 'pending'
      ORDER BY vr.created_at DESC;
    `;

    connection.query(sql, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

module.exports = {
  getAllAdmins,
  getAllUsers,
  getAllProperties,
  getAllVerifcationRequests,
  getProperty,
  getLatestRequestIDByProperty,
};
