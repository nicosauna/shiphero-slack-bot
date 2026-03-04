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
    if (err.response?.status === 401 && retry) {
      // Try to refresh token
      try {
        const refreshToken = process.env.SHIPHERO_REFRESH_TOKEN;
        if (refreshToken) {
          const r = await axios.post(
            REFRESH_URL,
            { refresh_token: refreshToken },
            { headers: { "Content-Type": "application/json" }, timeout: 10000 }
          );
          cachedToken = r.data.access_token;
          return runQuery(gql, variables, false);
        }
      } catch (refreshErr) {
        throw new Error("Token expired and refresh failed. Please update SHIPHERO_API_TOKEN in Vercel.");
      }
    }
    throw err;
  }
}

// ─── Products + Inventory Query ───────────────────────────────────────────────
// We pull all data from products since warehouse_products has both
// inventory AND backorder fields. No need to query orders separately.

const GET_PRODUCTS = `
  query GetProducts($cursor: String) {
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
              warehouse { identifier }
            }
          }
        }
      }
    }
  }
`;

const GET_PRODUCT_BY_SKU = `
  query GetProductBySku($sku: String!) {
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

// ─── Shared: fetch all products with pagination ───────────────────────────────

async function fetchAllProducts() {
  const results = [];
  let cursor = null;
  let hasNextPage = true;
  let pages = 0;
  const MAX_PAGES = 4;

  while (hasNextPage && pages < MAX_PAGES) {
    const result = await runQuery(GET_PRODUCTS, { cursor });
    const { edges, pageInfo } = result.products.data;
    pages++;

    for (const { node: product } of edges) {
      const warehouses = (product.warehouse_products || []).map((w) => ({
        name: w.warehouse?.identifier || "Unknown",
        on_hand: w.on_hand || 0,
        available: w.available || 0,
        allocated: w.allocated || 0,
        backorder: w.backorder || 0,
      }));

      const totals = warehouses.reduce(
        (acc, w) => ({
          on_hand: acc.on_hand + w.on_hand,
          available: acc.available + w.available,
          allocated: acc.allocated + w.allocated,
          backorder: acc.backorder + w.backorder,
        }),
        { on_hand: 0, available: 0, allocated: 0, backorder: 0 }
      );

      results.push({
        sku: product.sku,
        name: product.name,
        warehouses,
        ...totals,
      });
    }

    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return { items: results, truncated: hasNextPage };
}

// ─── Backorders ───────────────────────────────────────────────────────────────
// Backorders = products where warehouse_products.backorder > 0

async function getAllBackorders() {
  const { items, truncated } = await fetchAllProducts();
  return {
    items: items
      .filter((p) => p.backorder > 0)
      .sort((a, b) => b.backorder - a.backorder),
    truncated,
  };
}

async function getBackorderBySku(sku) {
  const result = await runQuery(GET_PRODUCT_BY_SKU, { sku });
  const product = result.product.data;
  if (!product) return [];

  const warehouses = (product.warehouse_products || []).map((w) => ({
    name: w.warehouse?.identifier || "Unknown",
    on_hand: w.on_hand || 0,
    available: w.available || 0,
    allocated: w.allocated || 0,
    backorder: w.backorder || 0,
  }));

  const totals = warehouses.reduce(
    (acc, w) => ({
      on_hand: acc.on_hand + w.on_hand,
      available: acc.available + w.available,
      allocated: acc.allocated + w.allocated,
      backorder: acc.backorder + w.backorder,
    }),
    { on_hand: 0, available: 0, allocated: 0, backorder: 0 }
  );

  if (totals.backorder === 0) return [];

  return [{ sku: product.sku, name: product.name, warehouses, ...totals }];
}

// ─── Inventory ────────────────────────────────────────────────────────────────

async function getAllInventory() {
  return fetchAllProducts();
}

async function getInventoryBySku(sku) {
  const result = await runQuery(GET_PRODUCT_BY_SKU, { sku });
  const product = result.product.data;
  if (!product) return null;

  const warehouses = (product.warehouse_products || []).map((w) => ({
    name: w.warehouse?.identifier || "Unknown",
    on_hand: w.on_hand || 0,
    available: w.available || 0,
    allocated: w.allocated || 0,
    backorder: w.backorder || 0,
  }));

  const totals = warehouses.reduce(
    (acc, w) => ({
      on_hand: acc.on_hand + w.on_hand,
      available: acc.available + w.available,
      allocated: acc.allocated + w.allocated,
      backorder: acc.backorder + w.backorder,
    }),
    { on_hand: 0, available: 0, allocated: 0, backorder: 0 }
  );

  return { sku: product.sku, name: product.name, warehouses, ...totals };
}

async function getLowStockItems(threshold = 10) {
  const { items, truncated } = await fetchAllProducts();
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
