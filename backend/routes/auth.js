const express = require("express");
const passport = require("passport");
const { register, login } = require("../controllers/authController");

const router = express.Router();

// Email/Password auth
router.post("/register", register);
router.post("/login", login);

// Google OAuth
router.get("/google", passport.authenticate("google", { scope: ["profile", "email"] }));

router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: process.env.FRONTEND_URL + "/login.html" }),
  (req, res) => {
    if (req.user.role === "owner") {
      res.redirect(process.env.FRONTEND_URL + "/admin.html");
    } else {
      res.redirect(process.env.FRONTEND_URL + "/buyer.html");
    }
  }
);

module.exports = router;
