// CSV and JSON parser - converts input data to rows + column names

function parseCSV(text, delimiter = null) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');

  // Auto-detect delimiter
  if (!delimiter) {
    const firstLine = lines[0];
    const candidates = [',', '\t', ';', '|'];
    let best = ',';
    let bestCount = 0;
    for (const d of candidates) {
      const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d === '.' ? '\\.' : d, 'g')) || []).length;
      if (count > bestCount) { bestCount = count; best = d; }
    }
    delimiter = best;
  }

  const headers = parseLine(lines[0], delimiter);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    const values = parseLine(lines[i], delimiter);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = j < values.length ? values[j] : '';
    }
    rows.push(row);
  }

  return { headers, rows };
}

function parseLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseJSON(text) {
  const data = JSON.parse(text);
  let rows;
  if (Array.isArray(data)) {
    rows = data;
  } else if (typeof data === 'object' && data !== null) {
    // Try to find an array property
    const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
    if (arrayKey) {
      rows = data[arrayKey];
    } else {
      rows = [data];
    }
  } else {
    throw new Error('JSON must be an array of objects or an object containing an array');
  }

  if (rows.length === 0) throw new Error('No data rows found');
  if (typeof rows[0] !== 'object' || rows[0] === null) {
    throw new Error('Each row must be an object');
  }

  // Collect all unique keys across all rows
  const headerSet = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) headerSet.add(key);
  }
  const headers = [...headerSet];

  // Normalize rows to have all keys
  const normalized = rows.map(row => {
    const out = {};
    for (const h of headers) {
      const val = row[h];
      // Flatten nested objects to JSONB strings
      if (val !== null && val !== undefined && typeof val === 'object') {
        out[h] = JSON.stringify(val);
      } else {
        out[h] = val !== undefined ? val : null;
      }
    }
    return out;
  });

  return { headers, rows: normalized };
}

function detectFormat(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  return 'csv';
}

function parse(text) {
  const format = detectFormat(text);
  if (format === 'json') return { ...parseJSON(text), format: 'json' };
  return { ...parseCSV(text), format: 'csv' };
}

module.exports = { parseCSV, parseJSON, parse, detectFormat };
