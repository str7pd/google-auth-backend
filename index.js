import admin from "firebase-admin";
import { OAuth2Client } from "google-auth-library";
import express from "express";

const app = express();
app.use(express.json());

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const client = new OAuth2Client("445520681231-v2m8ilhhecf8k4466fg8v2i5h44oi654.apps.googleusercontent.com");

app.post("/google-login", async (req, res) => {
  try {
    const { idToken } = req.body;
    const ticket = await client.verifyIdToken({
      idToken,
      audience: "445520681231-v2m8ilhhecf8k4466fg8v2i5h44oi654.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();
    const uid = payload.sub;

    // Create Firebase custom token
    const firebaseToken = await admin.auth().createCustomToken(uid);
    res.json({ token: firebaseToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Token exchange failed", details: err.message });
  }
});

app.listen(8080, () => console.log("Server started on port 8080"));
