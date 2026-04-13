const SITE_TYPES = ['ecommerce','blog','saas','marketplace','media','directory','api','other'];

const TYPE_SIGNALS = {
  ecommerce: ['product','shop','store','cart','checkout','buy','price','catalog','inventory','order'],
  blog:      ['article','post','blog','author','category','tag','publish','editorial','news','read'],
  saas:      ['dashboard','analytics','report','integration','workspace','account','billing','api','platform'],
  marketplace:['listing','seller','vendor','bid','auction','offer','commission','marketplace'],
  media:     ['video','audio','podcast','stream','watch','episode','channel','subscribe'],
  directory: ['listing','review','rating','business','location','find','search','directory'],
  api:       ['api','endpoint','developer','docs','sdk','token','rate-limit','swagger']
};

function detectSiteType(html, url, declared) {
  if (declared && SITE_TYPES.includes(declared)) return declared;
  const text = (html + url).toLowerCase();
  let best = 'other', bestScore = 0;
  for (const [type, signals] of Object.entries(TYPE_SIGNALS)) {
    const score = signals.filter(s => text.includes(s)).length;
    if (score > bestScore) { bestScore = score; best = type; }
  }
  return best;
}

function extractJsonLd(html) {
  const results = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1])); } catch {}
  }
  return results;
}

function extractOpenGraph(html) {
  const og = {};
  const re = /<meta[^>]+property=["']og:([^"']+)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) og[m[1]] = m[2];
  return og;
}

function extractForms(html) {
  const forms = [];
  const formRe = /<form[^>]*action=["']([^"']*)["'][^>]*method=["']([^"']*)["'][^>]*>([\s\S]*?)<\/form>/gi;
  let fm;
  while ((fm = formRe.exec(html)) !== null) {
    const action = fm[1], method = (fm[2] || 'GET').toUpperCase();
    const formHtml = fm[3];
    const inputs = [];
    const inputRe = /<input[^>]+name=["']([^"']+)["'][^>]*(?:type=["']([^"']+)["'])?[^>]*>/gi;
    let im;
    while ((im = inputRe.exec(formHtml)) !== null) {
      if (!['hidden','submit','button','csrf','_token'].includes(im[1].toLowerCase())) {
        inputs.push({ name: im[1], type: im[2] || 'text' });
      }
    }
    if (action && inputs.length > 0) forms.push({ action, method, inputs });
  }
  return forms;
}

function extractSitemapPaths(sitemap) {
  const paths = [];
  const re = /<loc>(https?:\/\/[^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(sitemap)) !== null) {
    try { paths.push(new URL(m[1]).pathname); } catch {}
  }
  return paths.slice(0, 50);
}

function inferPathPattern(paths) {
  const patterns = new Set();
  paths.forEach(p => {
    const parts = p.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      if (/^\d+$/.test(last) || /^[a-f0-9-]{8,}$/i.test(last)) {
        const base = '/' + parts.slice(0, -1).join('/') + '/:id';
        patterns.add(base);
      }
    }
  });
  return [...patterns].slice(0, 5);
}

function buildSkillsFromSignals({ siteType, jsonLd, og, forms, pathPatterns, siteName, url }) {
  const skills = [];
  const signals = [];

  // Always add a search skill
  const searchAction = siteType === 'ecommerce' ? 'GET /api/search' :
                       siteType === 'blog'      ? 'GET /api/posts' :
                       siteType === 'saas'      ? 'GET /api/data' : 'GET /api/search';

  const searchIntent = siteType === 'ecommerce' ? 'search for products by keyword or category' :
                       siteType === 'blog'      ? 'search articles by topic or keyword' :
                       siteType === 'saas'      ? 'search or retrieve data' : 'search the site';

  skills.push({
    id: 'search',
    intent: searchIntent,
    action: searchAction,
    input: { q: 'string', limit: 'int?' },
    output: { items: 'object[]', total: 'int' },
    auth: 'none'
  });
  signals.push('default search skill');

  // Ecommerce-specific skills from JSON-LD
  const hasProduct = jsonLd.some(j => j['@type'] === 'Product' || j['@type'] === 'ItemList');
  if (siteType === 'ecommerce' || hasProduct) {
    if (hasProduct) signals.push('Schema.org Product detected');
    skills.push({
      id: 'get_product',
      intent: 'get full details for a specific product',
      action: 'GET /api/products/:id',
      input: { id: 'string' },
      output: { id: 'string', name: 'string', price: 'float', in_stock: 'bool' },
      auth: 'none'
    });
    skills.push({
      id: 'add_to_cart',
      intent: 'add a product to the shopping cart',
      action: 'POST /api/cart/items',
      input: { sku: 'string', qty: 'int' },
      output: { cart_id: 'string', subtotal: 'float' },
      auth: 'session'
    });
    skills.push({
      id: 'checkout',
      intent: 'complete a purchase',
      action: 'POST /api/orders',
      input: { cart_id: 'string', payment_token: 'string' },
      output: { order_id: 'string', status: 'string' },
      auth: 'session'
    });
  }

  // Blog skills
  if (siteType === 'blog') {
    const hasArticle = jsonLd.some(j => j['@type'] === 'Article' || j['@type'] === 'BlogPosting');
    if (hasArticle) signals.push('Schema.org Article detected');
    skills.push({
      id: 'get_article',
      intent: 'read the full content of an article',
      action: 'GET /api/posts/:slug',
      input: { slug: 'string' },
      output: { title: 'string', content: 'string', author: 'string', published_at: 'string' },
      auth: 'none'
    });
  }

  // Forms → skills
  forms.slice(0, 2).forEach(form => {
    const actionPath = form.action.startsWith('http')
      ? new URL(form.action).pathname
      : form.action;
    const id = actionPath.replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'form_submit';
    const input = {};
    form.inputs.forEach(inp => {
      const name = inp.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      input[name] = inp.type === 'email' ? 'string' :
                    inp.type === 'number' ? 'int' : 'string';
    });
    if (!skills.find(s => s.id === id)) {
      skills.push({
        id,
        intent: `submit the ${id.replace(/_/g, ' ')} form`,
        action: `${form.method} ${actionPath}`,
        input,
        output: { success: 'bool' },
        auth: 'none'
      });
      signals.push(`HTML form detected: ${form.method} ${actionPath}`);
    }
  });

  // Path patterns → skills
  pathPatterns.forEach(pat => {
    const id = pat.replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
    if (!skills.find(s => s.id === id)) {
      skills.push({
        id,
        intent: `retrieve a specific ${id.replace(/_id$/, '').replace(/_/g, ' ')}`,
        action: `GET ${pat}`,
        input: { id: 'string' },
        output: { data: 'object' },
        auth: 'none'
      });
      signals.push(`URL pattern detected: ${pat}`);
    }
  });

  return { skills: skills.slice(0, 8), signals };
}

function confidence(signals, jsonLd, og, forms) {
  let score = 0.3;
  if (jsonLd.length > 0) score += 0.25;
  if (Object.keys(og).length > 2) score += 0.15;
  if (forms.length > 0) score += 0.15;
  if (signals.length > 3) score += 0.15;
  return Math.min(score, 0.95);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  let { url, site_type } = body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!url.startsWith('http')) url = 'https://' + url;

  let origin, hostname;
  try {
    const parsed = new URL(url);
    origin = parsed.origin;
    hostname = parsed.hostname;
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  let html = '', sitemap = '';
  const fetchSignals = [];

  // Fetch homepage
  try {
    const r = await fetch(origin, {
      headers: { 'User-Agent': 'W2ABot/1.0 (w2a-protocol.org)' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) { html = await r.text(); fetchSignals.push('homepage fetched'); }
  } catch {}

  // Try sitemap
  try {
    const r = await fetch(`${origin}/sitemap.xml`, { signal: AbortSignal.timeout(4000) });
    if (r.ok) { sitemap = await r.text(); fetchSignals.push('sitemap.xml found'); }
  } catch {}

  // Extract signals
  const jsonLd       = extractJsonLd(html);
  const og           = extractOpenGraph(html);
  const forms        = extractForms(html);
  const pathPatterns = inferPathPattern(extractSitemapPaths(sitemap));

  if (jsonLd.length)       fetchSignals.push(`${jsonLd.length} JSON-LD block(s) found`);
  if (Object.keys(og).length) fetchSignals.push(`Open Graph tags found`);
  if (forms.length)        fetchSignals.push(`${forms.length} HTML form(s) found`);
  if (pathPatterns.length) fetchSignals.push(`${pathPatterns.length} URL pattern(s) detected`);

  // Site metadata
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const siteName = og['site_name'] ||
                   og['title'] ||
                   (titleMatch ? titleMatch[1].trim().split(/[|\-–]/)[0].trim() : null) ||
                   hostname.replace(/^www\./, '').split('.')[0];

  const siteType = detectSiteType(html, url, site_type);
  const { skills, signals: skillSignals } = buildSkillsFromSignals({
    siteType, jsonLd, og, forms, pathPatterns, siteName, url
  });

  const allSignals = [...fetchSignals, ...skillSignals];
  const conf = confidence(allSignals, jsonLd, og, forms);

  const manifest = {
    w2a: '1.0',
    site: {
      name: siteName,
      type: siteType,
      language: og['locale']?.split('_')[0] || 'en',
      description: og['description'] || undefined
    },
    skills,
    policies: {
      rate_limit: '60/min',
      allowed_agents: ['*']
    }
  };

  // Clean undefined
  if (!manifest.site.description) delete manifest.site.description;

  return res.status(200).json({
    manifest,
    confidence: Math.round(conf * 100) / 100,
    signals_found: allSignals,
    note: 'This is a generated draft. Review each skill and adjust actions to match your actual API endpoints before deploying.'
  });
}
