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
    const sql = "SELECT property_id, property_name, location FROM property";
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
};
