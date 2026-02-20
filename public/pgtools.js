// pgtools browser bundle - all engines in one file
// No server required - everything runs in the browser
var PGTools = (function() {
'use strict';

// === DETECTOR ===
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/;
const TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
const INTEGER_RE = /^-?\d+$/;
const NUMERIC_RE = /^-?\d+\.\d+$/;
const BOOLEAN_VALS = new Set(['true', 'false', 't', 'f', 'yes', 'no']);

function detectType(value) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  if (v === '') return null;
  if (UUID_RE.test(v)) return 'uuid';
  if (INTEGER_RE.test(v)) {
    const n = BigInt(v);
    if (n >= -32768n && n <= 32767n) return 'smallint';
    if (n >= -2147483648n && n <= 2147483647n) return 'integer';
    if (n >= -9223372036854775808n && n <= 9223372036854775807n) return 'bigint';
    return 'numeric';
  }
  if (NUMERIC_RE.test(v)) return 'numeric';
  if (BOOLEAN_VALS.has(v.toLowerCase())) return 'boolean';
  if (TIMESTAMPTZ_RE.test(v)) return 'timestamptz';
  if (TIMESTAMP_RE.test(v)) return 'timestamp';
  if (DATE_RE.test(v)) { const d = new Date(v); if (!isNaN(d.getTime())) return 'date'; }
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try { JSON.parse(v); return 'jsonb'; } catch {}
  }
  return 'text';
}

function resolveType(types) {
  const unique = [...new Set(types.filter(t => t !== null))];
  if (unique.length === 0) return 'text';
  if (unique.length === 1) return unique[0];
  const intTypes = new Set(['smallint', 'integer', 'bigint']);
  if (unique.every(t => intTypes.has(t))) {
    if (unique.includes('bigint')) return 'bigint';
    if (unique.includes('integer')) return 'integer';
    return 'smallint';
  }
  const numericTypes = new Set(['smallint', 'integer', 'bigint', 'numeric']);
  if (unique.every(t => numericTypes.has(t))) return 'numeric';
  const timeTypes = new Set(['date', 'timestamp', 'timestamptz']);
  if (unique.every(t => timeTypes.has(t))) {
    if (unique.includes('timestamptz')) return 'timestamptz';
    if (unique.includes('timestamp')) return 'timestamp';
    return 'date';
  }
  const boolIntTypes = new Set(['boolean', 'smallint', 'integer', 'bigint']);
  if (unique.every(t => boolIntTypes.has(t))) return 'smallint';
  return 'text';
}

function analyzeColumn(values) {
  const types = values.map(detectType);
  const nullCount = types.filter(t => t === null).length;
  const nullable = nullCount > 0;
  const pgType = resolveType(types);
  const nonNull = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  const isUnique = new Set(nonNull.map(String)).size === nonNull.length && nonNull.length > 1;
  return { pgType, nullable, isUnique, sampleSize: values.length, nullCount };
}

// === PARSER ===
function parseLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === delimiter) { fields.push(current.trim()); current = ''; }
      else current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSV(text, delimiter) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV must have at least a header row and one data row');
  if (!delimiter) {
    const firstLine = lines[0];
    const candidates = [',', '\t', ';', '|'];
    let best = ',', bestCount = 0;
    for (const d of candidates) {
      const count = (firstLine.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
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
    for (let j = 0; j < headers.length; j++) row[headers[j]] = j < values.length ? values[j] : '';
    rows.push(row);
  }
  return { headers, rows };
}

function parseJSON(text) {
  const data = JSON.parse(text);
  let rows;
  if (Array.isArray(data)) rows = data;
  else if (typeof data === 'object' && data !== null) {
    const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
    if (arrayKey) rows = data[arrayKey];
    else rows = [data];
  } else throw new Error('JSON must be an array of objects or an object containing an array');
  if (rows.length === 0) throw new Error('No data rows found');
  if (typeof rows[0] !== 'object' || rows[0] === null) throw new Error('Each row must be an object');
  const headerSet = new Set();
  for (const row of rows) for (const key of Object.keys(row)) headerSet.add(key);
  const headers = [...headerSet];
  const normalized = rows.map(row => {
    const out = {};
    for (const h of headers) {
      const val = row[h];
      if (val !== null && val !== undefined && typeof val === 'object') out[h] = JSON.stringify(val);
      else out[h] = val !== undefined ? val : null;
    }
    return out;
  });
  return { headers, rows: normalized };
}

function parse(text) {
  const trimmed = text.trim();
  const format = (trimmed.startsWith('{') || trimmed.startsWith('[')) ? 'json' : 'csv';
  if (format === 'json') return { ...parseJSON(text), format: 'json' };
  return { ...parseCSV(text), format: 'csv' };
}

// === GENERATOR ===
function sanitizeName(name) {
  let clean = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!clean || /^\d/.test(clean)) clean = 'col_' + clean;
  const reserved = new Set(['select','from','where','table','column','index','order','group','limit','offset','user','default','check','primary','key','references','constraint','type','all','and','or','not','null','true','false','as','in','on','is','by','to','do','if','end']);
  if (reserved.has(clean)) clean = clean + '_col';
  return clean;
}

function generateDDL(tableName, headers, rows, options) {
  options = options || {};
  const schema = options.schema || 'public';
  const addId = options.addId !== false;
  const includeIndexes = options.includeIndexes !== false;
  const columns = [], indexes = [], colMeta = {};
  for (const header of headers) {
    const colName = sanitizeName(header);
    const values = rows.map(r => r[header]);
    const analysis = analyzeColumn(values);
    colMeta[header] = { ...analysis, colName };
    let def = '  ' + colName + ' ' + analysis.pgType;
    if (!analysis.nullable) def += ' NOT NULL';
    columns.push(def);
    if (includeIndexes) {
      if (analysis.pgType === 'uuid' && analysis.isUnique)
        indexes.push('CREATE UNIQUE INDEX idx_' + sanitizeName(tableName) + '_' + colName + ' ON ' + schema + '.' + sanitizeName(tableName) + ' (' + colName + ');');
      else if (analysis.pgType === 'uuid')
        indexes.push('CREATE INDEX idx_' + sanitizeName(tableName) + '_' + colName + ' ON ' + schema + '.' + sanitizeName(tableName) + ' (' + colName + ');');
    }
  }
  const tbl = sanitizeName(tableName);
  const colNames = new Set(Object.values(colMeta).map(m => m.colName));
  const shouldAddId = addId && !colNames.has('id');
  let ddl = 'CREATE TABLE ' + schema + '.' + tbl + ' (\n';
  if (shouldAddId) ddl += '  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n';
  ddl += columns.join(',\n') + '\n);\n';
  if (indexes.length > 0) ddl += '\n' + indexes.join('\n') + '\n';
  return { ddl, colMeta };
}

function escapeValue(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  return "'" + String(val).replace(/'/g, "''") + "'";
}

function generateInserts(tableName, headers, rows, colMeta, options) {
  options = options || {};
  const schema = options.schema || 'public';
  const tbl = sanitizeName(tableName);
  const colNames = headers.map(h => colMeta[h].colName);
  const stmts = [];
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    let sql = 'INSERT INTO ' + schema + '.' + tbl + ' (' + colNames.join(', ') + ') VALUES\n';
    const valueRows = batch.map(row => '  (' + headers.map(h => escapeValue(row[h])).join(', ') + ')');
    sql += valueRows.join(',\n') + ';\n';
    stmts.push(sql);
  }
  return stmts.join('\n');
}

function generateCopy(tableName, headers, rows, colMeta, options) {
  options = options || {};
  const schema = options.schema || 'public';
  const tbl = sanitizeName(tableName);
  const colNames = headers.map(h => colMeta[h].colName);
  let out = '-- COPY from stdin (fastest for bulk loading)\n';
  out += 'COPY ' + schema + '.' + tbl + ' (' + colNames.join(', ') + ") FROM stdin WITH (FORMAT csv, HEADER false, NULL '');\n";
  for (const row of rows) {
    const vals = headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    });
    out += vals.join(',') + '\n';
  }
  out += '\\.\n';
  return out;
}

function convert(text, tableName, options) {
  const { headers, rows, format } = parse(text);
  const resolvedTableName = tableName || 'imported_data';
  const { ddl, colMeta } = generateDDL(resolvedTableName, headers, rows, options);
  const inserts = generateInserts(resolvedTableName, headers, rows, colMeta, options);
  const copy = generateCopy(resolvedTableName, headers, rows, colMeta, options);
  return {
    ddl, inserts, copy, format,
    rowCount: rows.length, columnCount: headers.length,
    columns: headers.map(h => ({
      original: h, pgName: colMeta[h].colName, pgType: colMeta[h].pgType,
      nullable: colMeta[h].nullable, isUnique: colMeta[h].isUnique,
    }))
  };
}

// === SQL FORMATTER ===
const SQL_KEYWORDS = new Set([
  'SELECT','FROM','WHERE','AND','OR','NOT','IN','EXISTS',
  'JOIN','LEFT','RIGHT','INNER','OUTER','CROSS','FULL',
  'ON','USING','AS','CASE','WHEN','THEN','ELSE','END',
  'INSERT','INTO','VALUES','UPDATE','SET','DELETE',
  'CREATE','TABLE','ALTER','DROP','INDEX','VIEW',
  'GROUP','BY','ORDER','HAVING','LIMIT','OFFSET',
  'UNION','ALL','INTERSECT','EXCEPT','DISTINCT',
  'WITH','RECURSIVE','RETURNING','CONFLICT','DO','NOTHING',
  'BEGIN','COMMIT','ROLLBACK','TRANSACTION',
  'GRANT','REVOKE','TRUNCATE','COPY','EXPLAIN','ANALYZE',
  'PRIMARY','KEY','FOREIGN','REFERENCES','CONSTRAINT',
  'DEFAULT','NULL','NOT','CHECK','UNIQUE',
  'IF','BETWEEN','LIKE','ILIKE','SIMILAR','IS',
  'TRUE','FALSE','ASC','DESC','NULLS','FIRST','LAST',
  'CAST','COALESCE','NULLIF','GREATEST','LEAST',
  'COUNT','SUM','AVG','MIN','MAX','ARRAY_AGG','STRING_AGG',
  'OVER','PARTITION','WINDOW','ROW_NUMBER','RANK','DENSE_RANK',
  'LAG','LEAD','FIRST_VALUE','LAST_VALUE','NTH_VALUE',
  'LATERAL','FETCH','NEXT','ROWS','ONLY','FOR',
  'LOCK','SHARE','NOWAIT','SKIP','LOCKED',
]);

const CLAUSE_KW = new Set([
  'SELECT','FROM','WHERE','JOIN','LEFT JOIN','RIGHT JOIN',
  'INNER JOIN','OUTER JOIN','CROSS JOIN','FULL JOIN',
  'FULL OUTER JOIN','LEFT OUTER JOIN','RIGHT OUTER JOIN',
  'GROUP BY','ORDER BY','HAVING','LIMIT','OFFSET',
  'UNION','UNION ALL','INTERSECT','EXCEPT',
  'INSERT INTO','VALUES','UPDATE','SET','DELETE FROM',
  'ON','USING','RETURNING','WITH','AND','OR',
  'ON CONFLICT','DO','WINDOW',
]);

function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const s = sql;
  while (i < s.length) {
    if (/\s/.test(s[i])) { i++; continue; }
    if (s[i] === '-' && s[i+1] === '-') {
      let end = s.indexOf('\n', i); if (end === -1) end = s.length;
      tokens.push({ type: 'comment', value: s.slice(i, end).trim() }); i = end + 1; continue;
    }
    if (s[i] === '/' && s[i+1] === '*') {
      let end = s.indexOf('*/', i+2); if (end === -1) end = s.length - 2;
      tokens.push({ type: 'comment', value: s.slice(i, end+2) }); i = end + 2; continue;
    }
    if (s[i] === "'") {
      let j = i + 1;
      while (j < s.length) { if (s[j]==="'"&&s[j+1]==="'"){j+=2;continue;} if (s[j]==="'")break; j++; }
      tokens.push({ type: 'string', value: s.slice(i, j+1) }); i = j + 1; continue;
    }
    if (s[i] === '$') {
      const tagMatch = s.slice(i).match(/^\$([a-zA-Z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0]; const end = s.indexOf(tag, i + tag.length);
        if (end !== -1) { tokens.push({ type: 'string', value: s.slice(i, end + tag.length) }); i = end + tag.length; continue; }
      }
    }
    if (/\d/.test(s[i]) || (s[i] === '.' && /\d/.test(s[i+1]))) {
      let j = i; while (j < s.length && /[\d.e+-]/.test(s[j])) j++;
      tokens.push({ type: 'number', value: s.slice(i, j) }); i = j; continue;
    }
    if (/[a-zA-Z_]/.test(s[i])) {
      let j = i; while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j), upper = word.toUpperCase();
      tokens.push(SQL_KEYWORDS.has(upper) ? { type: 'keyword', value: upper, original: word } : { type: 'identifier', value: word });
      i = j; continue;
    }
    if (s[i] === '"') {
      let j = i + 1; while (j < s.length && s[j] !== '"') j++;
      tokens.push({ type: 'identifier', value: s.slice(i, j+1) }); i = j + 1; continue;
    }
    const three = s.slice(i, i+3);
    if (three === '->>') { tokens.push({ type: 'operator', value: three }); i += 3; continue; }
    const two = s.slice(i, i+2);
    if (['!=','<>','<=','>=','::','||','->','=>'].includes(two)) { tokens.push({ type: 'operator', value: two }); i += 2; continue; }
    tokens.push({ type: 'symbol', value: s[i] }); i++;
  }
  return tokens;
}

function formatSQL(sql) {
  const tokens = tokenize(sql);
  let out = '', indent = 0, lineStart = true, prevToken = null, parenDepth = 0;
  function newline() { out = out.trimEnd(); out += '\n' + '  '.repeat(indent); lineStart = true; }
  function space() { if (!lineStart && out.length > 0 && !out.endsWith(' ') && !out.endsWith('\n') && !out.endsWith('(')) out += ' '; }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], next = tokens[i+1];
    let compound = null;
    if (t.type === 'keyword' && next && next.type === 'keyword') {
      const pair = t.value + ' ' + next.value;
      if (CLAUSE_KW.has(pair)) compound = pair;
    }
    if (t.type === 'comment') { newline(); out += t.value; newline(); prevToken = t; continue; }
    if (t.type === 'symbol' && t.value === '(') {
      if (!(prevToken && (prevToken.type === 'identifier' || prevToken.type === 'keyword'))) space();
      out += '('; parenDepth++;
      if (next && next.type === 'keyword' && next.value === 'SELECT') { indent++; newline(); }
      prevToken = t; lineStart = false; continue;
    }
    if (t.type === 'symbol' && t.value === ')') {
      if (parenDepth > 0) parenDepth--;
      out += ')'; prevToken = t; lineStart = false; continue;
    }
    if (t.type === 'symbol' && t.value === ',') {
      out += ',';
      if (parenDepth === 0) { newline(); out += '  '; } else out += ' ';
      prevToken = t; lineStart = false; continue;
    }
    if (t.type === 'symbol' && t.value === ';') { out += ';\n'; indent = 0; lineStart = true; prevToken = t; continue; }
    if (compound) {
      if (parenDepth === 0) {
        if (['UNION ALL','UNION','INTERSECT','EXCEPT'].includes(compound)) indent = 0;
        newline();
      } else space();
      out += compound; i++; prevToken = { type: 'keyword', value: compound }; lineStart = false; continue;
    }
    if (t.type === 'keyword') {
      if (CLAUSE_KW.has(t.value) && parenDepth === 0) {
        if (['AND','OR'].includes(t.value)) { newline(); out += '  ' + t.value; }
        else { newline(); out += t.value; }
      } else { space(); out += t.value; }
      prevToken = t; lineStart = false; continue;
    }
    if (t.type === 'operator' && (t.value === '::' || t.value === '->' || t.value === '->>')) { out += t.value; }
    else if (t.type === 'symbol' && t.value === '.') { out = out.trimEnd(); out += '.'; }
    else if (prevToken && prevToken.type === 'symbol' && prevToken.value === '.') { out += t.value || t.original || ''; }
    else { space(); out += t.value || t.original || ''; }
    prevToken = t; lineStart = false;
  }
  return out.trim() + '\n';
}

function analyzeSQL(sql) {
  const findings = [];
  const tokens = tokenize(sql);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'keyword' && tokens[i].value === 'SELECT') {
      let j = i + 1;
      if (j < tokens.length && tokens[j].type === 'keyword' && tokens[j].value === 'DISTINCT') j++;
      if (j < tokens.length && tokens[j].type === 'symbol' && tokens[j].value === '*')
        findings.push({ level: 'warn', message: 'SELECT * can cause performance issues and breaks when columns change. Specify columns explicitly.' });
    }
  }
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'keyword' && tokens[i].value === 'UPDATE') {
      let hasWhere = false;
      for (let j = i+1; j < tokens.length; j++) { if (tokens[j].type==='symbol'&&tokens[j].value===';') break; if (tokens[j].type==='keyword'&&tokens[j].value==='WHERE'){hasWhere=true;break;} }
      if (!hasWhere) findings.push({ level: 'error', message: 'UPDATE without WHERE clause will modify ALL rows in the table.' });
    }
    if (tokens[i].type === 'keyword' && tokens[i].value === 'DELETE') {
      let hasWhere = false;
      for (let j = i+1; j < tokens.length; j++) { if (tokens[j].type==='symbol'&&tokens[j].value===';') break; if (tokens[j].type==='keyword'&&tokens[j].value==='WHERE'){hasWhere=true;break;} }
      if (!hasWhere) findings.push({ level: 'error', message: 'DELETE without WHERE clause will remove ALL rows from the table.' });
    }
  }
  if (/LIKE\s+'%/i.test(sql)) findings.push({ level: 'warn', message: "LIKE with leading wildcard ('%...') cannot use a B-tree index. Consider pg_trgm or full-text search." });
  if (/NOT\s+IN\s*\(/i.test(sql)) findings.push({ level: 'warn', message: "NOT IN with subquery can return unexpected results if subquery returns NULL. Use NOT EXISTS instead." });
  const hasOrderBy = tokens.some(t => t.type==='keyword'&&t.value==='ORDER');
  const hasLimit = tokens.some(t => t.type==='keyword'&&(t.value==='LIMIT'||t.value==='FETCH'));
  if (hasOrderBy && !hasLimit) findings.push({ level: 'info', message: 'ORDER BY without LIMIT sorts the entire result set. Add LIMIT if you only need a subset.' });
  if (/OFFSET\s+(\d+)/i.test(sql)) { const m = sql.match(/OFFSET\s+(\d+)/i); if (m && parseInt(m[1]) > 1000) findings.push({ level: 'warn', message: 'Large OFFSET (' + m[1] + ') is slow. Use keyset pagination instead.' }); }
  let joinCount = 0; for (const t of tokens) if (t.type==='keyword'&&t.value==='JOIN') joinCount++;
  if (joinCount >= 5) findings.push({ level: 'info', message: joinCount + ' JOINs detected. Consider if all are necessary.' });
  if (/\bnow\(\)/i.test(sql)) findings.push({ level: 'info', message: 'now() returns the same value for the entire transaction. Use clock_timestamp() for wall-clock time.' });
  if (/WHERE[\s\S]*?COALESCE/i.test(sql)) findings.push({ level: 'info', message: 'COALESCE in WHERE clause may prevent index usage.' });
  return findings;
}

// === PUBLIC API ===
return { convert, formatSQL, analyzeSQL, parse, tokenize };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PGTools;
