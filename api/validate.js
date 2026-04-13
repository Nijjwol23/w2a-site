const VALID_SITE_TYPES = ['ecommerce','blog','saas','marketplace','media','directory','api','other'];
const VALID_AUTH       = ['none','session','bearer','apikey','oauth2'];
const VALID_METHODS    = ['GET','POST','PUT','PATCH','DELETE'];
const VALID_TYPES      = ['string','string?','int','int?','float','float?','bool','bool?',
                          'object','object?','string[]','int[]','object[]','string[]?','int[]?','object[]?'];
const ID_RE = /^[a-z][a-z0-9_]*$/;

function err(path, msg, fix) {
  return { path, message: msg, fix: fix || null };
}

function validateManifest(m) {
  const errors = [];
  const warnings = [];

  if (typeof m !== 'object' || Array.isArray(m) || m === null) {
    errors.push(err('$', 'Manifest must be a JSON object'));
    return { errors, warnings };
  }

  // w2a version
  if (!m.w2a) {
    errors.push(err('w2a', 'Required field missing', 'Add "w2a": "1.0"'));
  } else if (m.w2a !== '1.0') {
    warnings.push(err('w2a', `Unknown version "${m.w2a}" — this validator supports 1.0`));
  }

  // Catch old "capabilities" field name
  if (m.capabilities && !m.skills) {
    errors.push(err('capabilities', 
      '"capabilities" was renamed to "skills" in W2A v1.0',
      'Rename the "capabilities" field to "skills"'
    ));
  }

  // site
  if (!m.site) {
    errors.push(err('site', 'Required field missing'));
  } else {
    if (!m.site.name)
      errors.push(err('site.name', 'Required field missing'));
    else if (typeof m.site.name !== 'string' || m.site.name.trim().length === 0)
      errors.push(err('site.name', 'Must be a non-empty string'));

    if (!m.site.type)
      errors.push(err('site.type', 'Required field missing',
        `Permitted values: ${VALID_SITE_TYPES.join(', ')}`));
    else if (!VALID_SITE_TYPES.includes(m.site.type))
      errors.push(err('site.type', `"${m.site.type}" is not a permitted value`,
        `Use one of: ${VALID_SITE_TYPES.join(', ')}`));

    if (m.site.language && typeof m.site.language !== 'string')
      errors.push(err('site.language', 'Must be a BCP 47 string e.g. "en"'));
  }

  // skills (renamed from capabilities)
  if (!m.skills) {
    if (!m.capabilities) {
      errors.push(err('skills', 'Required field missing — must be an array with at least one skill'));
    }
  } else if (!Array.isArray(m.skills)) {
    errors.push(err('skills', 'Must be an array'));
  } else if (m.skills.length === 0) {
    errors.push(err('skills', 'Must contain at least one skill'));
  } else {
    const ids = new Set();
    m.skills.forEach((skill, i) => {
      const p = `skills[${i}]`;

      if (!skill.id) {
        errors.push(err(`${p}.id`, 'Required field missing'));
      } else if (!ID_RE.test(skill.id)) {
        errors.push(err(`${p}.id`,
          `"${skill.id}" is invalid — use lowercase letters, digits, underscores only`,
          'e.g. "search_products"'));
      } else if (ids.has(skill.id)) {
        errors.push(err(`${p}.id`, `Duplicate id "${skill.id}" — all ids must be unique`));
      } else {
        ids.add(skill.id);
      }

      if (!skill.intent) {
        errors.push(err(`${p}.intent`, 'Required field missing'));
      } else if (typeof skill.intent !== 'string') {
        errors.push(err(`${p}.intent`, 'Must be a string'));
      } else if (skill.intent.trim().length < 10) {
        warnings.push(err(`${p}.intent`,
          'Intent is very short — write a full sentence describing what this skill does'));
      }

      if (!skill.action) {
        errors.push(err(`${p}.action`, 'Required field missing',
          'Format: "METHOD /path" e.g. "GET /api/search"'));
      } else {
        const parts = skill.action.split(' ');
        if (parts.length !== 2)
          errors.push(err(`${p}.action`, `"${skill.action}" is invalid`,
            'Format: "METHOD /path" e.g. "GET /api/search"'));
        else if (!VALID_METHODS.includes(parts[0]))
          errors.push(err(`${p}.action`, `"${parts[0]}" is not a valid HTTP method`,
            `Use one of: ${VALID_METHODS.join(', ')}`));
        else if (!parts[1].startsWith('/'))
          errors.push(err(`${p}.action`, 'Path must start with "/"'));
      }

      if (!skill.auth) {
        errors.push(err(`${p}.auth`, 'Required field missing',
          `Use one of: ${VALID_AUTH.join(', ')}`));
      } else if (!VALID_AUTH.includes(skill.auth)) {
        errors.push(err(`${p}.auth`, `"${skill.auth}" is not a permitted value`,
          `Use one of: ${VALID_AUTH.join(', ')}`));
      }

      if (skill.input && (typeof skill.input !== 'object' || Array.isArray(skill.input))) {
        errors.push(err(`${p}.input`, 'Must be an object of field names to types'));
      } else if (skill.input) {
        Object.entries(skill.input).forEach(([k, v]) => {
          if (!/^[a-z][a-z0-9_]*$/.test(k))
            warnings.push(err(`${p}.input.${k}`,
              'Field names should be lowercase with underscores'));
          if (!VALID_TYPES.includes(v) && !v.endsWith('[]') && !v.endsWith('[]?'))
            warnings.push(err(`${p}.input.${k}`,
              `Unknown type "${v}" — will be treated as object by agents`));
        });
      }

      if (skill.output && (typeof skill.output !== 'object' || Array.isArray(skill.output))) {
        errors.push(err(`${p}.output`, 'Must be an object of field names to types'));
      } else if (skill.output) {
        Object.entries(skill.output).forEach(([k, v]) => {
          if (!VALID_TYPES.includes(v) && !v.endsWith('[]') && !v.endsWith('[]?'))
            warnings.push(err(`${p}.output.${k}`,
              `Unknown type "${v}" — will be treated as object by agents`));
        });
      }
    });
  }

  // policies
  if (m.policies) {
    const pol = m.policies;
    if (pol.rate_limit && !/^\d+\/(sec|min|hour)$/.test(pol.rate_limit))
      errors.push(err('policies.rate_limit', `"${pol.rate_limit}" is invalid`,
        'Format: "N/unit" where unit is sec, min, or hour. e.g. "60/min"'));
    if (pol.allowed_agents && !Array.isArray(pol.allowed_agents))
      errors.push(err('policies.allowed_agents', 'Must be an array of strings'));
    if (pol.blocked_agents && !Array.isArray(pol.blocked_agents))
      errors.push(err('policies.blocked_agents', 'Must be an array of strings'));
  }

  // a2a_profile — validate against actual A2A AgentCard structure
  if (m.a2a_profile) {
    const a2a = m.a2a_profile;
    if (!a2a.name)
      errors.push(err('a2a_profile.name', 'Required when a2a_profile is present'));
    if (!a2a.description)
      warnings.push(err('a2a_profile.description',
        'Recommended — helps A2A clients understand what this agent does'));
    if (!a2a.url)
      errors.push(err('a2a_profile.url', 'Required when a2a_profile is present'));
    else if (!a2a.url.startsWith('https://'))
      errors.push(err('a2a_profile.url', 'Must be an https:// URL'));
    if (!a2a.version)
      errors.push(err('a2a_profile.version', 'Required when a2a_profile is present'));
    if (!a2a.provider)
      warnings.push(err('a2a_profile.provider',
        'Recommended — add provider.organization and provider.url'));
    if (!a2a.capabilities)
      warnings.push(err('a2a_profile.capabilities',
        'Recommended — add capabilities: { streaming: false, pushNotifications: false }'));
    if (!a2a.skills || !Array.isArray(a2a.skills) || a2a.skills.length === 0)
      warnings.push(err('a2a_profile.skills',
        'Recommended — list key skills so A2A clients can understand capabilities'));
  }

  // federation
  if (m.federation && Array.isArray(m.federation)) {
    m.federation.forEach((f, i) => {
      const p = `federation[${i}]`;
      if (!f.role)
        errors.push(err(`${p}.role`, 'Required field missing'));
      if (!f.ref)
        errors.push(err(`${p}.ref`, 'Required field missing'));
      else if (!f.ref.startsWith('https://'))
        errors.push(err(`${p}.ref`, 'Must be an https:// URL'));
      else if (!f.ref.endsWith('agents.json'))
        warnings.push(err(`${p}.ref`,
          'Federation ref should point to an agents.json file'));
    });
  }

  return { errors, warnings };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }

  const manifest = body?.manifest ?? body;
  if (!manifest)
    return res.status(400).json({
      error: 'Send manifest as { "manifest": { ... } } or as the body directly'
    });

  const { errors, warnings } = validateManifest(manifest);
  const valid = errors.length === 0;

  return res.status(200).json({
    valid,
    version: '1.0',
    skill_count: Array.isArray(manifest?.skills) ? manifest.skills.length : 0,
    errors,
    warnings,
    validated_at: new Date().toISOString()
  });
}