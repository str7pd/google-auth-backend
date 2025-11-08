// index.js
import express from "express";
import cors from "cors";
import { google } from "googleapis";
import admin from "firebase-admin";
import fs from "fs";
import jwt from "jsonwebtoken";
import fetch from "node-fetch"; // For time check

// 🌍 Time check (optional but helpful for debugging)
(async () => {
  try {
    const res = await fetch("https://www.google.com");
    const dateHeader = res.headers.get("date");
    console.log("🌍 Google time:", dateHeader);
    console.log("🕒 Server time:", new Date().toUTCString());
  } catch (err) {
    console.error("⚠️ Could not fetch Google time", err);
  }
})();
console.log("🕒 Server start time:", new Date().toISOString());

// ✅ Express setup
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Load Firebase service account (stored as an environment variable)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Environment secrets
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret_fallback";
const WEB_CLIENT_ID = "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com";
const WEB_CLIENT_SECRET = process.env.WEB_CLIENT_SECRET;
const REDIRECT_URI = "https://google-auth-backend-y2jp.onrender.com/auth/google/callback";

const oauth2Client = new google.auth.OAuth2(WEB_CLIENT_ID, WEB_CLIENT_SECRET, REDIRECT_URI);

// ✅ Root check
app.get("/", (req, res) => {
  res.send("✅ Secure Google Auth backend is running!");
});

// ✅ Step 1: Mobile app requests login → redirect to Google
app.get("/auth/google/mobile", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["profile", "email"],
  redirect_uri: REDIRECT_URI, // ✅ force match
});

  console.log("🌐 Redirecting to Google OAuth:", url);
  res.redirect(url);
});

// ✅ Step 2: Google calls back after user chooses account
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      throw new Error("Missing ?code in callback URL — check redirect URI & OAuth config");
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Verify Google ID token
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    console.log(`✅ Web user: ${payload.email} → Ensuring Firebase user...`);

    // ✅ Ensure user exists in Firebase
    const userRecord =
      (await admin.auth().getUser(uid).catch(() => null)) ||
      (await admin.auth().createUser({
        uid,
        email: payload.email,
        displayName: payload.name,
        photoURL: payload.picture,
      }));

    // ✅ Create secure session token (JWT)
    // ✅ New: Create a Firebase custom token
const firebaseCustomToken = await admin.auth().createCustomToken(userRecord.uid);
res.redirect(`mosha://auth?firebaseToken=${firebaseCustomToken}`);


    console.log("✅ Created session token, redirecting back to app...");
  } catch (err) {
    console.error("❌ Google OAuth callback error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

// ✅ Step 3: Verify session token (for app API requests)
app.post("/verify-session", (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    res.json({ valid: true, uid: decoded.uid, email: decoded.email });
  } catch (err) {
    res.status(401).json({ valid: false, error: "Invalid or expired token" });
  }
});
app.post("/mobile/verifyToken", async (req, res) => {
  const { firebaseToken } = req.body;
  try {
    // Verify the custom token using Admin SDK
const decoded = await admin.auth().verifySessionCookie(token, true);

    // Create your own session cookie for the app
    const sessionCookie = await admin.auth().createSessionCookie(firebaseToken, {
      expiresIn: 1000 * 60 * 60 * 24 * 7, // 7 days
    });

    res.json({
      status: "ok",
      session: sessionCookie,
      user: decoded,
    });
  } catch (err) {
    console.error("❌ verifyToken failed:", err);
    res.status(401).json({ status: "error", message: err.message });
  }
});


// ✅ Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Secure backend running on port ${PORT}`));
