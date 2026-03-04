const { Redis } = require("@upstash/redis");

// Initialize Redis from Vercel environment variables (auto-added by Upstash integration)
let redis = null;

function getRedis() {
  if (!redis) {
    redis = new Redis({
      url: process.env.KV_REST_API_URL || process.env.STORAGE_KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN || process.env.STORAGE_KV_REST_API_TOKEN,
    });
  }
  return redis;
}

// Cache TTL in seconds — 30 minutes
const CACHE_TTL = 60 * 30;

const KEYS = {
  ALL_PRODUCTS: "shiphero:all_products",
  LAST_REFRESH: "shiphero:last_refresh",
};

async function getCachedProducts() {
  try {
    const r = getRedis();
    const data = await r.get(KEYS.ALL_PRODUCTS);
    return data || null;
  } catch (err) {
    console.error("Cache read error:", err.message);
    return null; // Fall through to live fetch if cache fails
  }
}

async function setCachedProducts(data) {
  try {
    const r = getRedis();
    await r.set(KEYS.ALL_PRODUCTS, data, { ex: CACHE_TTL });
    await r.set(KEYS.LAST_REFRESH, new Date().toISOString(), { ex: CACHE_TTL });
    console.log("Cache updated successfully");
  } catch (err) {
    console.error("Cache write error:", err.message);
  }
}

async function getLastRefresh() {
  try {
    const r = getRedis();
    return await r.get(KEYS.LAST_REFRESH);
  } catch (err) {
    return null;
  }
}

async function clearCache() {
  try {
    const r = getRedis();
    await r.del(KEYS.ALL_PRODUCTS);
    await r.del(KEYS.LAST_REFRESH);
    return true;
  } catch (err) {
    console.error("Cache clear error:", err.message);
    return false;
  }
}

module.exports = {
  getCachedProducts,
  setCachedProducts,
  getLastRefresh,
  clearCache,
};
