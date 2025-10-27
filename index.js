import express from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
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

// ✅ Use the same Web Client ID as Android (for verifying ID tokens)
const client = new OAuth2Client(
  "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com"
);

app.get("/", (req, res) => {
  res.send("✅ Google Auth backend is running!");
});

// ✅ Google login endpoint
app.post("/google-login", async (req, res) => {
  try {
    console.log("=== /google-login NEW REQUEST ===");
    const { idToken } = req.body;
    if (!idToken) throw new Error("No idToken received from client");

    console.log("Received idToken length:", idToken.length);

    // ✅ Verify Google ID token
    const ticket = await client.verifyIdToken({
      idToken,
      audience: "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    console.log("✅ Google user verified:", payload.email);

    // ✅ Create Firebase custom token
    const uid = payload.sub;
    const firebaseToken = await admin.auth().createCustomToken(uid);
    console.log("✅ Created Firebase custom token");

    res.json({ token: firebaseToken });
  } catch (err) {
    console.error("🔥 Login error:", err.message);
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
