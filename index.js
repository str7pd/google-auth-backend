import express from "express";
import cors from "cors";
import { google } from "googleapis";
import admin from "firebase-admin";
import fs from "fs";

// Express setup
const app = express();
app.use(cors());
app.use(express.json());

// Firebase setup
const serviceAccount = JSON.parse(fs.readFileSync("./serviceAccountKey.json", "utf8"));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Google OAuth setup
const WEB_CLIENT_ID = "445520681231-iap0aurss1b9jqg5f3ahsudcivhv96p5.apps.googleusercontent.com";
const WEB_CLIENT_SECRET = "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";
const REDIRECT_URI = "https://google-auth-backend-y2jp.onrender.com/auth/google/callback";

const oauth2Client = new google.auth.OAuth2(WEB_CLIENT_ID, WEB_CLIENT_SECRET, REDIRECT_URI);

// Route 1 — start login
app.get("/auth/google", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
    state: req.query.redirect || "mosha://auth", // optional return link to app
  });
  res.redirect(url);
});

// Route 2 — handle callback from Google
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    const firebaseToken = await admin.auth().createCustomToken(uid);

    // Redirect back to app via deep link
    const appRedirect = `${state}?firebaseToken=${firebaseToken}`;
    console.log("Redirecting to:", appRedirect);
    res.redirect(appRedirect);

  } catch (err) {
    console.error("Error during Google OAuth:", err);
    res.status(500).send("Error during Google login.");
  }
});

app.listen(process.env.PORT || 10000, () =>
  console.log("✅ Server running on port 10000")
);
