const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function sendOTP(email, otp) {
    const mailOptions = {
        from: `"RealEstate Platform" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Your OTP Verification Code",
        text: `Your OTP code is ${otp}. It will expire in 10 minutes.`,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP sent to ${email}`);
}

async function sendPasswordResetEmail(email, resetLink) {
    const mailOptions = {
        from: `"RealEstate Platform" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Password Reset Request",
        text: `You requested to reset your password. Click the link below to set a new one:\n\n${resetLink}\n\nThis link will expire in 15 minutes.`,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset link sent to ${email}`);
}

module.exports = { sendOTP, sendPasswordResetEmail };
