// index.js
import express from "express";
import cors from "cors";
import { google } from "googleapis";
import admin from "firebase-admin";
import fs from "fs";
import jwt from "jsonwebtoken";
import fetch from "node-fetch"; // For time check
import OpenAI from "openai";
import express from "express";


const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});

const db = admin.firestore();
const app = express();
app.use(express.json());
// 🌍 Time check (optional but helpful for debugging)
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

// ✅ Express setup
const app = express();
app.use(cors());
app.use(express.json());

// ✅ Load Firebase service account (stored as an environment variable)
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ✅ Environment secrets
const SESSION_SECRET = process.env.SESSION_SECRET || "dev_secret_fallback";
const WEB_CLIENT_ID = "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com";
const WEB_CLIENT_SECRET = process.env.WEB_CLIENT_SECRET;
const REDIRECT_URI = "https://google-auth-backend-y2jp.onrender.com/auth/google/callback";

const oauth2Client = new google.auth.OAuth2(WEB_CLIENT_ID, WEB_CLIENT_SECRET, REDIRECT_URI);

function generateSessionForUser(email) {
  // You can make your own JWT, UUID, or store a session in DB
  const random = Math.random().toString(36).substring(2, 12);
  return Buffer.from(`${email}:${random}`).toString("base64");
}


// ✅ Root check
app.get("/", (req, res) => {
  res.send("✅ Secure Google Auth backend is running!");
});

// ✅ Step 1: Mobile app requests login → redirect to Google
app.get("/auth/google/mobile", (req, res) => {
  const url = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["profile", "email"],
  redirect_uri: REDIRECT_URI, // ✅ force match
});

  console.log("🌐 Redirecting to Google OAuth:", url);
  res.redirect(url);
});

// ✅ Step 2: Google calls back after user chooses account
app.get("/auth/google/callback", async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      throw new Error("Missing ?code in callback URL — check redirect URI & OAuth config");
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Verify Google ID token
    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: WEB_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    console.log(`✅ Web user: ${payload.email} → Ensuring Firebase user...`);

    // ✅ Ensure user exists in Firebase
    const userRecord =
      (await admin.auth().getUser(uid).catch(() => null)) ||
      (await admin.auth().createUser({
        uid,
        email: payload.email,
        displayName: payload.name,
        photoURL: payload.picture,
      }));

    // ✅ Create secure session token (JWT)
    // ✅ New: Create a Firebase custom token
const googleIdToken = tokens.id_token;
res.redirect(`mosha://auth?firebaseToken=${googleIdToken}`);



    console.log("✅ Created session token, redirecting back to app...");
  } catch (err) {
    console.error("❌ Google OAuth callback error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

// ✅ Step 3: Verify session token (for app API requests)
app.post("/verify-session", (req, res) => {
  const { token } = req.body;
  try {
    const decoded = jwt.verify(token, SESSION_SECRET);
    res.json({ valid: true, uid: decoded.uid, email: decoded.email });
  } catch (err) {
    res.status(401).json({ valid: false, error: "Invalid or expired token" });
  }
});

app.post("/mobile/verifyToken", async (req, res) => {
  const { firebaseToken } = req.body; // actually a Google ID token
  try {
    // ✅ Step 1: Verify Google token directly with Google
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${firebaseToken}`;
    const googleResponse = await fetch(verifyUrl);
    if (!googleResponse.ok) {
      throw new Error("Invalid Google ID token");
    }

    const googleUser = await googleResponse.json();
    // googleUser will contain fields like email, name, sub (Google user id)

    // ✅ Step 2: Create a Firebase custom token (optional)
    const uid = `google_${googleUser.sub}`;
    const firebaseCustomToken = await admin.auth().createCustomToken(uid, {
      email: googleUser.email,
      name: googleUser.name,
    });

    // ✅ Step 3: Create your own app session token
    const sessionToken = generateSessionForUser(googleUser.email);

    res.json({
      status: "ok",
      session: sessionToken,
      firebaseCustomToken, // optional: send if you want client Firebase login later
    });

  } catch (err) {
    console.error("❌ verifyToken failed:", err);
    res.json({ status: "error", message: err.message });
  }
});
// utils
async function verifySession(authHeader) {
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Missing token");
  const token = authHeader.split(" ")[1];
  const decoded = jwt.verify(token, SESSION_SECRET);
  return decoded; // { email, uid, ... }
}

app.get("/chat/getMessages", async (req, res) => {
  try {
    const user = await verifySession(req.headers.authorization);
    const snapshot = await admin.firestore()
      .collection("users")
      .doc(user.uid)
      .collection("chats")
      .orderBy("timestamp", "asc")
      .get();

    const messages = snapshot.docs.map(doc => doc.data());
    res.json(messages);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post("/chat/sendMessage", async (req, res) => {
  try {
    const user = await verifySession(req.headers.authorization);
    const { message } = req.body;

    await admin.firestore()
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

app.post("/chat", async (req, res) => {
  try {
    const { sessionToken, prompt } = req.body;

    // 1️⃣ Verify user session
    const user = await verifySession(sessionToken); // your existing verify function
    if (!user) return res.status(401).json({ reply: "Unauthorized" });

    const uid = user.uid;

    // 2️⃣ Save user message in Firestore
    const userMsg = {
      senderId: uid,
      senderName: user.email || "User",
      message: prompt,
      timestamp: Date.now(),
      role: "user"
    };
    await db.collection("users").doc(uid).collection("chats").add(userMsg);

    // 3️⃣ Get GPT reply
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }]
    });
    const reply = completion.choices[0].message.content;

    // 4️⃣ Save GPT reply in Firestore
    const aiMsg = {
      senderId: "gpt",
      senderName: "Mosha AI",
      message: reply,
      timestamp: Date.now(),
      role: "assistant"
    };
    await db.collection("users").doc(uid).collection("chats").add(aiMsg);

    // 5️⃣ Send back reply
    res.json({ reply });
  } catch (err) {
    console.error("Chat route error:", err);
    res.status(500).json({ reply: "Server error" });
  }
});



// ✅ Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Secure backend running on port ${PORT}`));
