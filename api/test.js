const axios = require("axios");

const API_URL = "https://public-api.shiphero.com/graphql";

// Test 1: Basic orders query with no filter — just to confirm orders work
const TEST_ORDERS_BASIC = `
  query {
    orders {
      complexity
      request_id
      data(first: 3) {
        edges {
          node {
            order_number
            fulfillment_status
            line_items {
              edges {
                node {
                  sku
                  quantity
                  quantity_backordered
                }
              }
            }
          }
        }
      }
    }
  }
`;

// Test 2: Orders filtered by has_backorder flag
const TEST_ORDERS_BACKORDER_FLAG = `
  query {
    orders(has_backorder: true) {
      complexity
      request_id
      data(first: 3) {
        edges {
          node {
            order_number
            fulfillment_status
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
  }
`;

// Test 3: Products with inventory to see what fields are available
const TEST_PRODUCTS = `
  query {
    products {
      complexity
      request_id
      data(first: 3) {
        edges {
          node {
            sku
            name
            warehouse_products {
              available
              on_hand
              allocated
              backorder
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
    return sendHtml(res, { error: "❌ SHIPHERO_API_TOKEN not set in Vercel environment variables." }, "❌ MISSING TOKEN");
  }

  async function runTest(query) {
    try {
      const r = await axios.post(
        API_URL,
        { query },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          timeout: 20000,
        }
      );
      if (r.data.errors) {
        return { ok: false, error: r.data.errors.map((e) => e.message).join(", "), raw: r.data };
      }
      return { ok: true, data: r.data.data };
    } catch (err) {
      return {
        ok: false,
        error: `${err.message}`,
        status: err.response?.status,
        raw: err.response?.data,
      };
    }
  }

  const results = {};

  // Test 1: Basic orders
  results.orders_basic = await runTest(TEST_ORDERS_BASIC);

  // Test 2: Orders with backorder flag
  results.orders_backorder_flag = await runTest(TEST_ORDERS_BACKORDER_FLAG);

  // Test 3: Products
  results.products = await runTest(TEST_PRODUCTS);

  // Figure out what fulfillment statuses exist from basic orders
  let statusesFound = [];
  if (results.orders_basic.ok) {
    statusesFound = results.orders_basic.data.orders.data.edges.map(
      (e) => e.node.fulfillment_status
    );
  }

  const allGood = results.orders_basic.ok && results.products.ok;

  sendHtml(res, results, statusesFound, allGood ? "✅ Connection working!" : "⚠️ Some issues found");
};

function sendHtml(res, results, statusesFound = [], status) {
  const pass = status.startsWith("✅");
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ShipHero Bot — Diagnostics</title>
      <style>
        body { font-family: monospace; background: #0f0f0f; color: #e0e0e0; padding: 40px; max-width: 900px; margin: 0 auto; }
        h1 { color: #7c3aed; }
        h2 { color: #a78bfa; margin-top: 30px; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
        pre { background: #1a1a1a; padding: 16px; border-radius: 8px; overflow-x: auto; border: 1px solid #333; white-space: pre-wrap; word-break: break-all; font-size: 12px; }
        .pass { color: #34d399; }
        .fail { color: #f87171; }
        .label { color: #64748b; font-size: 11px; margin-top: 24px; }
        .status { font-size: 16px; font-weight: bold; padding: 16px; border-radius: 8px; background: #1a1a1a; border: 1px solid ${pass ? "#34d399" : "#fbbf24"}; margin-bottom: 20px; }
      </style>
    </head>
    <body>
      <h1>🔌 ShipHero — Diagnostics</h1>
      <div class="status ${pass ? "pass" : "warn"}">${status}</div>

      ${statusesFound.length ? `
      <h2>📋 Fulfillment Statuses Found in Your Orders</h2>
      <pre class="pass">${JSON.stringify(statusesFound, null, 2)}</pre>
      ` : ""}

      <h2>Test 1 — Basic Orders Query</h2>
      <pre class="${results.orders_basic?.ok ? "pass" : "fail"}">${results.orders_basic?.ok ? "✅ PASSED" : "❌ FAILED: " + results.orders_basic?.error}</pre>
      ${results.orders_basic?.ok ? `<pre>${JSON.stringify(results.orders_basic.data?.orders?.data?.edges?.map(e => ({ order_number: e.node.order_number, status: e.node.fulfillment_status, items: e.node.line_items.edges.map(i => ({ sku: i.node.sku, qty_backordered: i.node.quantity_backordered })) })), null, 2)}</pre>` : `<pre>${JSON.stringify(results.orders_basic?.raw, null, 2)}</pre>`}

      <h2>Test 2 — Backorder Flag Filter (has_backorder: true)</h2>
      <pre class="${results.orders_backorder_flag?.ok ? "pass" : "fail"}">${results.orders_backorder_flag?.ok ? "✅ PASSED" : "❌ FAILED: " + results.orders_backorder_flag?.error}</pre>
      ${results.orders_backorder_flag?.ok ? `<pre>${JSON.stringify(results.orders_backorder_flag.data?.orders?.data?.edges?.map(e => ({ order: e.node.order_number, items: e.node.line_items.edges.map(i => ({ sku: i.node.sku, qty_backordered: i.node.quantity_backordered })) })), null, 2)}</pre>` : `<pre>${JSON.stringify(results.orders_backorder_flag?.raw, null, 2)}</pre>`}

      <h2>Test 3 — Products Query</h2>
      <pre class="${results.products?.ok ? "pass" : "fail"}">${results.products?.ok ? "✅ PASSED" : "❌ FAILED: " + results.products?.error}</pre>
      ${results.products?.ok ? `<pre>${JSON.stringify(results.products.data?.products?.data?.edges?.map(e => e.node), null, 2)}</pre>` : ""}

      <p class="label">Generated at ${new Date().toISOString()} — Refresh to re-run</p>
    </body>
    </html>
  `);
}
