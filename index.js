import express from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import admin from "firebase-admin";
import fetch from "node-fetch";
import fs from "fs";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Initialize Firebase Admin
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Google Client ID (from Google Cloud Console — Web client)
const client = new OAuth2Client(
  "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com"
);

// ✅ Your Firebase Web API Key (from Firebase project settings)
const FIREBASE_API_KEY = "AIzaSyA46rckOwmj-cpVJNXrx7rdrWzdWiyx9sQ";

// ✅ Route for Google login
app.post("/google-login", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: "Missing idToken" });

    console.log("=== /google-login NEW REQUEST ===");
    console.log("Received idToken length:", idToken.length);

    // Verify ID token with Google
    const ticket = await client.verifyIdToken({
      idToken,
      audience: "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;
    console.log("✅ Google user verified:", payload.email);

    // Create custom Firebase token
    const customToken = await admin.auth().createCustomToken(uid);
    console.log("✅ Created Firebase custom token");

    // Exchange custom token for ID token (server side)
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: customToken,
          returnSecureToken: true,
        }),
      }
    );

    const data = await response.json();
    if (data.error) {
      console.error("🔥 Firebase login error:", data.error);
      return res.status(400).json({ error: data.error.message });
    }

    console.log("✅ Firebase sign-in successful");
    res.json({
      firebaseIdToken: data.idToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      email: payload.email,
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => res.send("✅ Auth backend running fine!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
