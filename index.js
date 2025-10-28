import express from "express";
import cors from "cors";
import fs from "fs";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import admin from "firebase-admin";

// ✅ Setup Express
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Load Firebase Admin SDK
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Google Client IDs
const ANDROID_CLIENT_ID = "445520681231-iap0aurss1b9jqg5f3ahsudcivhv96p5.apps.googleusercontent.com";
const WEB_CLIENT_ID = "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com";

// ✅ Create OAuth2 client for Web
const oauth2Client = new google.auth.OAuth2(
  WEB_CLIENT_ID,
  "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",
  "https://google-auth-backend-y2jp.onrender.com/auth/google/callback"
);

// ✅ Health Check
app.get("/", (req, res) => res.send("✅ Google Auth backend for MOSHA is running!"));

// ============================================================
// 📱 ANDROID LOGIN
// Receives ID token from app, verifies, and returns Firebase token
// ============================================================
app.post("/google-login", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) throw new Error("No idToken received");

    console.log("=== [ANDROID] /google-login ===");
    console.log("Received ID Token length:", idToken.length);

    // Verify Google ID token (Android flow)
    const client = new OAuth2Client(ANDROID_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: ANDROID_CLIENT_ID, // ⚠️ MUST match Android client ID
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;
    console.log("✅ Android token verified for user:", payload.email);

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid);
    console.log("✅ Firebase custom token created (length:", firebaseToken.length, ")");

    res.json({ token: firebaseToken });
  } catch (err) {
    console.error("❌ [ANDROID] google-login error:", err);
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// 🌍 WEB LOGIN
// Redirects user to Google consent, verifies, and returns Firebase token
// ============================================================
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
  });
  console.log("🌐 Redirecting to Google OAuth:", url);
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Verify ID token from Google
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: WEB_CLIENT_ID, // ⚠️ Must match Web client ID
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid);
    console.log("✅ Web user:", payload.email, "→ Firebase token created");

    // Return Firebase token as a simple page
    res.send(`
      <html>
        <body style="font-family:sans-serif;padding:24px;">
          <h2>✅ Login Successful!</h2>
          <p>Copy this Firebase token and paste it into your app (for testing):</p>
          <textarea rows="10" cols="80">${firebaseToken}</textarea>
          <br/><br/>
          <p style="color:#888">Now you can paste this into your Android app if needed.</p>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ [WEB] callback error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

// ============================================================
// 🚀 Start server
// ============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
