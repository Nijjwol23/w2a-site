const SITE_TYPES = ['ecommerce','blog','content','saas','marketplace','media','directory','api','other'];

// Signals weighted by specificity. Strong signals count 2x, weak signals 1x.
// This prevents marketing copy mentioning 'shop' or 'product' from misclassifying a content site.
const TYPE_SIGNALS = {
  ecommerce:   {
    strong: ['add to cart','add-to-cart','shopping cart','checkout','buy now','cart/items','quantity','sku'],
    weak:   ['product','shop','store','cart','buy','price','catalog','inventory','order']
  },
  blog:        {
    strong: ['blogposting','datepublished','author','byline'],
    weak:   ['article','post','blog','category','tag','publish','editorial','read']
  },
  content:     {
    strong: ['tutorial','documentation','guide','glossary','knowledge base','wiki','docs/','/articles','/tutorials','/guides','/posts','/topics'],
    weak:   ['learn','course','chapter','section','reference','manual','handbook','news','articles','community']
  },
  saas:        {
    strong: ['dashboard','workspace','billing','subscribe now','free trial','sign up'],
    weak:   ['analytics','report','integration','account','platform']
  },
  marketplace: {
    strong: ['seller','vendor','bid','auction','marketplace','listing fee'],
    weak:   ['listing','offer','commission']
  },
  media:       {
    strong: ['watch now','episode','podcast','stream','channel','season'],
    weak:   ['video','audio','watch','subscribe']
  },
  directory:   {
    strong: ['business listing','directory','find a','locate','near me'],
    weak:   ['listing','review','rating','business','location']
  },
  api:         {
    strong: ['openapi','swagger','api reference','api docs','authentication','endpoint','rate limit'],
    weak:   ['api','developer','sdk','token']
  }
};

// Common OpenAPI/Swagger spec locations to probe
const OPENAPI_PATHS = [
  '/openapi.json', '/openapi.yaml',
  '/swagger.json', '/swagger.yaml',
  '/api/openapi.json', '/api/swagger.json',
  '/api-docs', '/api-docs.json',
  '/api-docs/swagger.json',
  '/docs/api.json', '/docs/swagger.json',
  '/v1/openapi.json', '/v2/openapi.json', '/v3/openapi.json',
  '/v1/swagger.json', '/v2/swagger.json', '/v3/swagger.json',
  '/api/v1/openapi.json', '/api/v2/openapi.json', '/api/v3/openapi.json',
  '/api/v1/swagger.json', '/api/v2/swagger.json', '/api/v3/swagger.json',
  '/.well-known/openapi.json',
  '/spec/openapi.json', '/schema/openapi.json',
  '/api/schema', '/api/spec'
];

function detectSiteType(html, url, declared) {
  // User-declared type always wins
  if (declared && SITE_TYPES.includes(declared)) return declared;
  
  const text = (html + ' ' + url).toLowerCase();
  const scores = {};
  
  for (const [type, signals] of Object.entries(TYPE_SIGNALS)) {
    let score = 0;
    // Strong signals count 3x, weak signals 1x
    signals.strong.forEach(s => {
      if (text.includes(s)) score += 3;
    });
    signals.weak.forEach(s => {
      if (text.includes(s)) score += 1;
    });
    scores[type] = score;
  }
  
  // Find the winner
  let best = 'other', bestScore = 0;
  for (const [type, score] of Object.entries(scores)) {
    if (score > bestScore) { bestScore = score; best = type; }
  }
  
  // Ecommerce requires very strong signals — prevents misclassification
  // when a site just mentions 'shop' or 'product' in marketing copy
  if (best === 'ecommerce' && bestScore < 6) {
    // Check if content signals are competitive
    if (scores.content >= bestScore * 0.7) return 'content';
    if (scores.blog >= bestScore * 0.7) return 'blog';
  }
  
  return bestScore >= 3 ? best : 'other';
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
  const formRe = /<form[^>]*action=["']([^"']*)"[^>]*method=["']([^"']*)"[^>]*>([\s\S]*?)<\/form>/gi;
  let fm;
  while ((fm = formRe.exec(html)) !== null) {
    const action = fm[1], method = (fm[2] || 'GET').toUpperCase();
    const inputs = [];
    const inputRe = /<input[^>]+name=["']([^"']+)["'][^>]*(?:type=["']([^"']+)["'])?[^>]*>/gi;
    let im;
    while ((im = inputRe.exec(fm[3])) !== null) {
      if (!['hidden','submit','button','csrf','_token'].includes(im[1].toLowerCase()))
        inputs.push({ name: im[1], type: im[2] || 'text' });
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
        patterns.add('/' + parts.slice(0, -1).join('/') + '/:id');
      }
    }
  });
  return [...patterns].slice(0, 5);
}

// ── OpenAPI parser ──────────────────────────────────────────────────────────

function mapOpenApiType(schema) {
  if (!schema) return 'string';
  if (schema.type === 'integer' || schema.type === 'number') return 'int';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'array') return 'object[]';
  if (schema.type === 'object') return 'object';
  return 'string';
}

function skillIdFromPath(method, path) {
  const clean = path
    .replace(/[{:][^}/]+}/g, 'by_id')
    .replace(/:[a-z_]+/gi, 'by_id')
    .replace(/\{[^}]+\}/g, 'by_id')
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  return `${method.toLowerCase()}_${clean}`.slice(0, 40);
}

function toSentenceCase(str) {
  if (!str) return str;
  const s = str.trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
    .replace(/\b(id|api|url|http|json|xml|oauth|jwt)\b/gi, m => m.toUpperCase());
}

function intentFromOperation(method, path, operation) {
  const raw = operation.summary || (operation.description ? operation.description.split('.')[0] : null);
  if (raw) return toSentenceCase(raw);
  const action = { get: 'retrieve', post: 'create', put: 'update', patch: 'update', delete: 'delete' }[method] || method;
  const resource = path.split('/').filter(p => p && !p.startsWith('{')).pop() || 'resource';
  return toSentenceCase(`${action} ${resource.replace(/_/g, ' ')}`);
}

function authFromSecurity(operation, globalSecurity, securitySchemes) {
  const sec = operation.security ?? globalSecurity ?? [];
  if (!sec || sec.length === 0) return 'none';
  const scheme = Object.keys(sec[0] || {})[0];
  if (!scheme || !securitySchemes) return 'bearer';
  const def = securitySchemes[scheme];
  if (!def) return 'bearer';
  if (def.type === 'apiKey') return 'apikey';
  if (def.type === 'http' && def.scheme === 'bearer') return 'bearer';
  if (def.type === 'oauth2') return 'oauth2';
  return 'bearer';
}

function skillsFromOpenApi(spec) {
  const skills = [];
  const signals = [];
  const paths = spec.paths || {};
  const globalSecurity = spec.security;
  const securitySchemes = spec.components?.securitySchemes || spec.securityDefinitions || {};

  let count = 0;
  for (const [path, methods] of Object.entries(paths)) {
    if (count >= 8) break;
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get','post','put','patch','delete'].includes(method)) continue;
      if (count >= 8) break;

      const id = skillIdFromPath(method, path);
      const intent = intentFromOperation(method, path, operation);
      const auth = authFromSecurity(operation, globalSecurity, securitySchemes);

      // Build input from parameters
      const input = {};
      const params = [...(spec.components?.parameters ? [] : []), ...(operation.parameters || [])];
      params.forEach(p => {
        if (p.in === 'query' || p.in === 'path') {
          const name = p.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
          const required = p.required ? '' : '?';
          const type = mapOpenApiType(p.schema || {});
          input[name] = type.replace('?', '') + (p.required ? '' : '?');
        }
      });

      // Build input from requestBody
      const body = operation.requestBody?.content?.['application/json']?.schema;
      if (body?.properties) {
        const required = body.required || [];
        Object.entries(body.properties).slice(0, 5).forEach(([k, v]) => {
          const name = k.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
          input[name] = mapOpenApiType(v) + (required.includes(k) ? '' : '?');
        });
      }

      // Build output from 200 response
      const output = {};
      const resp200 = operation.responses?.['200']?.content?.['application/json']?.schema;
      if (resp200?.properties) {
        Object.entries(resp200.properties).slice(0, 5).forEach(([k, v]) => {
          output[k.replace(/[^a-z0-9_]/gi, '_').toLowerCase()] = mapOpenApiType(v);
        });
      }

      const skill = {
        id,
        intent: intent.slice(0, 120),
        action: `${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`,
        auth
      };
      if (Object.keys(input).length) skill.input = input;
      if (Object.keys(output).length) skill.output = output;
      else skill.output = { data: 'object' };

      skills.push(skill);
      count++;
    }
  }

  if (skills.length > 0) {
    const title = spec.info?.title || 'API';
    signals.push(`OpenAPI spec found — ${skills.length} endpoint(s) imported from "${title}"`);
  }

  return { skills, signals };
}

// ── Signal-based skill builder (fallback) ──────────────────────────────────

function buildSkillsFromSignals({ siteType, jsonLd, og, forms, pathPatterns }) {
  const skills = [];
  const signals = [];

  const searchAction = siteType === 'ecommerce' ? 'GET /api/search' :
                       siteType === 'blog'      ? 'GET /api/posts'  :
                       siteType === 'content'   ? 'GET /api/search' :
                       siteType === 'saas'      ? 'GET /api/data'   : 'GET /api/search';
  const searchIntent = siteType === 'ecommerce' ? 'Search for products by keyword or category' :
                       siteType === 'blog'      ? 'Search articles by topic or keyword'        :
                       siteType === 'content'   ? 'Search across articles, tutorials, and tools' :
                       siteType === 'saas'      ? 'Search or retrieve data'                    :
                                                  'Search the site';
  skills.push({
    id: 'search', intent: searchIntent, action: searchAction,
    input: { q: 'string', limit: 'int?' },
    output: { items: 'object[]', total: 'int' },
    auth: 'none'
  });
  signals.push('default search skill added');

  const hasProduct = jsonLd.some(j => j['@type'] === 'Product' || j['@type'] === 'ItemList');
  if (siteType === 'ecommerce' || hasProduct) {
    if (hasProduct) signals.push('Schema.org Product detected');
    skills.push({ id: 'get_product', intent: 'get full details for a specific product', action: 'GET /api/products/:id', input: { id: 'string' }, output: { id: 'string', name: 'string', price: 'float', in_stock: 'bool' }, auth: 'none' });
    skills.push({ id: 'add_to_cart', intent: 'add a product to the shopping cart', action: 'POST /api/cart/items', input: { sku: 'string', qty: 'int' }, output: { cart_id: 'string', subtotal: 'float' }, auth: 'session' });
    skills.push({ id: 'checkout', intent: 'complete a purchase', action: 'POST /api/orders', input: { cart_id: 'string', payment_token: 'string' }, output: { order_id: 'string', status: 'string' }, auth: 'session' });
  }

  if (siteType === 'blog') {
    const hasArticle = jsonLd.some(j => j['@type'] === 'Article' || j['@type'] === 'BlogPosting');
    if (hasArticle) signals.push('Schema.org Article detected');
    skills.push({ id: 'get_article', intent: 'Read the full content of an article', action: 'GET /api/posts/:slug', input: { slug: 'string' }, output: { title: 'string', content: 'string', author: 'string', published_at: 'string' }, auth: 'none' });
  }

  if (siteType === 'content') {
    const hasArticle = jsonLd.some(j => j['@type'] === 'Article' || j['@type'] === 'BlogPosting' || j['@type'] === 'TechArticle');
    if (hasArticle) signals.push('Schema.org Article detected');
    
    // Content sites typically have: articles, tutorials/guides, topics, tags, and sometimes tools
    skills.push({
      id: 'list_articles',
      intent: 'Browse articles, tutorials, and guides',
      action: 'GET /api/articles',
      input: { category: 'string?', tag: 'string?', limit: 'int?' },
      output: { articles: 'object[]', total: 'int' },
      auth: 'none'
    });
    skills.push({
      id: 'get_article',
      intent: 'Get full content of a specific article',
      action: 'GET /api/articles/:slug',
      input: { slug: 'string' },
      output: { title: 'string', content: 'string', author: 'string', published_at: 'string', tags: 'string[]' },
      auth: 'none'
    });
    skills.push({
      id: 'list_topics',
      intent: 'Browse topic collections that group related content',
      action: 'GET /api/topics',
      input: {},
      output: { topics: 'object[]' },
      auth: 'none'
    });
    skills.push({
      id: 'list_tags',
      intent: 'Browse all tags used to classify content',
      action: 'GET /api/tags',
      input: {},
      output: { tags: 'object[]' },
      auth: 'none'
    });
    signals.push('Content site skills template applied');
  }

  forms.slice(0, 2).forEach(form => {
    const actionPath = form.action.startsWith('http') ? new URL(form.action).pathname : form.action;
    const id = actionPath.replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'form_submit';
    const input = {};
    form.inputs.forEach(inp => {
      const name = inp.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      input[name] = inp.type === 'number' ? 'int' : 'string';
    });
    if (!skills.find(s => s.id === id)) {
      skills.push({ id, intent: `submit the ${id.replace(/_/g, ' ')} form`, action: `${form.method} ${actionPath}`, input, output: { success: 'bool' }, auth: 'none' });
      signals.push(`HTML form: ${form.method} ${actionPath}`);
    }
  });

  pathPatterns.forEach(pat => {
    const id = pat.replace(/[^a-z0-9]/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
    if (!skills.find(s => s.id === id)) {
      skills.push({ id, intent: `retrieve a specific ${id.replace(/_id$/, '').replace(/_/g, ' ')}`, action: `GET ${pat}`, input: { id: 'string' }, output: { data: 'object' }, auth: 'none' });
      signals.push(`URL pattern: ${pat}`);
    }
  });

  return { skills: skills.slice(0, 8), signals };
}

function calcConfidence(signals, jsonLd, og, forms, openApiFound) {
  if (openApiFound) return 0.92;
  let score = 0.20;
  if (jsonLd.length > 0) score += 0.25;
  if (Object.keys(og).length > 2) score += 0.15;
  if (forms.length > 0) score += 0.15;
  if (signals.length > 3) score += 0.10;
  return Math.min(score, 0.85);
}

function lowSignalNote(hostname, openApiPaths) {
  return [
    `Limited signals detected on ${hostname} — the site may be JavaScript-rendered or block automated crawlers.`,
    `The manifest below is a starting template only. To produce an accurate manifest:`,
    `1. If your site has an OpenAPI/Swagger spec, host it at one of: ${openApiPaths.slice(0,3).join(', ')}`,
    `2. Add Schema.org JSON-LD to your pages (https://schema.org)`,
    `3. Or manually edit the skills below to match your actual API endpoints.`
  ].join(' ');
}


function extractSwaggerUiSpecUrl(html, origin) {
  // Swagger UI embeds the spec URL in JS config: url: "https://..."
  const patterns = [
    /SwaggerUIBundle\s*\(\s*\{[^}]*url\s*:\s*["']([^"']+)["']/i,
    /url\s*:\s*["'](https?:\/\/[^"']+(?:openapi|swagger)[^"']*)["']/i,
    /data-url=["']([^"']+)["']/i,
    /"urls"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/i
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      const url = m[1].startsWith('http') ? m[1] : origin + m[1];
      return url;
    }
  }
  return null;
}

// ── Main handler ────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  let { url, site_type } = body || {};
  if (!url) return res.status(400).json({ error: 'url is required' });
  if (!url.startsWith('http')) url = 'https://' + url;

  let origin, hostname;
  try { const p = new URL(url); origin = p.origin; hostname = p.hostname; }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const headers = { 'User-Agent': 'W2ABot/1.0 (+https://w2a-protocol.org)' };
  let html = '', sitemap = '';
  const fetchSignals = [];

  // 1. Fetch homepage
  try {
    const r = await fetch(origin, { headers, signal: AbortSignal.timeout(8000) });
    if (r.ok) { html = await r.text(); fetchSignals.push('homepage fetched'); }
    else fetchSignals.push(`homepage returned HTTP ${r.status}`);
  } catch (e) {
    fetchSignals.push(`homepage unreachable: ${e.message}`);
  }

  // 2. Try sitemap
  try {
    const r = await fetch(`${origin}/sitemap.xml`, { headers, signal: AbortSignal.timeout(4000) });
    if (r.ok) { sitemap = await r.text(); fetchSignals.push('sitemap.xml found'); }
  } catch {}

  // 3. Try OpenAPI / Swagger specs
  let openApiSpec = null;
  let openApiFound = false;
  let openApiPath = '';

  // First check if this is a Swagger UI page and extract the embedded spec URL
  const swaggerUiUrl = html ? extractSwaggerUiSpecUrl(html, origin) : null;
  const pathsToTry = swaggerUiUrl
    ? [new URL(swaggerUiUrl).pathname, ...OPENAPI_PATHS]
    : OPENAPI_PATHS;
  if (swaggerUiUrl) fetchSignals.push(`Swagger UI detected — probing spec at ${swaggerUiUrl}`);

  for (const path of pathsToTry) {
    try {
      const specUrl = path.startsWith('http') ? path : `${origin}${path}`;
      const r = await fetch(specUrl, { headers, signal: AbortSignal.timeout(4000) });
      if (r.ok) {
        const ct = r.headers.get('content-type') || '';
        if (ct.includes('json') || ct.includes('yaml') || ct.includes('text')) {
          const text = await r.text();
          try {
            const parsed = JSON.parse(text);
            if (parsed.openapi || parsed.swagger || parsed.paths) {
              openApiSpec = parsed;
              openApiFound = true;
              openApiPath = path.startsWith('http') ? new URL(path).pathname : path;
              fetchSignals.push(`OpenAPI spec found at ${path}`);
              break;
            }
          } catch {}
        }
      }
    } catch {}
  }

  // Extract signals from HTML
  const jsonLd       = extractJsonLd(html);
  const og           = extractOpenGraph(html);
  const forms        = extractForms(html);
  const pathPatterns = inferPathPattern(extractSitemapPaths(sitemap));

  if (jsonLd.length)            fetchSignals.push(`${jsonLd.length} JSON-LD block(s) found`);
  if (Object.keys(og).length)   fetchSignals.push('Open Graph tags found');
  if (forms.length)             fetchSignals.push(`${forms.length} HTML form(s) found`);
  if (pathPatterns.length)      fetchSignals.push(`${pathPatterns.length} URL pattern(s) from sitemap`);

  // Site metadata
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle   = og['site_name'] || og['title'] ||
                     (titleMatch ? titleMatch[1].trim() : null) ||
                     hostname.replace(/^www\./, '').split('.')[0];
  const siteName   = rawTitle.split(/[|\-–]/)[0].trim();
  // site_type picker only sets site.type — skills always come from OpenAPI first,
  // falling back to HTML signals. Declared type is never used to fabricate skills.
  const siteType = detectSiteType(html, url, site_type);
  // For skill generation, only use declared type if no OpenAPI and no HTML signals found
  const skillType = openApiFound ? 'api' : siteType;

  // Build skills — OpenAPI always wins, HTML signals as fallback
  let skills, skillSignals;
  if (openApiFound && openApiSpec) {
    ({ skills, signals: skillSignals } = skillsFromOpenApi(openApiSpec));
    if (skills.length === 0) {
      // OpenAPI was empty — fall back without ecommerce fabrication
      ({ skills, signals: skillSignals } = buildSkillsFromSignals({ siteType: 'other', jsonLd, og, forms, pathPatterns }));
    }
  } else if (jsonLd.length > 0 || forms.length > 0 || pathPatterns.length > 0) {
    // Real HTML signals found — use declared type to enrich
    ({ skills, signals: skillSignals } = buildSkillsFromSignals({ siteType, jsonLd, og, forms, pathPatterns }));
  } else {
    // No signals at all — generic skeleton, ignore declared type
    ({ skills, signals: skillSignals } = buildSkillsFromSignals({ siteType: 'other', jsonLd, og, forms, pathPatterns }));
    skillSignals.push('No signals found — generic skeleton generated. Edit skills to match your actual API.');
  }

  const allSignals = [...fetchSignals, ...skillSignals];
  const conf = calcConfidence(allSignals, jsonLd, og, forms, openApiFound);

  // Low signal detection
  const isLowSignal = !openApiFound && jsonLd.length === 0 && forms.length === 0 && pathPatterns.length === 0;

  // Detect language from html lang attribute, then fall back to og:locale, then 'en'
  const htmlLangMatch = html.match(/<html[^>]+lang=["']([a-z\-]{2,7})["']/i);
  const detectedLang = htmlLangMatch ? htmlLangMatch[1].split('-')[0].toLowerCase() :
                       og['locale']?.split('_')[0]?.toLowerCase() || 'en';

  const manifest = {
    w2a: '1.0',
    site: {
      name: siteName,
      type: siteType,
      language: detectedLang,
      ...(og['description'] && { description: og['description'] })
    },
    skills,
    policies: { rate_limit: '60/min', allowed_agents: ['*'] }
  };

  const noteText = isLowSignal
    ? lowSignalNote(hostname, OPENAPI_PATHS)
    : openApiFound
      ? `Generated from OpenAPI spec at ${origin}${openApiPath}. Review and adjust skill descriptions before deploying.`
      : 'Generated from page signals. Review each skill and adjust actions to match your actual API endpoints before deploying.';
  const confidencePct = Math.round(conf * 100);
  const note = `[Confidence: ${confidencePct}%] ${noteText}`;

  return res.status(200).json({
    manifest,
    confidence: Math.round(conf * 100) / 100,
    signals_found: allSignals,
    openapi_source: openApiFound ? `${origin}${openApiPath}` : null,
    low_signal: isLowSignal,
    note
  });
}