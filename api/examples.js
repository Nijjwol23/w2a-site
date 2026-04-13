const EXAMPLES = [
    {
      type: "ecommerce",
      label: "E-commerce store",
      manifest: {
        w2a: "1.0",
        site: { name: "Acme Store", type: "ecommerce", language: "en", description: "Online store selling outdoor equipment" },
        skills: [
          { id: "search_products", intent: "search for products by keyword, category or price range", action: "GET /api/products", input: { q: "string?", category: "string?", max_price: "float?", limit: "int?" }, output: { items: "object[]", total: "int" }, auth: "none" },
          { id: "get_product", intent: "get full details and stock level for a specific product", action: "GET /api/products/:id", input: { id: "string" }, output: { id: "string", name: "string", price: "float", in_stock: "bool" }, auth: "none" },
          { id: "add_to_cart", intent: "add a product to the shopping cart", action: "POST /api/cart/items", input: { sku: "string", qty: "int" }, output: { cart_id: "string", subtotal: "float" }, auth: "session" },
          { id: "checkout", intent: "complete a purchase for all items in the cart", action: "POST /api/orders", input: { cart_id: "string", payment_token: "string" }, output: { order_id: "string", status: "string", estimated_delivery: "string" }, auth: "session" }
        ],
        policies: { rate_limit: "60/min", allowed_agents: ["*"] },
        a2a_profile: { name: "Acme Store Agent", url: "https://acme.com/.well-known/agents.json", version: "1.0" }
      }
    },
    {
      type: "blog",
      label: "Blog / media site",
      manifest: {
        w2a: "1.0",
        site: { name: "The Daily Read", type: "blog", language: "en" },
        skills: [
          { id: "search_articles", intent: "search articles by topic, tag or keyword", action: "GET /api/posts", input: { q: "string", tag: "string?", limit: "int?", from_date: "string?" }, output: { articles: "object[]", total: "int" }, auth: "none" },
          { id: "get_article", intent: "read the full text content of a specific article", action: "GET /api/posts/:slug", input: { slug: "string" }, output: { title: "string", content: "string", author: "string", published_at: "string", tags: "string[]" }, auth: "none" }
        ],
        policies: { rate_limit: "120/min", allowed_agents: ["*"] }
      }
    },
    {
      type: "saas",
      label: "SaaS product",
      manifest: {
        w2a: "1.0",
        site: { name: "Acme Analytics", type: "saas", description: "Web analytics platform" },
        skills: [
          { id: "get_report", intent: "retrieve an analytics report for a given date range and metric", action: "GET /api/v2/reports", input: { from: "string", to: "string", metric: "string", granularity: "string?" }, output: { data: "object[]", total: "float", generated_at: "string" }, auth: "apikey" },
          { id: "list_dashboards", intent: "list all dashboards in the account", action: "GET /api/v2/dashboards", input: {}, output: { dashboards: "object[]" }, auth: "bearer" },
          { id: "create_event", intent: "track a custom analytics event", action: "POST /api/v2/events", input: { event: "string", properties: "object?", user_id: "string?" }, output: { event_id: "string", recorded_at: "string" }, auth: "apikey" }
        ],
        policies: { rate_limit: "30/min", allowed_agents: ["*"], require_identity: true }
      }
    },
    {
      type: "marketplace",
      label: "Marketplace",
      manifest: {
        w2a: "1.0",
        site: { name: "Maker Market", type: "marketplace", description: "Multi-vendor marketplace for handmade goods" },
        skills: [
          { id: "search_listings", intent: "search marketplace listings by keyword, category or seller", action: "GET /api/listings", input: { q: "string?", category: "string?", seller_id: "string?", min_price: "float?", max_price: "float?" }, output: { listings: "object[]", total: "int" }, auth: "none" },
          { id: "get_seller", intent: "get profile and listings for a specific seller", action: "GET /api/sellers/:id", input: { id: "string" }, output: { name: "string", rating: "float", listing_count: "int", listings: "object[]" }, auth: "none" },
          { id: "place_order", intent: "purchase a listing from a seller", action: "POST /api/orders", input: { listing_id: "string", qty: "int", shipping_address_id: "string" }, output: { order_id: "string", total: "float", seller_name: "string" }, auth: "bearer" }
        ],
        policies: { rate_limit: "60/min", allowed_agents: ["*"] }
      }
    },
    {
      type: "api",
      label: "API / developer tool",
      manifest: {
        w2a: "1.0",
        site: { name: "W2A Protocol", type: "api", description: "Open standard for agent-readable websites" },
        skills: [
          { id: "validate_manifest", intent: "validate an agents.json manifest against the W2A spec", action: "POST /api/validate", input: { manifest: "object" }, output: { valid: "bool", errors: "object[]", warnings: "object[]" }, auth: "none" },
          { id: "check_site", intent: "check whether a domain serves a valid W2A manifest", action: "GET /api/check", input: { url: "string" }, output: { w2a_enabled: "bool", valid: "bool?", capability_count: "int?" }, auth: "none" }
        ],
        policies: { rate_limit: "60/min", allowed_agents: ["*"] }
      }
    }
  ];
  
  export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
  
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
    const { type } = req.query;
  
    const results = type
      ? EXAMPLES.filter(e => e.type === type)
      : EXAMPLES;
  
    if (type && results.length === 0) {
      return res.status(404).json({
        error: `No examples found for type "${type}"`,
        available_types: [...new Set(EXAMPLES.map(e => e.type))]
      });
    }
  
    return res.status(200).json({ examples: results });
  }