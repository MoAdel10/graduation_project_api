const connection = require("../DB");
const isValidEmail = require("../Utils/valideEmail");
require("dotenv").config();
const bcrypt = require("bcrypt");

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
        // Hash password with bcrypt
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert user into database
        const insertSql =
          "INSERT INTO users (first_name, second_name, email, password) VALUES (?, ?, ?, ?)";
        connection.query(
          insertSql,
          [firstName, secondName, email, hashedPassword],
          (err, insertResult) => {
            if (err) {
              console.error("Insert error:", err);
              return res.status(500).send("Database error");
            }

            return res.status(201).json({
              msg: "User created successfully",
              userId: insertResult.insertId,
            });
          }
        );
      } catch (error) {
        console.error("Hashing error:", error);
        return res.status(500).json({ msg: "Error while hashing password" });
      }
    }
  );
};

const getUserProfieWithToken = (req, res) => {
//   let { userId } = req.body; // فقط للتجربة قبل تطبيق تسجيل الدخول
  let {userId} = req.user;
  if (!userId) {
    return res
      .status(401)
      .json({ message: "Access denied. No userId provided." });
  }

  connection.query("SELECT first_name,second_name,email,password,properties,favorites,is_online from users where user_id = ?",[userId],(err,result)=>{
    if (err) return res.status(500).send("Database error");
    return res.json({result});
  })


};

module.exports = { SignUp ,getUserProfieWithToken};
