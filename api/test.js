const axios = require("axios");

const AUTH_URL = "https://public-api.shiphero.com/auth/token";
const API_URL = "https://public-api.shiphero.com/graphql";

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
            }
          }
        }
      }
    }
  }
`;

const TEST_BACKORDERS = `
  query {
    orders(fulfillment_status: "backordered") {
      complexity
      request_id
      data(first: 3) {
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
  }
`;

module.exports = async function handler(req, res) {
  const results = {
    step1_credentials: null,
    step2_auth: null,
    step3_products: null,
    step4_backorders: null,
    access_token_preview: null,
  };

  // Step 1: Check credentials are set
  const email = process.env.SHIPHERO_EMAIL;
  const password = process.env.SHIPHERO_PASSWORD;
  const manualToken = process.env.SHIPHERO_API_TOKEN;

  if (manualToken) {
    results.step1_credentials = `✅ Using SHIPHERO_API_TOKEN directly (starts with: ${manualToken.substring(0, 8)}...)`;
  } else if (email && password) {
    results.step1_credentials = `✅ Found SHIPHERO_EMAIL (${email}) and SHIPHERO_PASSWORD`;
  } else {
    results.step1_credentials = `❌ Missing credentials! Add either:
    - SHIPHERO_EMAIL + SHIPHERO_PASSWORD (recommended), OR
    - SHIPHERO_API_TOKEN (manual token)
    Go to Vercel → Settings → Environment Variables`;

    return sendHtml(res, results, "❌ MISSING CREDENTIALS");
  }

  // Step 2: Authenticate and get token
  let token = manualToken;
  if (!token) {
    try {
      const authRes = await axios.post(
        AUTH_URL,
        { username: email, password: password },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 }
      );
      token = authRes.data.access_token;
      results.step2_auth = `✅ Authentication successful! Token expires in ${Math.round(authRes.data.expires_in / 86400)} days`;
      results.access_token_preview = `${token.substring(0, 20)}... (save this as SHIPHERO_API_TOKEN if needed)`;
    } catch (err) {
      results.step2_auth = `❌ Authentication failed: ${err.response?.data?.message || err.message}
      → Check your SHIPHERO_EMAIL and SHIPHERO_PASSWORD are correct`;
      return sendHtml(res, results, "❌ AUTH FAILED");
    }
  } else {
    results.step2_auth = "✅ Skipped (using manual token)";
  }

  // Step 3: Test products query
  try {
    const r = await axios.post(
      API_URL,
      { query: TEST_PRODUCTS },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 15000,
      }
    );

    if (r.data.errors) {
      results.step3_products = `❌ API Error: ${r.data.errors.map((e) => e.message).join(", ")}`;
    } else {
      const products = r.data.data.products.data.edges;
      const complexity = r.data.data.products.complexity;
      results.step3_products = `✅ Products query works! Got ${products.length} sample products (complexity: ${complexity} credits)`;
      results.sample_products = products.map((p) => ({
        sku: p.node.sku,
        name: p.node.name,
        available: (p.node.warehouse_products || []).reduce((s, w) => s + (w.available || 0), 0),
        on_hand: (p.node.warehouse_products || []).reduce((s, w) => s + (w.on_hand || 0), 0),
      }));
    }
  } catch (err) {
    results.step3_products = `❌ Request failed: ${err.message}`;
    if (err.response?.status === 401) {
      results.step3_products += " → Token is invalid or expired";
    }
  }

  // Step 4: Test backorders query
  try {
    const r = await axios.post(
      API_URL,
      { query: TEST_BACKORDERS },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 15000,
      }
    );

    if (r.data.errors) {
      results.step4_backorders = `❌ API Error: ${r.data.errors.map((e) => e.message).join(", ")}`;
    } else {
      const orders = r.data.data.orders.data.edges;
      const complexity = r.data.data.orders.complexity;
      results.step4_backorders = `✅ Backorders query works! Found ${orders.length} backordered orders in sample (complexity: ${complexity} credits)`;
      results.sample_backorders = orders.map((o) => ({
        order_number: o.node.order_number,
        items: o.node.line_items.edges.map((i) => ({
          sku: i.node.sku,
          qty_backordered: i.node.quantity_backordered,
        })),
      }));
    }
  } catch (err) {
    results.step4_backorders = `❌ Request failed: ${err.message}`;
  }

  const allPassed =
    results.step3_products?.startsWith("✅") &&
    results.step4_backorders?.startsWith("✅");

  sendHtml(
    res,
    results,
    allPassed
      ? "✅ ALL TESTS PASSED — Bot is ready!"
      : "⚠️ SOME TESTS FAILED — see details"
  );
};

function sendHtml(res, results, status) {
  const pass = status.startsWith("✅");
  res.setHeader("Content-Type", "text/html");
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>ShipHero Bot — Connection Test</title>
      <style>
        body { font-family: monospace; background: #0f0f0f; color: #e0e0e0; padding: 40px; max-width: 860px; margin: 0 auto; }
        h1 { color: #7c3aed; }
        h2 { color: #a78bfa; margin-top: 30px; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
        pre { background: #1a1a1a; padding: 16px; border-radius: 8px; overflow-x: auto; border: 1px solid #333; white-space: pre-wrap; word-break: break-all; }
        .pass { color: #34d399; }
        .fail { color: #f87171; }
        .warn { color: #fbbf24; }
        .label { color: #64748b; font-size: 11px; margin-top: 24px; }
        .status { font-size: 18px; font-weight: bold; padding: 16px; border-radius: 8px; background: #1a1a1a; border: 1px solid ${pass ? "#34d399" : "#f87171"}; }
      </style>
    </head>
    <body>
      <h1>🔌 ShipHero Bot — Connection Test</h1>

      <h2>Overall Status</h2>
      <div class="status ${pass ? "pass" : "fail"}">${status}</div>

      <h2>Step 1 — Credentials</h2>
      <pre class="${results.step1_credentials?.startsWith("✅") ? "pass" : "fail"}">${results.step1_credentials || "—"}</pre>

      <h2>Step 2 — Authentication</h2>
      <pre class="${results.step2_auth?.startsWith("✅") ? "pass" : "fail"}">${results.step2_auth || "—"}</pre>
      ${results.access_token_preview ? `<pre class="warn">🔑 Token preview: ${results.access_token_preview}</pre>` : ""}

      <h2>Step 3 — Products API</h2>
      <pre class="${results.step3_products?.startsWith("✅") ? "pass" : "fail"}">${results.step3_products || "—"}</pre>
      ${results.sample_products ? `<pre>${JSON.stringify(results.sample_products, null, 2)}</pre>` : ""}

      <h2>Step 4 — Backorders API</h2>
      <pre class="${results.step4_backorders?.startsWith("✅") ? "pass" : "fail"}">${results.step4_backorders || "—"}</pre>
      ${results.sample_backorders ? `<pre>${JSON.stringify(results.sample_backorders, null, 2)}</pre>` : ""}

      <p class="label">Generated at ${new Date().toISOString()} — Refresh this page to re-run tests</p>
    </body>
    </html>
  `);
}
