const shiphero = require("../lib/shiphero");
const fmt = require("../lib/formatters");
const { verifySlackSignature } = require("../lib/verify");
const axios = require("axios");

async function deferredReply(responseUrl, payload) {
  await axios.post(responseUrl, payload, {
    headers: { "Content-Type": "application/json" },
  });
}

async function handleCommand(responseUrl, fn) {
  try {
    const result = await fn();
    await deferredReply(responseUrl, result);
  } catch (err) {
    console.error(err);
    await deferredReply(responseUrl, {
      response_type: "ephemeral",
      text: `❌ *ShipHero Error*: ${err.message}`,
    });
  }
}

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

  // Acknowledge immediately
  res.status(200).json({
    response_type: "ephemeral",
    text: "⏳ On it...",
  });

  // Get cache age for display
  async function getCacheNote() {
    const lastRefresh = await shiphero.getLastRefresh();
    if (!lastRefresh) return "_Fresh from ShipHero_";
    const mins = Math.round((Date.now() - new Date(lastRefresh).getTime()) / 60000);
    return `_Cached data · last updated ${mins < 1 ? "just now" : `${mins} min ago`} · use \`/refresh-cache\` to force update_`;
  }

  switch (command) {
    case "/backorders":
      await handleCommand(responseUrl, async () => {
        const data = await shiphero.getAllBackorders();
        const note = await getCacheNote();
        const result = fmt.formatAllBackorders(data);
        result.blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
        return result;
      });
      break;

    case "/backorder-sku":
      if (!text) {
        await deferredReply(responseUrl, { response_type: "ephemeral", text: "⚠️ Please provide a SKU. Usage: `/backorder-sku SKU-123`" });
      } else {
        await handleCommand(responseUrl, async () => {
          const data = await shiphero.getBackorderBySku(text);
          return fmt.formatBackorderBySku(data, text);
        });
      }
      break;

    case "/inventory":
      await handleCommand(responseUrl, async () => {
        const data = await shiphero.getAllInventory();
        const note = await getCacheNote();
        const result = fmt.formatAllInventory(data);
        result.blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
        return result;
      });
      break;

    case "/inventory-sku":
      if (!text) {
        await deferredReply(responseUrl, { response_type: "ephemeral", text: "⚠️ Please provide a SKU. Usage: `/inventory-sku SKU-123`" });
      } else {
        await handleCommand(responseUrl, async () => {
          const data = await shiphero.getInventoryBySku(text);
          return fmt.formatInventoryBySku(data);
        });
      }
      break;

    case "/low-stock": {
      const threshold = parseInt(text) || 10;
      await handleCommand(responseUrl, async () => {
        const data = await shiphero.getLowStockItems(threshold);
        const note = await getCacheNote();
        const result = fmt.formatLowStock(data, threshold);
        result.blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: note }] });
        return result;
      });
      break;
    }

    case "/refresh-cache":
      await handleCommand(responseUrl, async () => {
        await deferredReply(responseUrl, {
          response_type: "ephemeral",
          text: "🔄 Refreshing ShipHero data... this may take 15-30 seconds.",
        });
        await shiphero.getAllInventory(true); // force refresh
        return {
          response_type: "in_channel",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "✅ *Cache refreshed!* ShipHero data is now up to date. All commands will return fresh data." },
            },
          ],
        };
      });
      break;

    case "/shiphero-help":
      await deferredReply(responseUrl, fmt.formatHelp());
      break;

    default:
      await deferredReply(responseUrl, {
        response_type: "ephemeral",
        text: `Unknown command: ${command}. Try \`/shiphero-help\`.`,
      });
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
