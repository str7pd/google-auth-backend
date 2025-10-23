// index.js
import express from "express";
import cors from "cors";
import { OAuth2Client } from "google-auth-library";
import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(
  fs.readFileSync("./serviceAccountKey.json", "utf8")
);

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Google OAuth2 client
const client = new OAuth2Client(
  "445520681231-v2m8ilhhecf8k4466fg8v2i5h44oi654.apps.googleusercontent.com"
);

// ✅ Root endpoint
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

    const ticket = await client.verifyIdToken({
      idToken,
      audience: "445520681231-v2m8ilhhecf8k4466fg8v2i5h44oi654.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;
    console.log("verifyIdToken payload:", payload);

    const firebaseToken = await admin.auth().createCustomToken(uid);
    console.log("✅ Created Firebase custom token:", customToken);

    console.log("Created firebase custom token length:", firebaseToken.length);

    res.json({ token: firebaseToken });
  } catch (err) {
    console.error("Login error:", err);
    res.status(400).json({ error: err.message || "Login failed" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
