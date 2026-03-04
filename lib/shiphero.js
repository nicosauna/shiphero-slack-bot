const axios = require("axios");

const SHIPHERO_API_URL = "https://public-api.shiphero.com/graphql";

async function query(gql, variables = {}) {
  try {
    const response = await axios.post(
      SHIPHERO_API_URL,
      { query: gql, variables },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.SHIPHERO_API_TOKEN}`,
        },
      }
    );
    if (response.data.errors) {
      throw new Error(response.data.errors.map((e) => e.message).join(", "));
    }
    return response.data.data;
  } catch (err) {
    throw new Error(`ShipHero API error: ${err.message}`);
  }
}

// ─── Backorders ───────────────────────────────────────────────────────────────

const GET_BACKORDERS = `
  query GetBackorders($cursor: String) {
    orders(
      fulfillment_status: "backordered"
      first: 50
      after: $cursor
    ) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          order_number
          line_items {
            edges {
              node {
                sku
                name
                quantity
                quantity_backordered
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

  while (hasNextPage) {
    const data = await query(GET_BACKORDERS, { cursor });
    const { edges, pageInfo } = data.orders;

    for (const { node: order } of edges) {
      for (const { node: item } of order.line_items.edges) {
        if (item.quantity_backordered > 0) {
          const sku = item.sku;
          if (!backorderMap[sku]) {
            backorderMap[sku] = {
              sku,
              name: item.name,
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

  return Object.values(backorderMap).sort(
    (a, b) => b.total_backordered - a.total_backordered
  );
}

async function getBackorderBySku(sku) {
  const all = await getAllBackorders();
  return all.filter((b) => b.sku.toLowerCase().includes(sku.toLowerCase()));
}

// ─── Inventory ────────────────────────────────────────────────────────────────

const GET_ALL_INVENTORY = `
  query GetInventory($cursor: String) {
    products(first: 50, after: $cursor) {
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
`;

const GET_INVENTORY_BY_SKU = `
  query GetInventoryBySku($sku: String!) {
    product(sku: $sku) {
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
`;

async function getAllInventory() {
  const results = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const data = await query(GET_ALL_INVENTORY, { cursor });
    const { edges, pageInfo } = data.products;

    for (const { node: product } of edges) {
      const totals = product.warehouse_products.reduce(
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

  return results;
}

async function getInventoryBySku(sku) {
  const data = await query(GET_INVENTORY_BY_SKU, { sku });
  if (!data.product) return null;
  const product = data.product;
  const totals = product.warehouse_products.reduce(
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
  const all = await getAllInventory();
  return all
    .filter((p) => p.available <= threshold && p.available >= 0)
    .sort((a, b) => a.available - b.available);
}

module.exports = {
  getAllBackorders,
  getBackorderBySku,
  getAllInventory,
  getInventoryBySku,
  getLowStockItems,
};
