const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String }, // only for email/password users
    role: { type: String, enum: ["buyer", "owner"], default: "buyer" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
