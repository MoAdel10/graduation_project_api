const connection = require("../DB");
const isValidEmail = require("../Utils/valideEmail");
require("dotenv").config();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken"); // ⚠️ You forgot to import jwt

// ================= SIGNUP =================
const SignUp = async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ msg: "All fields are required" });
  }

  const { firstName, secondName, email, password, confirmPassword } = req.body;

  if (!firstName || !secondName || !email || !password || !confirmPassword) {
    return res.status(400).json({ msg: "All fields are required" });
  }

  // Validate password
  if (password !== confirmPassword || password.length < 8) {
    return res.status(400).json({
      msg: "Password and confirm password must match and be at least 8 characters",
    });
  }

  // Validate email
  if (!isValidEmail(email)) {
    return res.status(400).json({
      msg: "Invalid email address",
    });
  }

  // Check if email already exists
  connection.query("SELECT * FROM users WHERE email = ?", [email], async (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send("Database error");
    }

    if (result.length > 0) {
      return res.status(400).json({ msg: "Email is already used" });
    }

    try {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const insertSql =
        "INSERT INTO users (first_name, second_name, email, password) VALUES (?, ?, ?, ?)";
      connection.query(insertSql, [firstName, secondName, email, hashedPassword], (err, insertResult) => {
        if (err) {
          console.error("Insert error:", err);
          return res.status(500).send("Database error");
        }

        return res.status(201).json({
          msg: "User created successfully",
          userId: insertResult.insertId,
        });
      });
    } catch (error) {
      console.error("Hashing error:", error);
      return res.status(500).json({ msg: "Error while hashing password" });
    }
  });
};

// ================= LOGIN =================
const Login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ msg: "Email and password are required" });
  }

  connection.query("SELECT * FROM users WHERE email = ?", [email], async (err, result) => {
    if (err) return res.status(500).send("Database error");

    if (result.length === 0) {
      return res.status(400).json({ msg: "Invalid email or password" });
    }

    const user = result[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user.user_id, email: user.email },
      process.env.JWT_SECRET_KEY,
      { expiresIn: "3h" }
    );

    connection.query("UPDATE users SET is_online = ? WHERE user_id = ?", [true, user.user_id]);

    return res.status(200).json({
      msg: "Login successful",
      token,
      user: {
        id: user.user_id,
        firstName: user.first_name,
        secondName: user.second_name,
        email: user.email,
      },
    });
  });
};

// ================= USER PROFILE =================
const getUserProfieWithToken = (req, res) => {
  const { userId } = req.user; // ✅ Make sure you have JWT middleware that adds req.user

  if (!userId) {
    return res.status(401).json({ message: "Access denied. No userId provided." });
  }

  connection.query(
    "SELECT first_name, second_name, email, properties, favorites, is_online FROM users WHERE user_id = ?",
    [userId],
    (err, result) => {
      if (err) return res.status(500).send("Database error");
      if (result.length === 0) return res.status(404).json({ msg: "User not found" });
      return res.json({ user: result[0] });
    }
  );
};

// ================= UPDATE PROFILE ================== 

const updateUserProfile = async (req, res) => {
  const { userId } = req.user; // From verifyToken middleware
  const { firstName, secondName, email, password } = req.body;

  if (!userId) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  // Ensure at least one field to update
  if (!firstName && !secondName && !email && !password) {
    return res.status(400).json({ msg: "No fields to update" });
  }

  let updateFields = [];
  let updateValues = [];

  if (firstName) {
    updateFields.push("first_name = ?");
    updateValues.push(firstName);
  }

  if (secondName) {
    updateFields.push("second_name = ?");
    updateValues.push(secondName);
  }

  if (email) {
    updateFields.push("email = ?");
    updateValues.push(email);
  }

  if (password) {
    const hashedPassword = await bcrypt.hash(password, 10);
    updateFields.push("password = ?");
    updateValues.push(hashedPassword);
  }

  updateValues.push(userId);

  const sql = `UPDATE users SET ${updateFields.join(", ")} WHERE user_id = ?`;

  connection.query(sql, updateValues, (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).send("Database error");
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ msg: "User not found" });
    }

    return res.status(200).json({ msg: "Profile updated successfully" });
  });
};


module.exports = { SignUp, Login, getUserProfieWithToken , updateUserProfile  }; 
