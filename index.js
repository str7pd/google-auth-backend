// index.js — secure backend (app -> server -> Firebase & GenAI)
// ==========================================================
// Uses: express, cors, firebase-admin, google-auth, @google/genai
// ==========================================================

import express from "express";
import cors from "cors";
import { google } from "googleapis";
import admin from "firebase-admin";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import { GoogleGenAI } from "@google/genai";

// ======================
// ✅ GenAI client
// ======================
const genai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

if (!genai) {
  console.warn("⚠️ GEMINI_API_KEY not set — GenAI client NOT initialized");
}

// ======================
// ✅ Firebase setup
// ======================
try {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set");
  }
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
} catch (err) {
  console.error("Failed to initialize Firebase Admin:", err);
  // Proceeding, but many operations will fail without a proper Firebase init.
}
const db = admin.firestore();

// ======================
// ✅ Express setup
// ======================
const app = express();
app.use(cors());
app.use(express.json());

// Optional time check (debug)
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
// ✅ Constants / OAuth
// ======================
const SESSION_COLLECTION = "sessions";
const WEB_CLIENT_ID = "445520681231-vt90cd5l7c66bekncdfmrvhli6eui6ja.apps.googleusercontent.com";
const WEB_CLIENT_SECRET = process.env.WEB_CLIENT_SECRET || "";
const REDIRECT_URI = "https://google-auth-backend-y2jp.onrender.com/auth/google/callback";

const oauth2Client = new google.auth.OAuth2(WEB_CLIENT_ID, WEB_CLIENT_SECRET, REDIRECT_URI);

// Helper: generate a random server session token
function generateSessionToken() {
  return Math.random().toString(36).substring(2, 18) + Date.now().toString(36).slice(-6);
}

// ======================
// ✅ ROUTES
// ======================

// Root
app.get("/", (req, res) => res.send("✅ Secure Google Auth backend (GenAI-only) is running!"));

// Step 1: Redirect to Google OAuth for web/mobile flows
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

// Step 2: Google OAuth callback (web). Returns a google ID token to the client via deep link.
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
    const uid = `google_${payload.sub}`;
    console.log("✅ Google user:", payload.email);

    let userRecord;
    try {
      userRecord = await admin.auth().getUser(uid);
    } catch (err) {
      const existingByEmail = await admin.auth().getUserByEmail(payload.email).catch(() => null);
      if (existingByEmail) {
        userRecord = existingByEmail;
      } else {
        userRecord = await admin.auth().createUser({
          uid,
          email: payload.email,
          displayName: payload.name,
          photoURL: payload.picture,
        });
      }
    }

    const googleIdToken = tokens.id_token;
    res.redirect(`mosha://auth?firebaseToken=${googleIdToken}`);
  } catch (err) {
    console.error("❌ Google OAuth callback error:", err);
    res.status(500).send("Error during Google OAuth login.");
  }
});

// GET /chat/result?uid=<uid>&requestId=<requestId>
app.get("/chat/result", async (req, res) => {
  console.log("📥 /chat/result called with query:", req.query);
  try {
    const sessionToken = extractSessionTokenFromReq(req);
    const uid = req.query.uid;
    const requestId = req.query.requestId;
    console.log("Auth token present:", !!sessionToken, "uid:", uid, "requestId:", requestId);

    if (!sessionToken || !uid || !requestId) {
      console.warn("/chat/result missing fields");
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    try {
      await verifySessionByToken(sessionToken, uid);
    } catch (err) {
      console.error("verifySessionByToken failed:", err);
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    const docRef = db.collection("users").doc(uid).collection("chats").doc(requestId);
    const snap = await docRef.get();

const data = snap.data();
// if assistant replied normally
if (data?.assistant?.message) {
  return res.json({ ok: true, reply: data.assistant.message, raw: data });
}

// if assistant produced an error during generation, return that as the reply (so client can show it)
if (data?.assistant?.error) {
  return res.json({ ok: true, reply: `Error: ${data.assistant.error}`, raw: data });
}

// still pending
return res.json({ ok: false, pending: true });

  } catch (err) {
    console.error("❌ /chat/result top-level error:", err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
});



// Step 3: App posts the Google ID token here. Server validates it with Google and issues server session.
app.post("/mobile/verifyToken", async (req, res) => {
  const { firebaseToken } = req.body;
  if (!firebaseToken)
    return res.status(400).json({ success: false, message: "Missing token" });

  try {
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(firebaseToken)}`;
    const googleResponse = await fetch(verifyUrl);
    if (!googleResponse.ok) throw new Error("Invalid Google ID token");

    const googleUser = await googleResponse.json();
    const uid = `google_${googleUser.sub}`;

    let userRecord;
    try {
      userRecord = await admin.auth().getUser(uid);
    } catch {
      const existingByEmail = await admin.auth().getUserByEmail(googleUser.email).catch(() => null);
      if (existingByEmail) {
        userRecord = existingByEmail;
      } else {
        userRecord = await admin.auth().createUser({
          uid,
          email: googleUser.email,
          displayName: googleUser.name,
          photoURL: googleUser.picture,
        });
      }
    }

    const sessionToken = generateSessionToken();
    await db.collection(SESSION_COLLECTION).doc(uid).set({
      sessionToken,
      uid,
      email: googleUser.email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({
      success: true,
      token: sessionToken,
      uid,
      message: "Login successful",
    });
  } catch (err) {
    console.error("❌ verifyToken failed:", err);
    res.json({
      success: false,
      message: err.message || "Server verification failed",
    });
  }
});

// Endpoint to verify session (optional)
app.post("/verify-session", async (req, res) => {
  try {
    const { sessionToken, uid } = req.body;
    if (!sessionToken || !uid) return res.status(400).json({ valid: false, error: "Missing fields" });

    const doc = await db.collection(SESSION_COLLECTION).doc(uid).get();
    if (!doc.exists || doc.data().sessionToken !== sessionToken) {
      return res.status(401).json({ valid: false, error: "Invalid session" });
    }

    return res.json({ valid: true, uid, email: doc.data().email });
  } catch (err) {
    console.error("verify-session error:", err);
    res.status(500).json({ valid: false, error: "Server error" });
  }
});

// ======================
// 🔐 Session helpers
// ======================
async function verifySessionByToken(sessionToken, uidOptional = null) {
  if (!sessionToken) throw new Error("Missing session token");
  const q = await db.collection(SESSION_COLLECTION).where("sessionToken", "==", sessionToken).limit(1).get();
  if (q.empty) throw new Error("Invalid session token");
  const data = q.docs[0].data();
  if (uidOptional && data.uid !== uidOptional) throw new Error("UID mismatch");
  return data;
}

function extractSessionTokenFromReq(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) return auth.split(" ")[1];
  if (req.body?.sessionToken) return req.body.sessionToken;
  if (req.query?.sessionToken) return req.query?.sessionToken;
  return null;
}

// ======================
// 💬 Chat Endpoints (server-only using GenAI only)
// ======================

// Get chat history for user
app.post("/chat/history", async (req, res) => {
  try {
    const sessionToken = extractSessionTokenFromReq(req);
    const uid = req.body.uid;
    const session = await verifySessionByToken(sessionToken, uid);
    const userUid = session.uid;

    const snapshot = await db
      .collection("users")
      .doc(userUid)
      .collection("chats")
      .orderBy("timestamp", "asc")
      .get();

    const history = snapshot.docs.map((d) => d.data());
    res.json({ history });
  } catch (err) {
    console.error("chat/history error:", err);
    res.status(401).json({ error: err.message });
  }
});

// Send a plain message (store only)
app.post("/chat/sendMessage", async (req, res) => {
  try {
    const sessionToken = extractSessionTokenFromReq(req);
    const uid = req.body.uid;
    const message = req.body.message;
    if (!message) return res.status(400).json({ error: "Missing message" });

    const session = await verifySessionByToken(sessionToken, uid);
    const userUid = session.uid;

    await db
      .collection("users")
      .doc(userUid)
      .collection("chats")
      .add({
        senderId: userUid,
        senderName: session.email || "User",
        message,
        timestamp: Date.now(),
        role: "user",
      });

    res.json({ status: "ok" });
  } catch (err) {
    console.error("chat/sendMessage error:", err);
    res.status(401).json({ error: err.message });
  }
});

// POST /chat/create (fast ACK + async GenAI processing)
app.post("/chat/create", async (req, res) => {
  console.log("📥 /chat/create called");
  console.log("Headers:", req.headers);
  console.log("Body:", req.body);

  try {
    const sessionToken = extractSessionTokenFromReq(req);
    const uidFromBody = req.body.uid;
    const prompt = req.body.prompt || req.body.message;

    if (!sessionToken || !uidFromBody || !prompt) {
      console.warn("/chat/create missing fields:", { sessionTokenExists: !!sessionToken, uidFromBody, promptExists: !!prompt });
      return res.status(400).json({ ok: false, error: "Missing fields" });
    }

    // Validate session
    let session;
    try {
      session = await verifySessionByToken(sessionToken, uidFromBody);
      console.log("Session validated for uid:", session.uid);
    } catch (err) {
      console.error("Session validation failed:", err.message);
      return res.status(401).json({ ok: false, error: err.message });
    }

    const userUid = session.uid;
    const chatsRef = db.collection("users").doc(userUid).collection("chats");

    const newDocRef = chatsRef.doc();
    const requestId = newDocRef.id;

    const userMsg = {
      id: requestId,
      senderId: userUid,
      senderName: session.email || "User",
      message: prompt,
      timestamp: Date.now(),
      role: "user",
      status: "pending",
      requestId
    };

    console.log("Creating user message doc with requestId:", requestId);
    await newDocRef.set(userMsg);
    // Node server pseudocode inside /chat/create:
const convId = requestId; // or something provided by client
await db.collection('users').doc(userUid)
  .collection('conversations').doc(convId)
  .set({
     title: prompt.slice(0,50),
     lastMessage: prompt,
     lastTimestamp: Date.now(),
     unread: 0,
     requestId: convId
  }, { merge: true });

// when assistant reply saved:
await db.collection('users').doc(userUid)
  .collection('conversations').doc(convId)
  .update({
     lastMessage: reply,
     lastTimestamp: Date.now(),
     unread: admin.firestore.FieldValue.increment(1),
  });

    console.log("User message saved to Firestore (pending).");

    // Immediate ACK
    res.json({ ok: true, requestId });

    // Async processing using GenAI only
(async () => {
  try {
    console.log("Async: Marking processing for requestId:", requestId);
    await newDocRef.update({ status: "processing", updatedAt: admin.firestore.FieldValue.serverTimestamp() });

    if (!genai) throw new Error("GenAI client not initialized (missing GEMINI_API_KEY)");

    console.log("Async: Calling GenAI for requestId:", requestId);

    // Retry loop for transient GenAI errors
    const maxAttempts = 5;
    let attempt = 0;
    let genResponse = null;
    let lastErr = null;

    while (attempt < maxAttempts) {
      attempt++;
      try {
        genResponse = await genai.models.generateContent({
          model: "gemini-2.5-flash", // change if you prefer another model
          contents: prompt
        });
        // if we reached here, success
        break;
      } catch (err) {
        lastErr = err;
        console.error(`GenAI attempt ${attempt} failed for requestId ${requestId}:`, err);

        // detect transient errors (503 / UNAVAILABLE / overloaded)
        const statusCode = err?.code || err?.status;
        const message = (err?.message || "").toString().toLowerCase();
        const isTransient =
          statusCode === 503 ||
          statusCode === "UNAVAILABLE" ||
          message.includes("overloaded") ||
          message.includes("unavailable") ||
          message.includes("rate limit");

        if (!isTransient) {
          // non-transient — stop retrying
          console.error("Non-transient GenAI error, will not retry:", message);
          break;
        }

        if (attempt >= maxAttempts) {
          console.error("Reached max GenAI retry attempts");
          break;
        }

        // exponential backoff (ms)
        const waitMs = Math.min(2000 * attempt, 10000);
        console.log(`Retrying GenAI in ${waitMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }

    // If we have a successful response, extract reply and save
    if (genResponse) {
      // genResponse.text is commonly returned; adapt if structure differs
      const reply = genResponse?.text ?? JSON.stringify(genResponse).slice(0, 2000);
      console.log("GenAI reply (truncated):", (reply || "").substring(0, 300));

      // Save assistant reply into same document (no index required)
      await newDocRef.update({
        assistant: {
          senderId: "gpt",
          senderName: "Mosha AI",
          message: reply,
          timestamp: Date.now(),
          status: "done"
        },
        status: "done",
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log("Saving assistant reply to Firestore for requestId:", requestId);
      console.log("Async: Completed requestId:", requestId);
      return;
    }

    // If we reach here, genResponse is null => all attempts failed
    const errorMessage = lastErr?.message ? String(lastErr.message) : "GenAI: unknown failure";
    console.error("Async GenAI final failure for requestId", requestId, errorMessage);

    // Save an assistant.error field so client will stop polling and display something useful
    await newDocRef.update({
      assistant: {
        error: errorMessage,
        timestamp: Date.now(),
        status: "failed"
      },
      status: "failed",
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });

  } catch (err) {
    console.error("Async worker fatal error for requestId", requestId, err);
    // Best effort to mark failure on the request doc
    try {
      await newDocRef.update({
        assistant: { error: err?.message ?? String(err), status: "failed", timestamp: Date.now() },
        status: "failed",
        completedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (uerr) {
      console.error("Failed to mark failure in Firestore for requestId:", requestId, uerr);
    }
  }
})();

  } catch (err) {
    console.error("❌ /chat/create top-level error:", err);
    res.status(500).json({ ok: false, error: err.message || "Server error" });
  }
});

// ======================
// 🚀 Start Server
// ======================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ Secure backend running on port ${PORT}`));
