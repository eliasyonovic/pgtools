// SQL Formatter and Analyzer for Postgres
// Formats SQL and detects common issues

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'FULL',
  'ON', 'USING', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE',
  'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW',
  'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'ALL', 'INTERSECT', 'EXCEPT', 'DISTINCT',
  'WITH', 'RECURSIVE', 'RETURNING', 'CONFLICT', 'DO', 'NOTHING',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION',
  'GRANT', 'REVOKE', 'TRUNCATE', 'COPY', 'EXPLAIN', 'ANALYZE',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CONSTRAINT',
  'DEFAULT', 'NULL', 'NOT', 'CHECK', 'UNIQUE',
  'IF', 'BETWEEN', 'LIKE', 'ILIKE', 'SIMILAR', 'IS',
  'TRUE', 'FALSE', 'ASC', 'DESC', 'NULLS', 'FIRST', 'LAST',
  'CAST', 'COALESCE', 'NULLIF', 'GREATEST', 'LEAST',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 'STRING_AGG',
  'OVER', 'PARTITION', 'WINDOW', 'ROW_NUMBER', 'RANK', 'DENSE_RANK',
  'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE',
  'LATERAL', 'FETCH', 'NEXT', 'ROWS', 'ONLY', 'FOR',
  'LOCK', 'SHARE', 'NOWAIT', 'SKIP', 'LOCKED',
]);

// Major clause keywords that get their own line
const CLAUSE_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN',
  'INNER JOIN', 'OUTER JOIN', 'CROSS JOIN', 'FULL JOIN',
  'FULL OUTER JOIN', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN',
  'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'UNION ALL', 'INTERSECT', 'EXCEPT',
  'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'ON', 'USING', 'RETURNING', 'WITH', 'AND', 'OR',
  'ON CONFLICT', 'DO', 'WINDOW',
]);

function tokenize(sql) {
  const tokens = [];
  let i = 0;
  const s = sql;

  while (i < s.length) {
    // Whitespace
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    // Single-line comment
    if (s[i] === '-' && s[i + 1] === '-') {
      let end = s.indexOf('\n', i);
      if (end === -1) end = s.length;
      tokens.push({ type: 'comment', value: s.slice(i, end).trim() });
      i = end + 1;
      continue;
    }
    // Multi-line comment
    if (s[i] === '/' && s[i + 1] === '*') {
      let end = s.indexOf('*/', i + 2);
      if (end === -1) end = s.length - 2;
      tokens.push({ type: 'comment', value: s.slice(i, end + 2) });
      i = end + 2;
      continue;
    }
    // String
    if (s[i] === "'") {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { j += 2; continue; }
        if (s[j] === "'") break;
        j++;
      }
      tokens.push({ type: 'string', value: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    // Dollar-quoted string
    if (s[i] === '$') {
      const tagMatch = s.slice(i).match(/^\$([a-zA-Z_]*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = s.indexOf(tag, i + tag.length);
        if (end !== -1) {
          tokens.push({ type: 'string', value: s.slice(i, end + tag.length) });
          i = end + tag.length;
          continue;
        }
      }
    }
    // Number
    if (/\d/.test(s[i]) || (s[i] === '.' && /\d/.test(s[i + 1]))) {
      let j = i;
      while (j < s.length && /[\d.e+-]/.test(s[j])) j++;
      tokens.push({ type: 'number', value: s.slice(i, j) });
      i = j;
      continue;
    }
    // Identifier or keyword
    if (/[a-zA-Z_]/.test(s[i])) {
      let j = i;
      while (j < s.length && /[a-zA-Z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j);
      const upper = word.toUpperCase();
      if (KEYWORDS.has(upper)) {
        tokens.push({ type: 'keyword', value: upper, original: word });
      } else {
        tokens.push({ type: 'identifier', value: word });
      }
      i = j;
      continue;
    }
    // Quoted identifier
    if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      tokens.push({ type: 'identifier', value: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    // Operators and punctuation
    const twoChar = s.slice(i, i + 2);
    if (['!=', '<>', '<=', '>=', '::', '||', '->',  '=>'].includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar });
      i += 2;
      continue;
    }
    // Check for ->> (3 chars)
    const threeChar = s.slice(i, i + 3);
    if (threeChar === '->>') {
      tokens.push({ type: 'operator', value: threeChar });
      i += 3;
      continue;
    }
    tokens.push({ type: 'symbol', value: s[i] });
    i++;
  }
  return tokens;
}

function format(sql) {
  const tokens = tokenize(sql);
  let out = '';
  let indent = 0;
  let lineStart = true;
  let prevToken = null;
  let parenDepth = 0;

  function newline() {
    out = out.trimEnd();
    out += '\n' + '  '.repeat(indent);
    lineStart = true;
  }

  function space() {
    if (!lineStart && out.length > 0 && !out.endsWith(' ') && !out.endsWith('\n') && !out.endsWith('(')) {
      out += ' ';
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];

    // Check for compound keywords
    let compound = null;
    if (t.type === 'keyword' && next && next.type === 'keyword') {
      const pair = t.value + ' ' + next.value;
      if (CLAUSE_KEYWORDS.has(pair)) {
        compound = pair;
      }
    }

    if (t.type === 'comment') {
      newline();
      out += t.value;
      newline();
      prevToken = t;
      continue;
    }

    if (t.type === 'symbol' && t.value === '(') {
      // No space before ( if preceded by a function name/identifier
      if (prevToken && (prevToken.type === 'identifier' || prevToken.type === 'keyword')) {
        // function call - no space
      } else {
        space();
      }
      out += '(';
      parenDepth++;
      // Check if this is a subquery
      if (next && next.type === 'keyword' && next.value === 'SELECT') {
        indent++;
        newline();
      }
      prevToken = t;
      lineStart = false;
      continue;
    }

    if (t.type === 'symbol' && t.value === ')') {
      if (parenDepth > 0) parenDepth--;
      // Check if previous context was a subquery indent
      if (prevToken && prevToken.type === 'keyword' &&
          ['LIMIT', 'OFFSET', 'ASC', 'DESC'].includes(prevToken.value)) {
        indent = Math.max(0, indent - 1);
        newline();
      }
      out += ')';
      prevToken = t;
      lineStart = false;
      continue;
    }

    if (t.type === 'symbol' && t.value === ',') {
      out += ',';
      // In a SELECT clause at top level, put each column on its own line
      if (parenDepth === 0) {
        newline();
        out += '  '; // extra indent for select list items
      } else {
        out += ' ';
      }
      prevToken = t;
      lineStart = false;
      continue;
    }

    if (t.type === 'symbol' && t.value === ';') {
      out += ';\n';
      indent = 0;
      lineStart = true;
      prevToken = t;
      continue;
    }

    if (compound) {
      if (parenDepth === 0) {
        if (['UNION ALL', 'UNION', 'INTERSECT', 'EXCEPT'].includes(compound)) {
          indent = 0;
        }
        newline();
      } else {
        space();
      }
      out += compound;
      i++; // skip next token (already consumed)
      prevToken = { type: 'keyword', value: compound };
      lineStart = false;
      continue;
    }

    if (t.type === 'keyword') {
      if (CLAUSE_KEYWORDS.has(t.value) && parenDepth === 0) {
        if (['AND', 'OR'].includes(t.value)) {
          newline();
          out += '  ' + t.value;
        } else if (t.value === 'SELECT' && prevToken && prevToken.type === 'keyword' && prevToken.value === 'UNION ALL') {
          newline();
          out += t.value;
        } else {
          newline();
          out += t.value;
        }
      } else {
        space();
        out += t.value;
      }
      prevToken = t;
      lineStart = false;
      continue;
    }

    // Default: identifiers, strings, numbers, operators
    if (t.type === 'operator' && (t.value === '::' || t.value === '->' || t.value === '->>')) {
      out += t.value; // No space around cast/json operators
    } else if (t.type === 'symbol' && t.value === '.') {
      // No space around dot (table.column)
      out = out.trimEnd();
      out += '.';
    } else if (prevToken && prevToken.type === 'symbol' && prevToken.value === '.') {
      // No space after dot
      out += t.value || t.original || '';
    } else {
      space();
      out += t.value || t.original || '';
    }

    prevToken = t;
    lineStart = false;
  }

  return out.trim() + '\n';
}

// SQL Analyzer - finds common issues
function analyze(sql) {
  const findings = [];
  const upper = sql.toUpperCase();
  const tokens = tokenize(sql);

  // Check for SELECT *
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].type === 'keyword' && tokens[i].value === 'SELECT') {
      // Look ahead for *
      let j = i + 1;
      if (j < tokens.length && tokens[j].type === 'keyword' && tokens[j].value === 'DISTINCT') j++;
      if (j < tokens.length && tokens[j].type === 'symbol' && tokens[j].value === '*') {
        findings.push({ level: 'warn', message: 'SELECT * can cause performance issues and breaks when columns change. Specify columns explicitly.' });
      }
    }
  }

  // UPDATE without WHERE
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'keyword' && tokens[i].value === 'UPDATE') {
      let hasWhere = false;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'symbol' && tokens[j].value === ';') break;
        if (tokens[j].type === 'keyword' && tokens[j].value === 'WHERE') { hasWhere = true; break; }
      }
      if (!hasWhere) {
        findings.push({ level: 'error', message: 'UPDATE without WHERE clause will modify ALL rows in the table.' });
      }
    }
  }

  // DELETE without WHERE
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'keyword' && tokens[i].value === 'DELETE') {
      let hasWhere = false;
      for (let j = i + 1; j < tokens.length; j++) {
        if (tokens[j].type === 'symbol' && tokens[j].value === ';') break;
        if (tokens[j].type === 'keyword' && tokens[j].value === 'WHERE') { hasWhere = true; break; }
      }
      if (!hasWhere) {
        findings.push({ level: 'error', message: 'DELETE without WHERE clause will remove ALL rows from the table.' });
      }
    }
  }

  // LIKE without index hint (leading wildcard)
  if (upper.includes("LIKE '%") || upper.includes("LIKE '%")) {
    findings.push({ level: 'warn', message: "LIKE with leading wildcard ('%...') cannot use a B-tree index. Consider pg_trgm or full-text search." });
  }

  // NOT IN with subquery (NULL trap)
  if (/NOT\s+IN\s*\(/i.test(sql)) {
    findings.push({ level: 'warn', message: "NOT IN with subquery can return unexpected results if subquery returns NULL. Use NOT EXISTS instead." });
  }

  // ORDER BY without LIMIT on large queries
  const hasOrderBy = tokens.some(t => t.type === 'keyword' && t.value === 'ORDER');
  const hasLimit = tokens.some(t => t.type === 'keyword' && t.value === 'LIMIT');
  const hasFetch = tokens.some(t => t.type === 'keyword' && t.value === 'FETCH');
  if (hasOrderBy && !hasLimit && !hasFetch) {
    findings.push({ level: 'info', message: 'ORDER BY without LIMIT sorts the entire result set. Add LIMIT if you only need a subset.' });
  }

  // Implicit type cast with = on different types
  const castCount = (sql.match(/::/g) || []).length;
  if (castCount > 3) {
    findings.push({ level: 'info', message: `${castCount} explicit casts detected. Excessive casting may indicate schema/type mismatches.` });
  }

  // OFFSET for pagination
  if (/OFFSET\s+\d+/i.test(sql)) {
    const match = sql.match(/OFFSET\s+(\d+)/i);
    if (match && parseInt(match[1]) > 1000) {
      findings.push({ level: 'warn', message: `Large OFFSET (${match[1]}) is slow — Postgres must scan and discard rows. Use keyset pagination instead.` });
    }
  }

  // Multiple JOINs without conditions
  let joinCount = 0;
  for (const t of tokens) {
    if (t.type === 'keyword' && t.value === 'JOIN') joinCount++;
  }
  if (joinCount >= 5) {
    findings.push({ level: 'info', message: `${joinCount} JOINs detected. Consider if all are necessary — each join multiplies the planner\'s work.` });
  }

  // NOW() in queries (potential caching issue)
  if (/\bnow\(\)/i.test(sql)) {
    findings.push({ level: 'info', message: 'now() returns the same value for the entire transaction. Use clock_timestamp() if you need wall-clock time.' });
  }

  // COALESCE in WHERE (may prevent index use)
  if (/WHERE[\s\S]*?COALESCE/i.test(sql)) {
    findings.push({ level: 'info', message: 'COALESCE in WHERE clause may prevent index usage. Consider restructuring with IS NULL / IS NOT NULL.' });
  }

  return findings;
}

module.exports = { format, analyze, tokenize };
