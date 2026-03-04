function truncatedNote(truncated, command) {
  if (!truncated) return null;
  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `⚠️ _Results capped at 200 items. Use \`${command}\` to search a specific SKU._`,
      },
    ],
  };
}

function formatAllBackorders({ items: backorders, truncated }) {
  if (!backorders.length) {
    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "✅ *No active backorders found!*" },
        },
      ],
    };
  }

  const rows = backorders
    .slice(0, 40)
    .map(
      (b) =>
        `• *${b.sku}* — \`${b.total_backordered} units\` | Orders: ${b.order_ids.slice(0, 3).join(", ")}${b.order_ids.length > 3 ? ` +${b.order_ids.length - 3} more` : ""}`
    )
    .join("\n");

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `📦 Current Backorders — ${backorders.length} SKUs`,
      },
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: rows } },
  ];

  const note = truncatedNote(truncated, "/backorder-sku");
  if (note) blocks.push(note);

  return { response_type: "in_channel", blocks };
}

function formatBackorderBySku(results, sku) {
  if (!results.length) {
    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ No backorders found for SKU: *${sku}*`,
          },
        },
      ],
    };
  }

  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: `🔍 Backorders for "${sku}"` },
    },
    { type: "divider" },
  ];

  for (const b of results) {
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*SKU*\n${b.sku}` },
        { type: "mrkdwn", text: `*Product*\n${b.name || "—"}` },
        { type: "mrkdwn", text: `*Units Backordered*\n${b.total_backordered}` },
        { type: "mrkdwn", text: `*Orders Affected*\n${b.order_ids.length}` },
      ],
    });
    if (b.order_ids.length) {
      blocks.push({
        type: "context",
        elements: [
          { type: "mrkdwn", text: `📋 Order IDs: ${b.order_ids.join(", ")}` },
        ],
      });
    }
    blocks.push({ type: "divider" });
  }

  return { response_type: "in_channel", blocks };
}

function formatAllInventory({ items, truncated }) {
  if (!items.length) {
    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "_No inventory data found._" },
        },
      ],
    };
  }

  const rows = items
    .slice(0, 40)
    .map(
      (p) =>
        `• *${p.sku}* — Available: \`${p.available}\` | On Hand: ${p.on_hand} | Allocated: ${p.allocated}`
    )
    .join("\n");

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🏭 Available Inventory — ${items.length} SKUs`,
      },
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: rows } },
  ];

  const note = truncatedNote(truncated, "/inventory-sku");
  if (note) blocks.push(note);

  return { response_type: "in_channel", blocks };
}

function formatInventoryBySku(product) {
  if (!product) {
    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "❌ SKU not found in ShipHero." },
        },
      ],
    };
  }

  const warehouseRows =
    product.warehouses
      ?.map(
        (w) =>
          `• *${w.name}* — Available: ${w.available} | On Hand: ${w.on_hand} | Allocated: ${w.allocated}`
      )
      .join("\n") || "_No warehouse data_";

  return {
    response_type: "in_channel",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📊 Inventory: ${product.sku}` },
      },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*SKU*\n${product.sku}` },
          { type: "mrkdwn", text: `*Product*\n${product.name || "—"}` },
          { type: "mrkdwn", text: `*Available*\n${product.available}` },
          { type: "mrkdwn", text: `*On Hand*\n${product.on_hand}` },
          { type: "mrkdwn", text: `*Allocated*\n${product.allocated}` },
          { type: "mrkdwn", text: `*Backordered*\n${product.backorder}` },
        ],
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Warehouse Breakdown*\n${warehouseRows}`,
        },
      },
    ],
  };
}

function formatLowStock({ items, truncated }, threshold) {
  if (!items.length) {
    return {
      response_type: "in_channel",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `✅ No items below *${threshold}* available units.`,
          },
        },
      ],
    };
  }

  const rows = items
    .map(
      (p) =>
        `• *${p.sku}* — Available: \`${p.available}\` | On Hand: ${p.on_hand}`
    )
    .join("\n");

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `⚠️ Low Stock (≤${threshold} units) — ${items.length} SKUs`,
      },
    },
    { type: "divider" },
    { type: "section", text: { type: "mrkdwn", text: rows } },
  ];

  const note = truncatedNote(truncated, "/inventory-sku");
  if (note) blocks.push(note);

  return { response_type: "in_channel", blocks };
}

function formatHelp() {
  return {
    response_type: "in_channel",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🤖 ShipHero Bot — Commands" },
      },
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*📦 Backorder Commands*\n`/backorders` — All SKUs with active backorders\n`/backorder-sku [sku]` — Backorder details for a specific SKU",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*🏭 Inventory Commands*\n`/inventory` — Available inventory for all SKUs\n`/inventory-sku [sku]` — Full breakdown for a specific SKU\n`/low-stock` — SKUs with ≤10 available units\n`/low-stock [number]` — SKUs below a custom threshold",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*ℹ️ Other*\n`/shiphero-help` — Show this help message",
        },
      },
    ],
  };
}

module.exports = {
  formatAllBackorders,
  formatBackorderBySku,
  formatAllInventory,
  formatInventoryBySku,
  formatLowStock,
  formatHelp,
};
