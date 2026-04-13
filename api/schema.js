const SCHEMA = {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "$id": "https://w2a-protocol.org/api/schema?version=1.0",
    "title": "W2A Manifest",
    "description": "Web2Agent Protocol manifest schema v1.0",
    "type": "object",
    "required": ["w2a", "site", "skills"],
    "additionalProperties": false,
    "properties": {
      "w2a": {
        "type": "string",
        "enum": ["1.0"],
        "description": "W2A spec version"
      },
      "site": {
        "type": "object",
        "required": ["name", "type"],
        "additionalProperties": false,
        "properties": {
          "name": { "type": "string", "minLength": 1 },
          "type": {
            "type": "string",
            "enum": ["ecommerce","blog","saas","marketplace","media","directory","api","other"]
          },
          "language": { "type": "string", "description": "BCP 47 language tag e.g. en" },
          "description": { "type": "string" }
        }
      },
      "skills": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "required": ["id", "intent", "action", "auth"],
          "additionalProperties": false,
          "properties": {
            "id": {
              "type": "string",
              "pattern": "^[a-z][a-z0-9_]*$",
              "description": "Unique slug — lowercase letters, digits, underscores"
            },
            "intent": {
              "type": "string",
              "minLength": 10,
              "description": "Plain-English description for agents"
            },
            "action": {
              "type": "string",
              "pattern": "^(GET|POST|PUT|PATCH|DELETE) /.+$",
              "description": "METHOD /path"
            },
            "input": {
              "type": "object",
              "additionalProperties": { "type": "string" },
              "description": "Named input parameters with type strings"
            },
            "output": {
              "type": "object",
              "additionalProperties": { "type": "string" },
              "description": "Named output fields with type strings"
            },
            "auth": {
              "type": "string",
              "enum": ["none", "session", "bearer", "apikey", "oauth2"]
            },
            "description": { "type": "string" }
          }
        }
      },
      "policies": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "rate_limit": {
            "type": "string",
            "pattern": "^\\d+/(sec|min|hour)$",
            "description": "e.g. 60/min"
          },
          "allowed_agents": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Use [\"*\"] for all agents"
          },
          "blocked_agents": {
            "type": "array",
            "items": { "type": "string" }
          },
          "require_identity": { "type": "boolean" }
        }
      },
      "federation": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["role", "ref"],
          "additionalProperties": false,
          "properties": {
            "role": { "type": "string" },
            "ref": {
              "type": "string",
              "pattern": "^https://"
            },
            "description": { "type": "string" }
          }
        }
      },
      "a2a_profile": {
        "type": "object",
        "required": ["name", "url", "version"],
        "additionalProperties": false,
        "properties": {
          "name": { "type": "string" },
          "url": {
            "type": "string",
            "pattern": "^https://"
          },
          "version": { "type": "string" },
          "description": { "type": "string" }
        }
      }
    }
  };
  
  export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
    return res.status(200).json({
      version: '1.0',
      schema: SCHEMA,
      published_at: '2025-04-13T00:00:00Z'
    });
  }