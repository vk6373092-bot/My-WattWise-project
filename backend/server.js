require("dotenv").config();
console.log("OPENAI KEY:", process.env.OPENAI_API_KEY ? "Loaded ✅" : "Missing ❌");

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const cors = require("cors");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

// ===================== 🔁 OFFLINE RANDOM AI (NO OPENAI) =====================

const buyerTips = [
  "Use heavy appliances during off-peak hours to save money ⏰",
  "Switch to LED bulbs and 5-star appliances for lower bills 💡",
  "Turn off devices at the switch to avoid standby power loss 🔌",
  "Clean AC filters monthly to improve cooling efficiency ❄️",
  "Use natural light in daytime instead of electric lights ☀️",
  "Avoid using multiple high-power devices at the same time ⚡",
  "Run washing machines with full load to save energy 💦",
  "Unplug chargers when not in use to prevent power drain 🔋"
];

const adminTips = [
  "Offer limited-time off-peak discounts to boost conversions 📉",
  "Reduce platform fee on low-sales days to attract more buyers 💰",
  "Promote eco-savings badges to increase user trust 🌱",
  "Run referral campaigns to increase daily visitors 🤝",
  "Send reminders during low-traffic hours to bring users back 📢",
  "Show carbon savings stats on dashboard for engagement 🌍",
  "Bundle electricity units with cashback to improve sales 💳",
  "Highlight price drops prominently on buyer dashboard 👀"
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// -------- CORS (allow all origins during dev) --------
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

// -------- Session --------
app.use(session({
  secret: process.env.SESSION_SECRET || "wattwise-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true }
}));

app.use(passport.initialize());
app.use(passport.session());

// -------- MongoDB --------
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Error:", err.message);
    process.exit(1);
  });

// -------- Models --------
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  place: String,
  password: String,
  googleId: String
}, { timestamps: true });
const User = mongoose.model("User", userSchema);

const rateSchema = new mongoose.Schema({
  value: Number,
  updatedAt: { type: Date, default: Date.now }
});
const Rate = mongoose.model("Rate", rateSchema);

const settingsSchema = new mongoose.Schema({
  rate: Number,
  amount: Number,
  updatedAt: { type: Date, default: Date.now }
});
const Settings = mongoose.model("Settings", settingsSchema);

const pdfSchema = new mongoose.Schema({
  filename: String,
  uploadedAt: { type: Date, default: Date.now }
});
const Pdf = mongoose.model("Pdf", pdfSchema);

const visitSchema = new mongoose.Schema({
  date: String,
  count: Number,
  buyers: Number,
  revenue: Number
});
const Visit = mongoose.model("Visit", visitSchema);

const noticeSchema = new mongoose.Schema({
  title: String,
  message: String,
  pdf: String,
  createdAt: { type: Date, default: Date.now }
});
const Notice = mongoose.model("Notice", noticeSchema);

const platformFeeSchema = new mongoose.Schema({
  amount: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now }
});
const PlatformFee = mongoose.model("PlatformFee", platformFeeSchema);

// ===================== 🧾 MANUAL UPI PAYMENT VERIFICATION (ADMIN ONLY) =====================

const paymentRequestSchema = new mongoose.Schema({
  userId: String,
  name: String,
  userEmail: String,

  amount: Number,
  units: Number,         // ✅ must exist
  rate: Number,          // ✅ must exist
  platformFee: Number,  // ✅ must exist

  utr: String,
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now }
});
const PaymentRequest = mongoose.model("PaymentRequest", paymentRequestSchema);

// ===================== 🧾 PURCHASE HISTORY (AFTER ADMIN APPROVAL) =====================

const purchaseSchema = new mongoose.Schema({
  userEmail: String,
  units: Number,
  rateAtPurchase: Number,
  platformFeeAtPurchase: Number,
  totalAmount: Number,
  paymentRef: String,
  status: { type: String, default: "approved" },
  createdAt: { type: Date, default: Date.now }
});
const Purchase = mongoose.model("Purchase", purchaseSchema);

// -------- Google OAuth --------
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: "http://localhost:5000/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name: profile.displayName,
        email,
        googleId: profile.id
      });
    }
    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  const user = await User.findById(id);
  done(null, user);
});

// -------- File Upload (PDF) --------
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf") {
      return cb(new Error("Only PDF allowed"));
    }
    cb(null, true);
  }
});

app.use("/uploads", express.static(uploadDir));

// -------- Health --------
app.get("/", (req, res) => res.send("Backend OK 🚀"));
app.get("/api/health", (req, res) => res.json({ status: "ok", time: Date.now() }));

// -------- Auth --------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, place, password } = req.body;
    if (!name || !email || !place || !password)
      return res.status(400).json({ msg: "All fields required" });

    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ msg: "User already exists" });

    const hash = await bcrypt.hash(password, 12);
    await User.create({ name, email, place, password: hash });

    res.status(201).json({ msg: "Registered successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // ===================== 🛑 HARDCODED ADMIN LOGIN 🛑 =====================
    // This allows you to log in with "admin" and "admin@123" directly
    if (email === "admin" && password === "admin@123") {
      return res.json({ role: "admin", msg: "Admin login success" });
    }

    if (email === process.env.ADMIN_EMAIL) {
      const ok = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
      if (!ok) return res.status(401).json({ msg: "Invalid admin credentials" });
      return res.json({ role: "admin", msg: "Admin login success" });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: "Invalid credentials" });
    if (!user.password) return res.status(400).json({ msg: "Use Google Login" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ msg: "Invalid credentials" });

    res.json({ role: "buyer", msg: "Login success", name: user.name, email: user.email });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// -------- Settings / Rate --------
app.post("/api/admin/settings", async (req, res) => {
  const { rate, amount } = req.body;
  const r = Number(rate);
  const a = Number(amount);

  if (isNaN(r) || r <= 0 || isNaN(a) || a <= 0)
    return res.status(400).json({ msg: "Rate & Amount must be positive" });

  await Settings.deleteMany({});
  await Settings.create({ rate: r, amount: a });

  await Rate.deleteMany({});
  await Rate.create({ value: r });

  res.json({ msg: "Settings updated" });
});

app.get("/api/rate", async (req, res) => {
  try {
    const rate = await Rate.findOne().sort({ updatedAt: -1 });
    res.json({ rate: rate ? rate.value : 0 });
  } catch (err) {
    console.error("GET RATE ERROR:", err);
    res.status(500).json({ msg: "Failed to fetch rate" });
  }
});

app.post("/api/rate", async (req, res) => {
  try {
    const { rate } = req.body;
    const r = Number(rate);

    if (isNaN(r) || r <= 0)
      return res.status(400).json({ msg: "Rate must be positive number" });

    await Rate.deleteMany({});
    const saved = await Rate.create({ value: r });

    res.json({ msg: "Electricity rate updated", rate: saved.value });
  } catch (err) {
    console.error("UPDATE RATE ERROR:", err);
    res.status(500).json({ msg: "Failed to update rate" });
  }
});

// -------- Platform Fee --------
app.post("/api/admin/platform-fee", async (req, res) => {
  try {
    const { fee } = req.body;
    const f = Number(fee);

    if (isNaN(f) || f < 0)
      return res.status(400).json({ msg: "Platform fee must be >= 0" });

    await PlatformFee.deleteMany({});
    const saved = await PlatformFee.create({ amount: f });

    res.json({ msg: "Platform fee updated", fee: saved.amount });
  } catch (err) {
    console.error("PLATFORM FEE ERROR:", err);
    res.status(500).json({ msg: "Failed to update platform fee" });
  }
});

app.get("/api/platform-fee", async (req, res) => {
  try {
    let fee = await PlatformFee.findOne().sort({ updatedAt: -1 });
    if (!fee) fee = await PlatformFee.create({ amount: 0 });
    res.json({ fee: fee.amount });
  } catch (err) {
    console.error("GET PLATFORM FEE ERROR:", err);
    res.status(500).json({ msg: "Failed to fetch platform fee" });
  }
});

// -------- Manual UPI Payment Request (Buyer) --------
app.post("/api/payment/request", async (req, res) => {
  try {
    const { userId, name, userEmail, amount, utr, units, rate, platformFee } = req.body;
    await PaymentRequest.create({ userId, name, userEmail, amount, utr, units, rate, platformFee });
    res.json({ msg: "Payment request sent to admin" });
  } catch (err) {
    console.error("PAYMENT REQUEST ERROR:", err);
    res.status(500).json({ msg: "Failed to send request" });
  }
});

// -------- Admin fetch pending payments --------
app.get("/api/admin/pending-payments", async (req, res) => {
  try {
    const list = await PaymentRequest.find({ status: "pending" }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error("FETCH PENDING ERROR:", err);
    res.status(500).json({ msg: "Failed to fetch pending payments" });
  }
});

// -------- Admin delete notice --------
app.delete("/api/admin/notices/:id", async (req, res) => {
  try {
    await Notice.findByIdAndDelete(req.params.id);
    res.json({ msg: "Notice deleted" });
  } catch (e) {
    res.status(500).json({ msg: "Delete failed" });
  }
});

// -------- Admin verify / reject payment --------
app.post("/api/admin/verify-payment", async (req, res) => {
  try {
    const { id, approved } = req.body;
    const pay = await PaymentRequest.findById(id);
    if (!pay) return res.status(404).json({ msg: "Payment not found" });

    pay.status = approved ? "approved" : "rejected";
    await pay.save();

    if (approved) {
      await Purchase.create({
        userEmail: pay.userEmail,
        units: pay.units || 0,
        rateAtPurchase: pay.rate || 0,
        platformFeeAtPurchase: pay.platformFee || 0,
        totalAmount: pay.amount,
        paymentRef: pay.utr || ("UPI-" + Date.now()),
        status: "approved"
      });
    }

    res.json({ msg: approved ? "Payment Verified Successfully ✅" : "Payment Rejected ❌" });
  } catch (err) {
    console.error("VERIFY ERROR:", err);
    res.status(500).json({ msg: "Verification failed" });
  }
});

// -------- Get Payment History (Buyer) --------
app.get("/api/payment/history", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ msg: "Email is required" });

    const history = await Purchase.find({ userEmail: email }).sort({ createdAt: -1 });
    res.json(history);
  } catch (e) {
    console.error("FETCH HISTORY ERROR:", e);
    res.status(500).json({ msg: "Failed to fetch history" });
  }
});

// -------- Clear Purchase History (Buyer) --------
app.delete("/api/payment/history", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ msg: "Email is required" });

    await Purchase.deleteMany({ userEmail: email });

    res.json({ msg: "Purchase history cleared successfully 🧹" });
  } catch (e) {
    console.error("CLEAR HISTORY ERROR:", e);
    res.status(500).json({ msg: "Failed to clear history" });
  }
});

// -------- Notices --------
app.post("/api/admin/notices", upload.single("pdf"), async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title || !message)
      return res.status(400).json({ msg: "Title and message required" });

    const pdf = req.file ? req.file.filename : null;
    await Notice.create({ title, message, pdf });

    res.json({ msg: "Notice posted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

app.get("/api/user/notices", async (req, res) => {
  const list = await Notice.find().sort({ createdAt: -1 });
  res.json(list);
});

// -------- Visitors --------
app.post("/api/visit", async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  let v = await Visit.findOne({ date: today });

  if (!v) v = await Visit.create({ date: today, count: 1, buyers: 0, revenue: 0 });
  else { v.count++; await v.save(); }

  res.json({ msg: "Visit counted" });
});

app.get("/api/admin/visits", async (req, res) => {
  const data = await Visit.find().sort({ date: 1 });
  res.json(data);
});

// -------- Buyer Offline AI --------
app.post("/api/ai/advice", async (req, res) => {
  try {
    const tips = new Set();
    while (tips.size < 4) tips.add(randomFrom(buyerTips));
    res.json({ advice: [...tips].map(t => "💡 " + t).join("\n") });
  } catch (err) {
    console.error("BUYER AI ERROR:", err);
    res.json({ advice: randomFrom(buyerTips) });
  }
});

// -------- Admin Offline AI --------
app.post("/api/ai/admin-advice", async (req, res) => {
  try {
    const { visitors = 0, buyers = 0, revenue = 0 } = req.body;
    const conversion = visitors > 0 ? (buyers / visitors) : 0;

    let revenueTip = randomFrom(adminTips);
    let pricingTip = randomFrom(adminTips);
    let growthTip = randomFrom(adminTips);
    let sustainabilityTip = randomFrom(adminTips);
    let prediction = "📈 Tomorrow may see similar traffic if promotions continue.";

    if (conversion < 0.2) growthTip = "⚠️ Conversion is low. Simplify checkout.";
    if (revenue < 5000) revenueTip = "📉 Revenue low. Run flash offers today.";

    const advice = `
💡 Revenue: ${revenueTip}
💡 Pricing: ${pricingTip}
💡 Growth: ${growthTip}
💡 Sustainability: ${sustainabilityTip}
🔮 Prediction: ${prediction}
    `.trim();

    res.json({ advice });
  } catch (err) {
    console.error("ADMIN AI ERROR:", err);
    res.json({ advice: randomFrom(adminTips) });
  }
});

// -------- Google OAuth --------
app.get("/auth/google", passport.authenticate("google", { scope: ["profile", "email"] }));
app.get("/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "http://localhost:3000/login.html" }),
  (req, res) => res.redirect("http://localhost:3000/buyer.html")
);







// app.post("/api/ai/advice", async (req, res) => {
//   try {
//     const { userEmail } = req.body;

//     const history = await Purchase.find({ userEmail }).sort({ createdAt: -1 }).limit(5);
//     const rateDoc = await Rate.findOne().sort({ updatedAt: -1 });
//     const feeDoc = await PlatformFee.findOne().sort({ updatedAt: -1 });

//     const rate = rateDoc?.value || 0;
//     const platformFee = feeDoc?.amount || 0;

//     const historyText = history.length
//       ? history.map(h => `Bought ${h.units} kWh for ₹${h.totalAmount}`).join("\n")
//       : "No purchase history yet.";

//     const prompt = `
// You are an energy advisor for an electricity app.

// User recent purchases:
// ${historyText}

// Current rate: ₹${rate}
// Platform fee: ₹${platformFee}

// Give:
// • 3 different money-saving tips
// • 1 eco-friendly habit

// Respond in 4 bullet points.
// Change wording every time.
// `;

//     const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
//       },
//       body: JSON.stringify({
//         model: "gpt-4.1-mini",
//         messages: [{ role: "user", content: prompt }],
//         temperature: 1.1,
//         max_tokens: 180
//       })
//     });

//     const data = await aiRes.json();
//     console.log("BUYER AI RAW:", JSON.stringify(data, null, 2));

//     if (data.error) {
//       console.error("OPENAI ERROR:", data.error);
//       return res.json({ advice: "AI temporarily unavailable. Try again later ⚠️" });
//     }

//     res.json({ advice: data.choices[0].message.content });

//   } catch (err) {
//     console.error("AI ADVICE ERROR:", err);
//     res.json({ advice: "AI service is down. Please retry later ⚠️" });
//   }
// });



// app.post("/api/ai/admin-advice", async (req, res) => {
//   try {
//     const today = new Date().toISOString().slice(0, 10);

//     const visit = await Visit.findOne({ date: today });
//     const rateDoc = await Rate.findOne().sort({ updatedAt: -1 });
//     const feeDoc = await PlatformFee.findOne().sort({ updatedAt: -1 });

//     const visitors = visit?.count || 0;
//     const buyers = visit?.buyers || 0;
//     const revenue = visit?.revenue || 0;
//     const rate = rateDoc?.value || 0;
//     const fee = feeDoc?.amount || 0;

//     const prompt = `
// You are a business advisor for an energy marketplace.

// Stats:
// Visitors: ${visitors}
// Buyers: ${buyers}
// Revenue: ₹${revenue}
// Rate: ₹${rate}
// Platform fee: ₹${fee}

// Give:
// • 1 revenue growth idea
// • 1 pricing tweak
// • 1 sustainability idea
// • 1 short prediction for tomorrow

// Respond in bullets.
// Change wording every time.
// `;

//     const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
//       },
//       body: JSON.stringify({
//         model: "gpt-4.1-mini",
//         messages: [{ role: "user", content: prompt }],
//         temperature: 1.1,
//         max_tokens: 200
//       })
//     });

//     const data = await aiRes.json();
//     console.log("ADMIN AI RAW:", JSON.stringify(data, null, 2));

//     if (data.error) {
//       console.error("OPENAI ERROR:", data.error);
//       return res.json({ advice: "AI unavailable currently. Try later ⚠️" });
//     }

//     res.json({ advice: data.choices[0].message.content });

//   } catch (err) {
//     console.error("ADMIN AI ERROR:", err);
//     res.json({ advice: "AI service is temporarily down ⚠️" });
//   }
// });



// -------- Start --------
app.listen(5000, () => {
  console.log("🚀 Backend running at http://localhost:5000");
});
