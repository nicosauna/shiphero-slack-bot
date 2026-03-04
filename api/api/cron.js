const shiphero = require("../lib/shiphero");

// This endpoint is called automatically by Vercel every 30 minutes
// It pre-fetches all ShipHero data and stores it in Redis cache
// so Slack commands always return instantly from cache

module.exports = async function handler(req, res) {
  // Only allow Vercel cron calls or GET requests (for manual triggering)
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  const start = Date.now();
  console.log("Cron job started — refreshing ShipHero cache...");

  try {
    const { items, truncated } = await shiphero.getAllInventory(true); // force refresh
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    const backordered = items.filter((p) => p.backorder > 0).length;
    const lowStock = items.filter((p) => p.available <= 10).length;

    console.log(`Cache refreshed in ${elapsed}s — ${items.length} SKUs, ${backordered} backordered`);

    res.status(200).json({
      success: true,
      elapsed_seconds: parseFloat(elapsed),
      total_skus: items.length,
      backordered_skus: backordered,
      low_stock_skus: lowStock,
      truncated,
      refreshed_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Cron job failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
