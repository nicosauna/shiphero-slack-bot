const axios = require("axios");

const API_URL = "https://public-api.shiphero.com/graphql";

const TEST_PRODUCTS_WITH_BACKORDER = `
  query {
    products {
      complexity
      request_id
      data(first: 10) {
        edges {
          node {
            sku
            name
            warehouse_products {
              available
              on_hand
              allocated
              backorder
              warehouse { identifier }
            }
          }
        }
      }
    }
  }
`;

module.exports = async function handler(req, res) {
  const token = process.env.SHIPHERO_API_TOKEN;

  if (!token) {
    return sendHtml(res, null, "❌ SHIPHERO_API_TOKEN not set in Vercel environment variables.");
  }

  let result;
  try {
    const r = await axios.post(
      API_URL,
      { query: TEST_PRODUCTS_WITH_BACKORDER },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 20000,
      }
    );

    if (r.data.errors) {
      return sendHtml(res, null, `❌ API Error: ${r.data.errors.map((e) => e.message).join(", ")}`);
    }

    const products = r.data.data.products.data.edges.map((e) => {
      const wh = e.node.warehouse_products || [];
      return {
        sku: e.node.sku,
        name: e.node.name,
        available: wh.reduce((s, w) => s + (w.available || 0), 0),
        on_hand: wh.reduce((s, w) => s + (w.on_hand || 0), 0),
        backorder: wh.reduce((s, w) => s + (w.backorder || 0), 0),
        warehouses: wh.map((w) => ({ name: w.warehouse?.identifier, available: w.available, backorder: w.backorder })),
      };
    });

    const backordered = products.filter((p) => p.backorder > 0);
    result = { products, backordered, complexity: r.data.data.products.complexity };
  } catch (err) {
    return sendHtml(res, null, `❌ Request failed: ${err.message}`);
  }

  sendHtml(res, result, "✅ ALL SYSTEMS GO — Bot is ready to use!");
};

function sendHtml(res, result, status) {
  const pass = status.startsWith("✅");
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ShipHero Bot — Test</title>
      <style>
        body { font-family: monospace; background: #0f0f0f; color: #e0e0e0; padding: 40px; max-width: 900px; margin: 0 auto; }
        h1 { color: #7c3aed; }
        h2 { color: #a78bfa; margin-top: 30px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
        pre { background: #1a1a1a; padding: 16px; border-radius: 8px; overflow-x: auto; border: 1px solid #333; white-space: pre-wrap; font-size: 12px; }
        .pass { color: #34d399; }
        .fail { color: #f87171; }
        .status { font-size: 16px; font-weight: bold; padding: 16px; border-radius: 8px; background: #1a1a1a; border: 1px solid ${pass ? "#34d399" : "#f87171"}; margin-bottom: 20px; }
        .label { color: #64748b; font-size: 11px; margin-top: 24px; }
      </style>
    </head>
    <body>
      <h1>🔌 ShipHero Bot — Final Test</h1>
      <div class="status ${pass ? "pass" : "fail"}">${status}</div>

      ${result ? `
      <h2>✅ Sample Products (first 10)</h2>
      <pre>${JSON.stringify(result.products, null, 2)}</pre>

      <h2>📦 Backordered SKUs Found (backorder > 0)</h2>
      <pre class="${result.backordered.length ? "fail" : "pass"}">${result.backordered.length ? JSON.stringify(result.backordered, null, 2) : "None in first 10 products — run /backorders in Slack to check full catalog"}</pre>

      <h2>Credits Used</h2>
      <pre class="pass">Complexity: ${result.complexity} credits</pre>
      ` : ""}

      <p class="label">Generated at ${new Date().toISOString()}</p>
    </body>
    </html>
  `);
}
