import express from "express";
import dotenv from "dotenv";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const SCRIPT = `loadstring(game:HttpGet("https://api.jnkie.com/api/v1/luascripts/public/8ac2e97282ac0718aeeb3bb3856a2821d71dc9e57553690ab508ebdb0d1569da/download"))()`;

const sessions = new Map();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

function makeSession() {
  const id = crypto.randomBytes(32).toString("hex");

  sessions.set(id, {
    created: Date.now()
  });

  return id;
}

function cleanupSessions() {
  const maxAge = 15 * 60 * 1000;

  for (const [id, data] of sessions) {
    if (Date.now() - data.created > maxAge) {
      sessions.delete(id);
    }
  }
}

setInterval(cleanupSessions, 60_000);

/*
  Static files
*/
app.use(express.static(path.join(__dirname, "public")));

/*
  Google OAuth
*/
app.get("/auth", (req, res) => {
  const state = makeSession();

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.readonly"
    ],
    state
  });

  res.redirect(url);
});

/*
  OAuth callback
*/
app.get("/oauth2callback", async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state || !sessions.has(state)) {
      console.error("OAuth state/code missing.");
      return res.redirect("/?status=oauth_error");
    }

    sessions.delete(state);

    console.log("Google authorization received.");

    const { tokens } = await oauth2Client.getToken(code);

    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    auth.setCredentials(tokens);

    const youtube = google.youtube({
      version: "v3",
      auth
    });

    console.log("Finding @KrcHub channel...");

    const channelResponse = await youtube.channels.list({
      part: ["id"],
      forHandle: "@KrcHub"
    });

    const channel = channelResponse.data.items?.[0];

    if (!channel || !channel.id) {
      console.error("KrcHub channel was not found.");

      return res.redirect(
        "/?status=channel_error"
      );
    }

    const krchubChannelId = channel.id;

    console.log(
      "KrcHub channel found:",
      krchubChannelId
    );

    console.log("Checking YouTube subscription...");

    let subscribed = false;
    let pageToken;

    do {
      const response = await youtube.subscriptions.list({
        part: ["snippet"],
        mine: true,
        maxResults: 50,
        pageToken
      });

      const items = response.data.items || [];

      console.log(
        `Checking ${items.length} subscriptions...`
      );

      for (const item of items) {
        const subscribedChannelId =
          item.snippet?.resourceId?.channelId;

        if (subscribedChannelId === krchubChannelId) {
          subscribed = true;
          break;
        }
      }

      if (subscribed) {
        break;
      }

      pageToken = response.data.nextPageToken;

    } while (pageToken);

    if (!subscribed) {
      console.log(
        "KrcHub subscription NOT detected."
      );

      return res.redirect(
        "/?status=not_subscribed"
      );
    }

    console.log(
      "KrcHub subscription VERIFIED."
    );

    const downloadToken = crypto
      .randomBytes(32)
      .toString("hex");

    sessions.set(downloadToken, {
      created: Date.now(),
      download: true
    });

    res.redirect(
      "/?status=verified&token=" +
      encodeURIComponent(downloadToken)
    );

  } catch (err) {

    console.error("================================");
    console.error("YOUTUBE / GOOGLE ERROR");
    console.error("================================");

    console.error(
      "Message:",
      err.message
    );

    if (err.response) {

      console.error(
        "Status:",
        err.response.status
      );

      console.error(
        "Google response:",
        JSON.stringify(
          err.response.data,
          null,
          2
        )
      );
    }

    console.error("================================");

    res.redirect(
      "/?status=error"
    );
  }
});

/*
  Download script
*/
app.get("/download", (req, res) => {
  const token = req.query.token;

  const session =
    token && sessions.get(token);

  if (!session?.download) {
    return res.status(403).json({
      error: "Verification required."
    });
  }

  sessions.delete(token);

  res
    .type("text/plain")
    .send(SCRIPT);
});

export default app;
