const crypto = require("crypto");

function verifySlackSignature(req, rawBody) {
  const signature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];

  if (!signature || !timestamp) return false;

  // Prevent replay attacks — reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac("sha256", process.env.SLACK_SIGNING_SECRET);
  hmac.update(sigBaseString);
  const computedSig = `v0=${hmac.digest("hex")}`;

  return crypto.timingSafeEqual(
    Buffer.from(computedSig),
    Buffer.from(signature)
  );
}

module.exports = { verifySlackSignature };
