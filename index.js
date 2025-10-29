// index.js
import express from "express";
import cors from "cors";
import { google } from "googleapis";
import admin from "firebase-admin";
import fs from "fs";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Load Firebase service account
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Secrets
const SESSION_SECRET = "replace_this_with_a_long_random_secret";

// ✅ Google OAuth setup
const WEB_CLIENT_ID = "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com";
const WEB_CLIENT_SECRET = "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";
const REDIRECT_URI = "https://google-auth-backend-y2jp.onrender.com/auth/google/callback";

const oauth2Client = new google.auth.OAuth2(WEB_CLIENT_ID, WEB_CLIENT_SECRET, REDIRECT_URI);

// ✅ Root check
app.get("/", (req, res) => {
  res.send("✅ Secure Google Auth backend is running!");
});

// ✅ Step 1: App tells server to start Google login
app.get("/auth/google/mobile", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
  });
  console.log("🌐 Redirecting to Google OAuth:", url);
  res.redirect(url);
});

// ✅ Step 2: Google calls back after user chooses account
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

    console.log(`✅ Web user: ${payload.email} → Firebase user ensuring...`);

    // ✅ Ensure user exists in Firebase
    const userRecord =
      (await admin.auth().getUser(uid).catch(() => null)) ||
      (await admin.auth().createUser({
        uid,
        email: payload.email,
        displayName: payload.name,
        photoURL: payload.picture,
      }));

    // ✅ Create your own session token (not Firebase token)
    const sessionToken = jwt.sign(
      {
        uid: userRecord.uid,
        email: userRecord.email,
      },
      SESSION_SECRET,
      { expiresIn: "2h" }
    );

    console.log("✅ Created session token, redirecting back to app...");
    // redirect back to Android app with the session token
    res.redirect(`mosha://auth?sessionToken=${sessionToken}`);
  } catch (err) {
    console.error("❌ Google OAuth callback error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

// ✅ Step 3: Endpoint to verify session token (for app API calls)
app.post("/verify-session", (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    res.json({ valid: true, uid: decoded.uid, email: decoded.email });
  } catch (err) {
    res.status(401).json({ valid: false, error: "Invalid or expired token" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Secure backend running on port ${PORT}`));
