const express = require('express');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json()); // ✅ REQUIRED before routes

admin.initializeApp({
  credential: admin.credential.cert(require('./serviceAccountKey.json'))
});

const client = new OAuth2Client("445520681231-v2m8ilhhecf8k4466fg8v2i5h44oi654.apps.googleusercontent.com");

app.get("/", (req, res) => {
  res.send("✅ Google Auth backend is running!");
});

app.post("/google-login", async (req, res) => {
  try {
    const { idToken } = req.body; // ✅ will now work
    if (!idToken) throw new Error("No idToken received from client");

    const ticket = await client.verifyIdToken({
      idToken,
      audience: "445520681231-v2m8ilhhecf8k4466fg8v2i5h44oi654.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const uid = payload["sub"];
    const firebaseToken = await admin.auth().createCustomToken(uid);
    res.json({ token: firebaseToken });
  } catch (err) {
    console.error("Login error:", err);
    res.status(400).json({ error: err.message || "Login failed" });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
