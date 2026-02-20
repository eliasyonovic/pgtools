const http = require('http');
const fs = require('fs');
const path = require('path');
const { generate } = require('./src/generator');
const { format, analyze } = require('./src/sql-formatter');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Friendly route mapping
const ROUTES = {
  '/': '/index.html',
  '/sheet': '/tools/sheet.html',
  '/query': '/tools/query.html',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // API: convert CSV/JSON to SQL (pgsheet)
  if (url.pathname === '/api/convert' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { data, tableName, schema, addId, includeIndexes } = body;
      if (!data || !data.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No data provided' }));
        return;
      }
      const result = generate(data, tableName || 'imported_data', {
        schema: schema || 'public',
        addId: addId !== false,
        includeIndexes: includeIndexes !== false,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API: format and analyze SQL (pgquery)
  if (url.pathname === '/api/format' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req));
      const { sql } = body;
      if (!sql || !sql.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No SQL provided' }));
        return;
      }
      const formatted = format(sql);
      const findings = analyze(sql);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ formatted, findings }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Static files with friendly routes
  let filePath = ROUTES[url.pathname] || url.pathname;
  filePath = path.join(__dirname, 'public', filePath);

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`pgtools running at http://localhost:${PORT}`);
});
