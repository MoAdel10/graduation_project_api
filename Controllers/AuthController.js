const connection = require("../DB");
const isValidEmail = require("../Utils/valideEmail");
const { sendOTP } = require("../Utils/emailService");
const crypto = require("crypto");
const { sendPasswordResetEmail } = require("../Utils/emailService");
require("dotenv").config();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

// ================= SIGNUP =================
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
  connection.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send("Database error");
      }

      if (result.length > 0) {
        return res.status(400).json({ msg: "Email is already used" });
      }

      try {
        const saltRounds = parseInt(process.env.SALT_ROUNDS, 10) || 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const insertSql =
          "INSERT INTO users (first_name, second_name, email, password) VALUES (?, ?, ?, ?)";
        connection.query(
          insertSql,
          [firstName, secondName, email, hashedPassword],
          async (err, insertResult) => {
            if (err) {
              console.error("Insert error:", err);
              return res.status(500).send("Database error");
            }

            // Get the newly created user by email to get the UUID
            connection.query(
              "SELECT user_id FROM users WHERE email = ?",
              [email],
              async (err, userResult) => {
                if (err || userResult.length === 0) {
                  console.error("Error finding new user:", err);
                  return res.status(500).send("Database error");
                }

                const userId = userResult[0].user_id;

                // Generate 6-digit OTP
                const otp = Math.floor(
                  100000 + Math.random() * 900000,
                ).toString();
                const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // expires in 10 minutes

                // Save OTP in database using the actual UUID
                connection.query(
                  "UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE user_id = ?",
                  [otp, otpExpiresAt, userId],
                  async (err2) => {
                    if (err2) {
                      console.error("❌ Error saving OTP:", err2);
                    } else {
                      // Send OTP via email
                      try {
                        await sendOTP(email, otp);
                      } catch (emailError) {
                        console.error(
                          "❌ Error sending OTP email:",
                          emailError,
                        );
                      }
                    }
                  },
                );

                // Return success response with actual UUID
                return res.status(201).json({
                  msg: "User created successfully. Please verify your email.",
                  userId: userId, // ← Now this will be the actual UUID!
                });
              },
            );
          },
        );
      } catch (error) {
        console.error("Hashing error:", error);
        return res.status(500).json({ msg: "Error while hashing password" });
      }
    },
  );
};
// ==================== Request OTP ============================
const requestOTP = (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ msg: "Email is required" });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // expires in 10 minutes

  connection.query(
    "UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE email = ?",
    [otp, otpExpiresAt, email],
    async (err) => {
      if (err) {
        console.error("❌ Error saving OTP:", err);
        return res.status(500).json({ msg: "Internal server error" });

      } else {
        // Send OTP via email
        try {
          await sendOTP(email, otp);
          return res.status(200).json({ msg: "OTP sent successfully" });
        } catch (emailError) {
          console.error("❌ Error sending OTP email:", emailError);
          return res.status(500).json({ msg: "Internal server error" });
        }
      }
    },
  );
};

// ==================== Verify OTP ============================
const verifyOTP = (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ msg: "Email and OTP are required" });
  }

  connection.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send("Database error");
      }

      if (result.length === 0) {
        return res.status(404).json({ msg: "User not found" });
      }

      const user = result[0];

      if (user.is_verified) {
        return res.status(400).json({ msg: "User already verified" });
      }

      if (user.otp_code !== otp) {
        return res.status(400).json({ msg: "Invalid OTP" });
      }

      if (new Date() > new Date(user.otp_expires_at)) {
        return res.status(400).json({ msg: "OTP expired" });
      }

      // Update user to verified
      connection.query(
        "UPDATE users SET is_verified = ?, otp_code = NULL, otp_expires_at = NULL WHERE user_id = ?",
        [true, user.user_id],
        (updateErr) => {
          if (updateErr) {
            console.error("Database error:", updateErr);
            return res.status(500).send("Database error");
          }

          return res.status(200).json({ msg: "Email verified successfully" });
        },
      );
    },
  );
};

// ================= REQUEST PASSWORD RESET =================
const requestPasswordReset = (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ msg: "Email is required" });

  connection.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    (err, result) => {
      if (err) return res.status(500).send("Database error");
      if (result.length === 0)
        return res.status(404).json({ msg: "User not found" });

      const user = result[0];
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min

      connection.query(
        "UPDATE users SET reset_token = ?, reset_expires_at = ? WHERE user_id = ?",
        [resetToken, resetExpires, user.user_id],
        async (err2) => {
          if (err2) return res.status(500).send("Database error");

          const resetLink = `http://localhost:8000/auth/reset-password/${resetToken}`;
          await sendPasswordResetEmail(email, resetLink);

          return res
            .status(200)
            .json({ msg: "Password reset link sent to your email" });
        },
      );
    },
  );
};

// ================= VERIFY RESET TOKEN =================
const verifyResetToken = (req, res) => {
  const { token } = req.params;

  connection.query(
    "SELECT * FROM users WHERE reset_token = ? AND reset_expires_at > NOW()",
    [token],
    (err, result) => {
      if (err) return res.status(500).send("Database error");
      if (result.length === 0)
        return res.status(400).json({ msg: "Invalid or expired token" });

      return res.status(200).json({ msg: "Token is valid" });
    },
  );
};

// ================= RESET PASSWORD =================
const resetPassword = async (req, res) => {
  const { token } = req.params;
  const { newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res
      .status(400)
      .json({ msg: "Password must be at least 8 characters" });
  }

  connection.query(
    "SELECT * FROM users WHERE reset_token = ? AND reset_expires_at > NOW()",
    [token],
    async (err, result) => {
      if (err) return res.status(500).send("Database error");
      if (result.length === 0)
        return res.status(400).json({ msg: "Invalid or expired token" });

      const user = result[0];
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      connection.query(
        "UPDATE users SET password = ?, reset_token = NULL, reset_expires_at = NULL WHERE user_id = ?",
        [hashedPassword, user.user_id],
        (err2) => {
          if (err2) return res.status(500).send("Database error");
          return res.status(200).json({ msg: "Password reset successfully" });
        },
      );
    },
  );
};

// ================= LOGIN =================
const Login = async (req, res) => {
  if (!req.body || Object.keys(req.body).length === 0) {
    return res.status(400).json({ msg: "Email and password are required" });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ msg: "Email and password are required" });
  }

  connection.query(
    "SELECT * FROM users WHERE email = ?",
    [email],
    async (err, result) => {
      if (err) return res.status(500).send("Database error");

      if (result.length === 0) {
        return res.status(400).json({ msg: "Invalid email or password" });
      }

      const user = result[0];

      // ✅ ensure the user verified their email before login
      if (!user.is_verified) {
        return res
          .status(403)
          .json({ msg: "Please verify your email before logging in" });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(400).json({ msg: "Invalid email or password" });
      }

      const token = jwt.sign(
        { userId: user.user_id, email: user.email,is_verified:user.is_verified },
        process.env.JWT_SECRET_KEY,
        { expiresIn: "3h" },
      );

      connection.query("UPDATE users SET is_online = ? WHERE user_id = ?", [
        true,
        user.user_id,
      ]);

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
    },
  );
};

// ================= USER PROFILE =================
const getUserProfieWithToken = (req, res) => {
  const { userId } = req.user;

  if (!userId) {
    return res
      .status(401)
      .json({ message: "Access denied. No userId provided." });
  }

  connection.query(
    "SELECT first_name, second_name, email, properties, favorites, is_online, is_verified FROM users WHERE user_id = ?",
    [userId],
    (err, result) => {
      if (err) return res.status(500).send("Database error");
      if (result.length === 0)
        return res.status(404).json({ msg: "User not found" });

      const user = result[0];
      return res.json({ user });
    },
  );
};

// ================= UPDATE PROFILE ==================
const updateUserProfile = async (req, res) => {
  const { userId } = req.user;
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

// ================= LOGOUT =================
const Logout = (req, res) => {
  const { userId } = req.user;

  if (!userId) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  connection.query(
    "UPDATE users SET is_online = ? WHERE user_id = ?",
    [false, userId],
    (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).send("Database error");
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ msg: "User not found" });
      }

      return res.status(200).json({ msg: "User logged out successfully" });
    },
  );
};

module.exports = {
  SignUp,
  verifyOTP,
  Login,
  getUserProfieWithToken,
  updateUserProfile,
  Logout,
  requestPasswordReset,
  verifyResetToken,
  resetPassword,
  requestOTP
};
