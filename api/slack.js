const shiphero = require("../lib/shiphero");
const fmt = require("../lib/formatters");
const { verifySlackSignature } = require("../lib/verify");
const { WebClient } = require("@slack/web-api");

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Helper: send a deferred response (Slack gives us 3 seconds to ack,
// then we can post the real result to response_url)
async function deferredReply(responseUrl, payload) {
  const axios = require("axios");
  await axios.post(responseUrl, payload, {
    headers: { "Content-Type": "application/json" },
  });
}

async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Parse raw body for signature verification
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  // Verify the request is from Slack
  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).send("Unauthorized");
  }

  // Parse the form-encoded Slack payload
  const params = new URLSearchParams(rawBody);
  const command = params.get("command");
  const text = (params.get("text") || "").trim();
  const responseUrl = params.get("response_url");

  // Acknowledge immediately (Slack requires response within 3 seconds)
  res.status(200).json({ response_type: "in_channel", text: "⏳ Fetching data from ShipHero..." });

  // Process in the background and send real result to response_url
  try {
    let result;

    switch (command) {
      case "/backorders":
        result = fmt.formatAllBackorders(await shiphero.getAllBackorders());
        break;

      case "/backorder-sku":
        if (!text) {
          result = { response_type: "ephemeral", text: "⚠️ Please provide a SKU. Usage: `/backorder-sku SKU-123`" };
        } else {
          result = fmt.formatBackorderBySku(await shiphero.getBackorderBySku(text), text);
        }
        break;

      case "/inventory":
        result = fmt.formatAllInventory(await shiphero.getAllInventory());
        break;

      case "/inventory-sku":
        if (!text) {
          result = { response_type: "ephemeral", text: "⚠️ Please provide a SKU. Usage: `/inventory-sku SKU-123`" };
        } else {
          result = fmt.formatInventoryBySku(await shiphero.getInventoryBySku(text));
        }
        break;

      case "/low-stock": {
        const threshold = parseInt(text) || 10;
        result = fmt.formatLowStock(await shiphero.getLowStockItems(threshold), threshold);
        break;
      }

      case "/shiphero-help":
        result = fmt.formatHelp();
        break;

      default:
        result = { response_type: "ephemeral", text: `Unknown command: ${command}. Try \`/shiphero-help\`.` };
    }

    await deferredReply(responseUrl, result);
  } catch (err) {
    console.error(err);
    await deferredReply(responseUrl, {
      response_type: "ephemeral",
      text: `❌ *ShipHero API Error*: ${err.message}`,
    });
  }
}

module.exports = handler;
module.exports.config = {
  api: { bodyParser: false },
};
