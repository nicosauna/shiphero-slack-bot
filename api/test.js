const axios = require("axios");

const SHIPHERO_API_URL = "https://public-api.shiphero.com/graphql";

// Simple test query — just fetch 3 products to verify connection
const TEST_QUERY = `
  query TestConnection {
    products(first: 3) {
      edges {
        node {
          sku
          name
          warehouse_products {
            available
            on_hand
          }
        }
      }
    }
  }
`;

// Simple backorder test — fetch 3 backordered orders
const TEST_BACKORDERS = `
  query TestBackorders {
    orders(
      fulfillment_status: "backordered"
      first: 3
    ) {
      edges {
        node {
          order_number
          line_items {
            edges {
              node {
                sku
                quantity_backordered
              }
            }
          }
        }
      }
    }
  }
`;

export default async function handler(req, res) {
  const token = process.env.SHIPHERO_API_TOKEN;

  // Check token exists
  if (!token) {
    return res.status(200).json({
      status: "❌ FAILED",
      error: "SHIPHERO_API_TOKEN is not set in Vercel environment variables",
      fix: "Go to Vercel → Settings → Environment Variables and add SHIPHERO_API_TOKEN",
    });
  }

  const results = {
    status: "running tests...",
    token_present: `✅ Token found (starts with: ${token.substring(0, 8)}...)`,
    products_test: null,
    backorders_test: null,
  };

  // Test 1: Products
  try {
    const response = await axios.post(
      SHIPHERO_API_URL,
      { query: TEST_QUERY },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );

    if (response.data.errors) {
      results.products_test = `❌ API Error: ${response.data.errors.map((e) => e.message).join(", ")}`;
    } else {
      const products = response.data.data.products.edges;
      results.products_test = `✅ Connected! Found ${products.length} sample products:`;
      results.sample_products = products.map((p) => ({
        sku: p.node.sku,
        name: p.node.name,
        available: p.node.warehouse_products.reduce((sum, w) => sum + (w.available || 0), 0),
        on_hand: p.node.warehouse_products.reduce((sum, w) => sum + (w.on_hand || 0), 0),
      }));
    }
  } catch (err) {
    results.products_test = `❌ Request failed: ${err.message}`;
    if (err.response?.status === 401) {
      results.products_test += " — Token is invalid or expired. Get a new one from ShipHero → Settings → API";
    }
  }

  // Test 2: Backorders
  try {
    const response = await axios.post(
      SHIPHERO_API_URL,
      { query: TEST_BACKORDERS },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );

    if (response.data.errors) {
      results.backorders_test = `❌ API Error: ${response.data.errors.map((e) => e.message).join(", ")}`;
    } else {
      const orders = response.data.data.orders.edges;
      results.backorders_test = `✅ Backorder query works! Found ${orders.length} backordered orders in sample`;
      results.sample_backorders = orders.map((o) => ({
        order_number: o.node.order_number,
        items: o.node.line_items.edges.map((i) => ({
          sku: i.node.sku,
          qty_backordered: i.node.quantity_backordered,
        })),
      }));
    }
  } catch (err) {
    results.backorders_test = `❌ Request failed: ${err.message}`;
  }

  // Overall status
  results.status =
    results.products_test?.startsWith("✅") && results.backorders_test?.startsWith("✅")
      ? "✅ ALL TESTS PASSED — ShipHero is connected and working!"
      : "❌ SOME TESTS FAILED — see details above";

  // Return as pretty HTML for easy reading in browser
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ShipHero Bot — Connection Test</title>
      <style>
        body { font-family: monospace; background: #0f0f0f; color: #e0e0e0; padding: 40px; max-width: 800px; margin: 0 auto; }
        h1 { color: #7c3aed; }
        h2 { color: #a78bfa; margin-top: 30px; }
        pre { background: #1a1a1a; padding: 20px; border-radius: 8px; overflow-x: auto; border: 1px solid #333; }
        .pass { color: #34d399; }
        .fail { color: #f87171; }
        .label { color: #94a3b8; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>🔌 ShipHero Bot — Connection Test</h1>
      <p class="label">Run this page to verify your ShipHero API token and connection before using Slack commands.</p>

      <h2>Overall Status</h2>
      <pre class="${results.status.startsWith("✅") ? "pass" : "fail"}">${results.status}</pre>

      <h2>Token Check</h2>
      <pre class="pass">${results.token_present}</pre>

      <h2>Products API Test</h2>
      <pre class="${results.products_test?.startsWith("✅") ? "pass" : "fail"}">${results.products_test}</pre>
      ${results.sample_products ? `<pre>${JSON.stringify(results.sample_products, null, 2)}</pre>` : ""}

      <h2>Backorders API Test</h2>
      <pre class="${results.backorders_test?.startsWith("✅") ? "pass" : "fail"}">${results.backorders_test}</pre>
      ${results.sample_backorders ? `<pre>${JSON.stringify(results.sample_backorders, null, 2)}</pre>` : ""}

      <p class="label">Page generated at ${new Date().toISOString()}</p>
    </body>
    </html>
  `);
}
