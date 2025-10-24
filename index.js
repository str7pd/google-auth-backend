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
  "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com",  // ✅ no newline
  "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",
  "https://google-auth-backend-y2jp.onrender.com/auth/google/callback"
);

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

    // Decode user info from id_token
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com", // ✅ also fixed here
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid);

    // ✅ Send Firebase token to client
    res.send(`
      <html>
        <body>
          <h2>✅ Login successful!</h2>
          <p>Copy this token and paste it in your app:</p>
          <textarea rows="10" cols="80">${firebaseToken}</textarea>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
