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
  "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com", // server web client id
  "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", // secret
  "https://google-auth-backend-y2jp.onrender.com/auth/google/callback" // redirect URI
);

// 🌐 Step 1: Redirect to Google login
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
  });
  res.redirect(url);
});

// 🌐 Step 2: Handle Google callback
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Verify ID token from Google
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com", // web client id again
    });

    const payload = ticket.getPayload();
    console.log("✅ Google verified user:", payload.email);

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(payload.sub);
    console.log("✅ Firebase token created successfully!");

    // Send it as a web page
    res.send(`
      <html>
        <body style="font-family:sans-serif; padding:20px;">
          <h2>✅ Login Successful!</h2>
          <p>Copy this token and paste it into your app:</p>
          <textarea rows="10" cols="80">${firebaseToken}</textarea>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Error during Google OAuth flow:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

// Root test
app.get("/", (req, res) => res.send("✅ Google Auth backend is running!"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
