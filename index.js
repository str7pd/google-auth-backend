import express from "express";
import cors from "cors";
import { google } from "googleapis";
import admin from "firebase-admin";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Initialize Firebase Admin SDK
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// 🧩 Google OAuth2 setup
const oauth2Client = new google.auth.OAuth2(
  "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com",
  "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",
  "https://google-auth-backend-y2jp.onrender.com/auth/google/callback"
);

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("✅ Google Auth backend is running!");
});

// 🌐 Step 1: Redirect user to Google login page
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
  });
  res.redirect(url);
});

// 🌐 Step 2: Handle callback from Google
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Decode user info
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    // ✅ Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid);

    // ✅ Return JSON instead of HTML
    res.json({
      status: "success",
      message: "Login successful",
      token: firebaseToken,
      user: {
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
      },
    });

  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Error during Google OAuth login" });
  }
});

// ✅ Android app direct login endpoint
app.post("/google-login", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: "Missing idToken" });

    const ticket = await oauth2Client.verifyIdToken({
      idToken,
      audience: "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    const firebaseToken = await admin.auth().createCustomToken(uid);

    res.json({ token: firebaseToken });
  } catch (err) {
    console.error("Error verifying token:", err);
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
