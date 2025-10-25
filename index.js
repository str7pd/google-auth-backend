import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import fetch from "node-fetch";
import fs from "fs";
import { OAuth2Client } from "google-auth-library";

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Initialize Firebase Admin
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// 🔑 Firebase Web API key (from google-services.json)
const FIREBASE_API_KEY = "AIzaSyA46rckOwmj-cpVJNXrx7rdrWzdWiyx9sQ";

// 🧩 Google OAuth2 client (use WEB CLIENT ID)
const client = new OAuth2Client(
  "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com"
);

// 🌐 Google login endpoint
app.post("/google-login", async (req, res) => {
  console.log("=== /google-login NEW REQUEST ===");
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ error: "No idToken provided" });
    }

    console.log("Received idToken length:", idToken.length);

    // ✅ Verify ID token from Google
    const ticket = await client.verifyIdToken({
      idToken,
      audience: "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    console.log("✅ Google user verified:", payload.email);

    // ✅ Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(payload.sub);
    console.log("✅ Created Firebase custom token");

    // ✅ Exchange for Firebase ID token (authorized client token)
    const verifyUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FIREBASE_API_KEY}`;

    const firebaseRes = await fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: firebaseToken,
        returnSecureToken: true,
      }),
    });

    const firebaseData = await firebaseRes.json();

    if (!firebaseRes.ok) {
      console.error("🔥 Firebase login error:", firebaseData);
      return res.status(400).json({ error: firebaseData });
    }

    console.log("✅ Firebase login success");
    res.json({ token: firebaseData.idToken });
  } catch (err) {
    console.error("🔥 Server error:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
