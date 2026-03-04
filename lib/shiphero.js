const axios = require("axios");

const API_URL = "https://public-api.shiphero.com/graphql";
const AUTH_URL = "https://public-api.shiphero.com/auth/token";
const REFRESH_URL = "https://public-api.shiphero.com/auth/refresh";

// ─── Token Management ─────────────────────────────────────────────────────────
// The bot authenticates with email+password on first run,
// then uses the refresh token to get new access tokens automatically.

let cachedToken = null;

async function getAccessToken() {
  // If we already have a token in memory, use it
  if (cachedToken) return cachedToken;

  // Try to use SHIPHERO_API_TOKEN directly if provided (manual override)
  if (process.env.SHIPHERO_API_TOKEN) {
    cachedToken = process.env.SHIPHERO_API_TOKEN;
    return cachedToken;
  }

  // Otherwise authenticate with email + password
  if (!process.env.SHIPHERO_EMAIL || !process.env.SHIPHERO_PASSWORD) {
    throw new Error(
      "Missing credentials: set SHIPHERO_EMAIL and SHIPHERO_PASSWORD in Vercel environment variables"
    );
  }

  try {
    const response = await axios.post(
      AUTH_URL,
      {
        username: process.env.SHIPHERO_EMAIL,
        password: process.env.SHIPHERO_PASSWORD,
      },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );
    cachedToken = response.data.access_token;
    return cachedToken;
  } catch (err) {
    throw new Error(
      `ShipHero authentication failed: ${err.response?.data?.message || err.message}`
    );
  }
}

async function refreshToken(refreshTkn) {
  const response = await axios.post(
    REFRESH_URL,
    { refresh_token: refreshTkn },
    { headers: { "Content-Type": "application/json" }, timeout: 10000 }
  );
  cachedToken = response.data.access_token;
  return cachedToken;
}

// ─── GraphQL Query Runner ─────────────────────────────────────────────────────

async function query(gql, variables = {}) {
  const token = await getAccessToken();
  try {
    const response = await axios.post(
      API_URL,
      { query: gql, variables },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 20000,
      }
    );

    if (response.data.errors) {
      // Check for throttling error and include wait time
      const err = response.data.errors[0];
      if (err.code === 30) {
        throw new Error(
          `Rate limit hit. ${err.time_remaining || "Wait a few seconds"} and try again.`
        );
      }
      throw new Error(response.data.errors.map((e) => e.message).join(", "));
    }

    return response.data.data;
  } catch (err) {
    if (err.response?.status === 401) {
      cachedToken = null; // Clear cached token so next call re-authenticates
      throw new Error("Token expired or invalid. Please check your credentials.");
    }
    throw err;
  }
}

// ─── Backorders ───────────────────────────────────────────────────────────────
// Note: ShipHero wraps results in a "data" field per their API spec

const GET_BACKORDERS = `
  query GetBackorders($cursor: String) {
    orders(fulfillment_status: "backordered") {
      request_id
      complexity
      data(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            order_number
            line_items {
              edges {
                node {
                  sku
                  product_name
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

async function getAllBackorders() {
  const backorderMap = {};
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;
  const MAX_PAGES = 4;

  while (hasNextPage && pages < MAX_PAGES) {
    const result = await query(GET_BACKORDERS, { cursor });
    const { edges, pageInfo } = result.orders.data;
    pages++;

    for (const { node: order } of edges) {
      for (const { node: item } of order.line_items.edges) {
        if ((item.quantity_backordered || 0) > 0) {
          const sku = item.sku;
          if (!backorderMap[sku]) {
            backorderMap[sku] = {
              sku,
              name: item.product_name || item.sku,
              total_backordered: 0,
              order_ids: [],
            };
          }
          backorderMap[sku].total_backordered += item.quantity_backordered;
          backorderMap[sku].order_ids.push(order.order_number);
        }
      }
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return {
    items: Object.values(backorderMap).sort(
      (a, b) => b.total_backordered - a.total_backordered
    ),
    truncated: hasNextPage,
  };
}

async function getBackorderBySku(sku) {
  const { items } = await getAllBackorders();
  return items.filter((b) => b.sku.toLowerCase().includes(sku.toLowerCase()));
}

// ─── Inventory ────────────────────────────────────────────────────────────────

const GET_ALL_INVENTORY = `
  query GetInventory($cursor: String) {
    products {
      request_id
      complexity
      data(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            sku
            name
            warehouse_products {
              on_hand
              available
              allocated
              backorder
            }
          }
        }
      }
    }
  }
`;

const GET_INVENTORY_BY_SKU = `
  query GetInventoryBySku($sku: String!) {
    product(sku: $sku) {
      request_id
      complexity
      data {
        sku
        name
        warehouse_products {
          on_hand
          available
          allocated
          backorder
          warehouse { identifier }
        }
      }
    }
  }
`;

async function getAllInventory() {
  const results = [];
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;
  const MAX_PAGES = 4;

  while (hasNextPage && pages < MAX_PAGES) {
    const result = await query(GET_ALL_INVENTORY, { cursor });
    const { edges, pageInfo } = result.products.data;
    pages++;

    for (const { node: product } of edges) {
      const totals = (product.warehouse_products || []).reduce(
        (acc, w) => ({
          on_hand: acc.on_hand + (w.on_hand || 0),
          available: acc.available + (w.available || 0),
          allocated: acc.allocated + (w.allocated || 0),
          backorder: acc.backorder + (w.backorder || 0),
        }),
        { on_hand: 0, available: 0, allocated: 0, backorder: 0 }
      );
      results.push({ sku: product.sku, name: product.name, ...totals });
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return { items: results, truncated: hasNextPage };
}

async function getInventoryBySku(sku) {
  const result = await query(GET_INVENTORY_BY_SKU, { sku });
  const product = result.product.data;
  if (!product) return null;

  const totals = (product.warehouse_products || []).reduce(
    (acc, w) => ({
      on_hand: acc.on_hand + (w.on_hand || 0),
      available: acc.available + (w.available || 0),
      allocated: acc.allocated + (w.allocated || 0),
      backorder: acc.backorder + (w.backorder || 0),
      warehouses: [
        ...acc.warehouses,
        {
          name: w.warehouse?.identifier || "Unknown",
          on_hand: w.on_hand,
          available: w.available,
          allocated: w.allocated,
        },
      ],
    }),
    { on_hand: 0, available: 0, allocated: 0, backorder: 0, warehouses: [] }
  );

  return { sku: product.sku, name: product.name, ...totals };
}

async function getLowStockItems(threshold = 10) {
  const { items, truncated } = await getAllInventory();
  return {
    items: items
      .filter((p) => p.available <= threshold && p.available >= 0)
      .sort((a, b) => a.available - b.available),
    truncated,
  };
}

module.exports = {
  getAccessToken,
  getAllBackorders,
  getBackorderBySku,
  getAllInventory,
  getInventoryBySku,
  getLowStockItems,
};
