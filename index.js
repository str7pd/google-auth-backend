// ======================
// ✅ Imports
// ======================
import express from "express";
import cors from "cors";
import { google } from "googleapis";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";
import fetch from "node-fetch"; // For time check
import OpenAI from "openai";

// ======================
// ✅ Setup: OpenAI + Firebase
// ======================
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Firebase Admin SDK once
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});

const db = admin.firestore();

// ======================
// ✅ Express setup
// ======================
const app = express();
app.use(cors());
app.use(express.json());

// ======================
// 🌍 Optional: Time check
// ======================
(async () => {
  try {
    const res = await fetch("https://www.google.com");
    const dateHeader = res.headers.get("date");
    console.log("🌍 Google time:", dateHeader);
    console.log("🕒 Server time:", new Date().toUTCString());
  } catch (err) {
    console.error("⚠️ Could not fetch Google time", err);
  }
})();
console.log("🕒 Server start time:", new Date().toISOString());

// ======================
// ✅ Environment setup
// ======================
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret_fallback";
const WEB_CLIENT_ID =
  "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com";
const WEB_CLIENT_SECRET = process.env.WEB_CLIENT_SECRET;
const REDIRECT_URI = "https://google-auth-backend-y2jp.onrender.com/auth/google/callback";

// ======================
// ✅ Google OAuth setup
// ======================
const oauth2Client = new google.auth.OAuth2(
  WEB_CLIENT_ID,
  WEB_CLIENT_SECRET,
  REDIRECT_URI
);

// Helper: Generate app session tokens
function generateSessionForUser(email) {
  const random = Math.random().toString(36).substring(2, 12);
  return Buffer.from(`${email}:${random}`).toString("base64");
}

// ======================
// ✅ ROUTES
// ======================

// Root route
app.get("/", (req, res) => {
  res.send("✅ Secure Google Auth backend is running!");
});

// Step 1: Redirect user to Google OAuth
app.get("/auth/google/mobile", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["profile", "email"],
    redirect_uri: REDIRECT_URI,
  });

  console.log("🌐 Redirecting to Google OAuth:", url);
  res.redirect(url);
});

// Step 2: Handle Google callback after login
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) throw new Error("Missing ?code in callback URL");

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    console.log(`✅ Google user: ${payload.email}`);

    // Ensure Firebase user
    const userRecord =
      (await admin.auth().getUser(uid).catch(() => null)) ||
      (await admin.auth().createUser({
        uid,
        email: payload.email,
        displayName: payload.name,
        photoURL: payload.picture,
      }));

    // Redirect back to app with Firebase token
    const googleIdToken = tokens.id_token;
    res.redirect(`mosha://auth?firebaseToken=${googleIdToken}`);
  } catch (err) {
    console.error("❌ Google OAuth callback error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

// Step 3: Verify Firebase (Google ID) token from app
app.post("/mobile/verifyToken", async (req, res) => {
  const { firebaseToken } = req.body;
  try {
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${firebaseToken}`;
    const googleResponse = await fetch(verifyUrl);
    if (!googleResponse.ok) throw new Error("Invalid Google ID token");

    const googleUser = await googleResponse.json();
    const uid = `google_${googleUser.sub}`;

    const firebaseCustomToken = await admin.auth().createCustomToken(uid, {
      email: googleUser.email,
      name: googleUser.name,
    });

    const sessionToken = generateSessionForUser(googleUser.email);

    res.json({
      status: "ok",
      session: sessionToken,
      firebaseCustomToken,
    });
  } catch (err) {
    console.error("❌ verifyToken failed:", err);
    res.json({ status: "error", message: err.message });
  }
});

// Step 4: Verify session token (app requests)
app.post("/verify-session", (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    res.json({ valid: true, uid: decoded.uid, email: decoded.email });
  } catch (err) {
    res.status(401).json({ valid: false, error: "Invalid or expired token" });
  }
});

// ======================
// 🔐 Utility for protected routes
// ======================
async function verifySession(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing token");
  const token = authHeader.split(" ")[1];
  const decoded = jwt.verify(token, SESSION_SECRET);
  return decoded; // { email, uid, ... }
}

// ======================
// 💬 Chat Endpoints
// ======================

// Get all messages for user
app.get("/chat/getMessages", async (req, res) => {
  try {
    const user = await verifySession(req.headers.authorization);
    const snapshot = await db
      .collection("users")
      .doc(user.uid)
      .collection("chats")
      .orderBy("timestamp", "asc")
      .get();

    const messages = snapshot.docs.map((doc) => doc.data());
    res.json(messages);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Send user message (without GPT)
app.post("/chat/sendMessage", async (req, res) => {
  try {
    const user = await verifySession(req.headers.authorization);
    const { message } = req.body;

    await db
      .collection("users")
      .doc(user.uid)
      .collection("chats")
      .add({
        sender: user.email,
        message,
        timestamp: Date.now(),
      });

    res.json({ status: "ok" });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

// Full chat route with GPT integration
app.post("/chat", async (req, res) => {
  try {
    const { sessionToken, prompt } = req.body;

    const user = await verifySession(sessionToken);
    if (!user) return res.status(401).json({ reply: "Unauthorized" });

    const uid = user.uid;

    // Save user message
    const userMsg = {
      senderId: uid,
      senderName: user.email || "User",
      message: prompt,
      timestamp: Date.now(),
      role: "user",
    };
    await db.collection("users").doc(uid).collection("chats").add(userMsg);

    // Get GPT reply
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });
    const reply = completion.choices[0].message.content;

    // Save GPT reply
    const aiMsg = {
      senderId: "gpt",
      senderName: "Mosha AI",
      message: reply,
      timestamp: Date.now(),
      role: "assistant",
    };
    await db.collection("users").doc(uid).collection("chats").add(aiMsg);

    // Send reply back to app
    res.json({ reply });
  } catch (err) {
    console.error("❌ Chat route error:", err);
    res.status(500).json({ reply: "Server error" });
  }
});

// ======================
// 🚀 Start Server
// ======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Secure backend running on port ${PORT}`));
