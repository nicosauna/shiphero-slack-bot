const axios = require("axios");

const API_URL = "https://public-api.shiphero.com/graphql";
const REFRESH_URL = "https://public-api.shiphero.com/auth/refresh";

// ─── Token Management ─────────────────────────────────────────────────────────

let cachedToken = null;

async function getToken() {
  if (cachedToken) return cachedToken;
  cachedToken = process.env.SHIPHERO_API_TOKEN;
  if (!cachedToken) throw new Error("SHIPHERO_API_TOKEN is not set in Vercel environment variables.");
  return cachedToken;
}

async function refreshAccessToken() {
  const refreshToken = process.env.SHIPHERO_REFRESH_TOKEN;
  if (!refreshToken) throw new Error("SHIPHERO_REFRESH_TOKEN is not set in Vercel environment variables.");
  try {
    const response = await axios.post(
      REFRESH_URL,
      { refresh_token: refreshToken },
      { headers: { "Content-Type": "application/json" }, timeout: 10000 }
    );
    cachedToken = response.data.access_token;
    return cachedToken;
  } catch (err) {
    throw new Error(`Token refresh failed: ${err.response?.data?.message || err.message}`);
  }
}

// ─── GraphQL Query Runner ─────────────────────────────────────────────────────

async function runQuery(gql, variables = {}, retry = true) {
  const token = await getToken();
  try {
    const response = await axios.post(
      API_URL,
      { query: gql, variables },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        timeout: 25000,
      }
    );

    if (response.data.errors) {
      const err = response.data.errors[0];
      if (err.code === 30) {
        throw new Error(`Rate limit hit. ${err.time_remaining || "Wait a few seconds"} and try again.`);
      }
      throw new Error(response.data.errors.map((e) => e.message).join(", "));
    }

    return response.data.data;
  } catch (err) {
    // If 401, try refreshing the token once and retry
    if (err.response?.status === 401 && retry) {
      console.log("Token expired, refreshing...");
      cachedToken = null;
      await refreshAccessToken();
      return runQuery(gql, variables, false); // retry once with new token
    }
    throw err;
  }
}

// ─── Backorders ───────────────────────────────────────────────────────────────

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
    const result = await runQuery(GET_BACKORDERS, { cursor });
    const { edges, pageInfo } = result.orders.data;
    pages++;

    for (const { node: order } of edges) {
      for (const { node: item } of order.line_items.edges) {
        if ((item.quantity_backordered || 0) > 0) {
          const sku = item.sku;
          if (!backorderMap[sku]) {
            backorderMap[sku] = {
              sku,
              name: item.product_name || sku,
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
    const result = await runQuery(GET_ALL_INVENTORY, { cursor });
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
  const result = await runQuery(GET_INVENTORY_BY_SKU, { sku });
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
  getAllBackorders,
  getBackorderBySku,
  getAllInventory,
  getInventoryBySku,
  getLowStockItems,
};
