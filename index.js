// index.js
import express from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import admin from "firebase-admin";
import fs from "fs";

// ✅ Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Load Firebase service account key
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Google OAuth client (used for both web + Android)
const ANDROID_CLIENT_ID = "445520681231-v2m8ilhhecf8k4466fg8v2i5h44oi654.apps.googleusercontent.com";
const WEB_CLIENT_ID = "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com";
const oauth2Client = new google.auth.OAuth2(
  WEB_CLIENT_ID,
  "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",
  "https://google-auth-backend-y2jp.onrender.com/auth/google/callback"
);

// ✅ Health check route
app.get("/", (req, res) => {
  res.send("✅ Google Auth backend is running!");
});


// ====================================================
// 🌐 1️⃣ Android flow — receives ID token, verifies it,
// and returns Firebase custom token
// ====================================================
app.post("/google-login", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) throw new Error("No idToken received");

    console.log("=== /google-login NEW REQUEST ===");
    console.log("Received idToken length:", idToken.length);

    // Verify the Google ID token from Android
    const client = new OAuth2Client(ANDROID_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: ANDROID_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    console.log("verifyIdToken payload:", payload);

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid);
    console.log("Created firebase custom token length:", firebaseToken.length);

    res.json({ token: firebaseToken });
  } catch (err) {
    console.error("google-login error:", err);
    res.status(400).json({ error: err.message });
  }
});


// ====================================================
// 🌐 2️⃣ Web OAuth flow — logs in via browser
// ====================================================
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    const firebaseToken = await admin.auth().createCustomToken(uid);

    res.send(`
      <html>
        <body>
          <h2>✅ Login successful!</h2>
          <p>Copy this Firebase token and paste it in your app for testing:</p>
          <textarea rows="10" cols="80">${firebaseToken}</textarea>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("callback error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});


// ✅ Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
