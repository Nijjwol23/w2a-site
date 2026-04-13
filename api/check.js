export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
    let { url } = req.query;
    if (!url) return res.status(400).json({ error: 'url query parameter required. e.g. ?url=example.com' });
  
    if (!url.startsWith('http')) url = 'https://' + url;
  
    let origin;
    try {
      origin = new URL(url).origin;
    } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
  
    const manifestUrl = `${origin}/.well-known/agents.json`;
  
    try {
      const response = await fetch(manifestUrl, {
        headers: {
          'Accept': 'application/json',
          'Agent-W2A': '1.0',
          'Agent-Identity': 'w2a-protocol/checker'
        },
        signal: AbortSignal.timeout(8000)
      });
  
      if (response.status === 404) {
        return res.status(200).json({
          w2a_enabled: false,
          domain: origin,
          manifest_url: manifestUrl,
          checked_at: new Date().toISOString()
        });
      }
  
      if (!response.ok) {
        return res.status(200).json({
          w2a_enabled: false,
          domain: origin,
          manifest_url: manifestUrl,
          http_status: response.status,
          error: `Server returned ${response.status}`,
          checked_at: new Date().toISOString()
        });
      }
  
      let manifest;
      try {
        manifest = await response.json();
      } catch {
        return res.status(200).json({
          w2a_enabled: true,
          valid: false,
          domain: origin,
          manifest_url: manifestUrl,
          error: 'Response is not valid JSON',
          checked_at: new Date().toISOString()
        });
      }
  
      const validateRes = await fetch('https://w2a-protocol.org/api/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
        signal: AbortSignal.timeout(5000)
      });
  
      const validation = await validateRes.json();
  
      return res.status(200).json({
        w2a_enabled: true,
        valid: validation.valid,
        domain: origin,
        manifest_url: manifestUrl,
        version: manifest.w2a,
        site_name: manifest.site?.name,
        site_type: manifest.site?.type,
        skill_count: Array.isArray(manifest?.skills) ? manifest?.skills.length : 0,
        skills: Array.isArray(manifest?.skills)
          ? manifest?.skills.map(c => ({ id: c.id, intent: c.intent, auth: c.auth }))
          : [],
        a2a_compatible: !!manifest.a2a_profile,
        errors: validation.errors,
        warnings: validation.warnings,
        checked_at: new Date().toISOString()
      });
  
    } catch (e) {
      if (e.name === 'TimeoutError') {
        return res.status(200).json({
          w2a_enabled: false,
          domain: origin,
          manifest_url: manifestUrl,
          error: 'Request timed out after 8s',
          checked_at: new Date().toISOString()
        });
      }
      return res.status(200).json({
        w2a_enabled: false,
        domain: origin,
        manifest_url: manifestUrl,
        error: e.message,
        checked_at: new Date().toISOString()
      });
    }
  }