// SQL generator - produces Postgres DDL and data import statements
const { analyzeColumn } = require('./detector');

function sanitizeName(name) {
  // Convert to valid Postgres identifier
  let clean = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!clean || /^\d/.test(clean)) clean = 'col_' + clean;
  // Avoid reserved words (common ones)
  const reserved = new Set(['select', 'from', 'where', 'table', 'column', 'index', 'order', 'group', 'limit', 'offset', 'user', 'default', 'check', 'primary', 'key', 'references', 'constraint', 'type', 'all', 'and', 'or', 'not', 'null', 'true', 'false', 'as', 'in', 'on', 'is', 'by', 'to', 'do', 'if', 'end']);
  if (reserved.has(clean)) clean = clean + '_col';
  return clean;
}

function generateDDL(tableName, headers, rows, options = {}) {
  const schema = options.schema || 'public';
  const addId = options.addId !== false;
  const includeIndexes = options.includeIndexes !== false;

  const columns = [];
  const indexes = [];
  const colMeta = {};

  for (const header of headers) {
    const colName = sanitizeName(header);
    const values = rows.map(r => r[header]);
    const analysis = analyzeColumn(values);
    colMeta[header] = { ...analysis, colName };

    let def = `  ${colName} ${analysis.pgType}`;
    if (!analysis.nullable) def += ' NOT NULL';
    columns.push(def);

    // Suggest indexes for UUID columns (likely foreign keys) and unique columns
    if (includeIndexes) {
      if (analysis.pgType === 'uuid' && analysis.isUnique) {
        indexes.push(`CREATE UNIQUE INDEX idx_${sanitizeName(tableName)}_${colName} ON ${schema}.${sanitizeName(tableName)} (${colName});`);
      } else if (analysis.pgType === 'uuid') {
        indexes.push(`CREATE INDEX idx_${sanitizeName(tableName)}_${colName} ON ${schema}.${sanitizeName(tableName)} (${colName});`);
      }
    }
  }

  const tbl = sanitizeName(tableName);
  // Don't add auto-id if data already has an 'id' column
  const colNames = new Set(Object.values(colMeta).map(m => m.colName));
  const shouldAddId = addId && !colNames.has('id');

  let ddl = `CREATE TABLE ${schema}.${tbl} (\n`;
  if (shouldAddId) {
    ddl += `  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,\n`;
  }
  ddl += columns.join(',\n');
  ddl += `\n);\n`;

  if (indexes.length > 0) {
    ddl += '\n' + indexes.join('\n') + '\n';
  }

  return { ddl, colMeta };
}

function escapeValue(val) {
  if (val === null || val === undefined || val === '') return 'NULL';
  const s = String(val);
  return "'" + s.replace(/'/g, "''") + "'";
}

function generateInserts(tableName, headers, rows, colMeta, options = {}) {
  const schema = options.schema || 'public';
  const tbl = sanitizeName(tableName);
  const colNames = headers.map(h => colMeta[h].colName);
  const stmts = [];

  // Batch inserts in groups of 100
  const batchSize = 100;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    let sql = `INSERT INTO ${schema}.${tbl} (${colNames.join(', ')}) VALUES\n`;
    const valueRows = batch.map(row => {
      const vals = headers.map(h => escapeValue(row[h]));
      return `  (${vals.join(', ')})`;
    });
    sql += valueRows.join(',\n') + ';\n';
    stmts.push(sql);
  }

  return stmts.join('\n');
}

function generateCopy(tableName, headers, rows, colMeta, options = {}) {
  const schema = options.schema || 'public';
  const tbl = sanitizeName(tableName);
  const colNames = headers.map(h => colMeta[h].colName);

  let out = `-- Option 1: COPY from stdin (fastest for bulk loading)\n`;
  out += `COPY ${schema}.${tbl} (${colNames.join(', ')}) FROM stdin WITH (FORMAT csv, HEADER false, NULL '');\n`;

  for (const row of rows) {
    const vals = headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    });
    out += vals.join(',') + '\n';
  }
  out += '\\.\n';

  return out;
}

function generate(text, tableName, options = {}) {
  const { parse } = require('./parser');
  const { headers, rows, format } = parse(text);

  const resolvedTableName = tableName || 'imported_data';
  const { ddl, colMeta } = generateDDL(resolvedTableName, headers, rows, options);
  const inserts = generateInserts(resolvedTableName, headers, rows, colMeta, options);
  const copy = generateCopy(resolvedTableName, headers, rows, colMeta, options);

  return {
    ddl,
    inserts,
    copy,
    format,
    rowCount: rows.length,
    columnCount: headers.length,
    columns: headers.map(h => ({
      original: h,
      pgName: colMeta[h].colName,
      pgType: colMeta[h].pgType,
      nullable: colMeta[h].nullable,
      isUnique: colMeta[h].isUnique,
    }))
  };
}

module.exports = { generate, generateDDL, generateInserts, generateCopy, sanitizeName };
