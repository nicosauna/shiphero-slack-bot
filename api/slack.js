const shiphero = require("../lib/shiphero");
const fmt = require("../lib/formatters");
const { verifySlackSignature } = require("../lib/verify");
const axios = require("axios");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (!verifySlackSignature(req, rawBody)) {
    return res.status(401).send("Unauthorized");
  }

  const params = new URLSearchParams(rawBody);
  const command = params.get("command");
  const text = (params.get("text") || "").trim();
  const responseUrl = params.get("response_url");

  // Respond to Slack immediately (within 3 seconds) to avoid dispatch_failed
  res.status(200).json({
    response_type: "ephemeral",
    text: "⏳ Fetching data...",
  });

  // Now process the command and post result to response_url
  // Using setImmediate to ensure the response above is sent first
  setImmediate(async () => {
    try {
      let result;

      async function getCacheNote() {
        try {
          const lastRefresh = await shiphero.getLastRefresh();
          if (!lastRefresh) return "_Fresh from ShipHero_";
          const mins = Math.round((Date.now() - new Date(lastRefresh).getTime()) / 60000);
          return `_Cached \u00b7 updated ${mins < 1 ? "just now" : `${mins}m ago`} \u00b7 \`/refresh-cache\` to force update_`;
        } catch {
          return "";
        }
      }

      function addCacheNote(r, note) {
        if (note && r.blocks) {
          r.blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
        }
        return r;
      }

      switch (command) {
        case "/backorders": {
          const data = await shiphero.getAllBackorders();
          const note = await getCacheNote();
          result = addCacheNote(fmt.formatAllBackorders(data), note);
          break;
        }
        case "/backorder-sku":
          if (!text) {
            result = { response_type: "ephemeral", text: "Please provide a SKU. Usage: `/backorder-sku SKU-123`" };
          } else {
            const data = await shiphero.getBackorderBySku(text);
            result = fmt.formatBackorderBySku(data, text);
          }
          break;
        case "/inventory": {
          const data = await shiphero.getAllInventory();
          const note = await getCacheNote();
          result = addCacheNote(fmt.formatAllInventory(data), note);
          break;
        }
        case "/inventory-sku":
          if (!text) {
            result = { response_type: "ephemeral", text: "Please provide a SKU. Usage: `/inventory-sku SKU-123`" };
          } else {
            const data = await shiphero.getInventoryBySku(text);
            result = fmt.formatInventoryBySku(data);
          }
          break;
        case "/low-stock": {
          const threshold = parseInt(text) || 10;
          const data = await shiphero.getLowStockItems(threshold);
          const note = await getCacheNote();
          result = addCacheNote(fmt.formatLowStock(data, threshold), note);
          break;
        }
        case "/refresh-cache": {
          await shiphero.getAllInventory(true);
          result = {
            response_type: "in_channel",
            blocks: [{
              type: "section",
              text: { type: "mrkdwn", text: "✅ *Cache refreshed!* ShipHero data is now up to date." },
            }],
          };
          break;
        }
        case "/shiphero-help":
          result = fmt.formatHelp();
          break;
        default:
          result = { response_type: "ephemeral", text: `Unknown command: ${command}. Try \`/shiphero-help\`.` };
      }

      await axios.post(responseUrl, result, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

    } catch (err) {
      console.error("Slack handler error:", err.message);
      try {
        await axios.post(responseUrl, {
          response_type: "ephemeral",
          text: `❌ *Error*: ${err.message}`,
        }, { headers: { "Content-Type": "application/json" }, timeout: 5000 });
      } catch (e) {
        console.error("Failed to send error to Slack:", e.message);
      }
    }
  });
};

module.exports.config = {
  api: { bodyParser: false },
};
