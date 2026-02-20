// Type detection engine for Postgres column types
// Analyzes sample values and infers the best Postgres type

const TYPE_PRIORITY = [
  'boolean', 'smallint', 'integer', 'bigint', 'numeric',
  'date', 'timestamp', 'timestamptz', 'uuid', 'jsonb', 'text'
];

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

  // UUID (check early, very specific pattern)
  if (UUID_RE.test(v)) return 'uuid';

  // Numeric types (check before boolean so 0/1 are treated as numbers)
  if (INTEGER_RE.test(v)) {
    const n = BigInt(v);
    if (n >= -32768n && n <= 32767n) return 'smallint';
    if (n >= -2147483648n && n <= 2147483647n) return 'integer';
    if (n >= -9223372036854775808n && n <= 9223372036854775807n) return 'bigint';
    return 'numeric';
  }
  if (NUMERIC_RE.test(v)) return 'numeric';

  // Boolean (after numbers, so 0/1 are ints not booleans)
  if (BOOLEAN_VALS.has(v.toLowerCase())) return 'boolean';

  // Timestamps (check tz first, it's more specific)
  if (TIMESTAMPTZ_RE.test(v)) return 'timestamptz';
  if (TIMESTAMP_RE.test(v)) return 'timestamp';
  if (DATE_RE.test(v)) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return 'date';
  }

  // JSON
  if ((v.startsWith('{') && v.endsWith('}')) || (v.startsWith('[') && v.endsWith(']'))) {
    try { JSON.parse(v); return 'jsonb'; } catch {}
  }

  return 'text';
}

function resolveType(types) {
  // Given an array of detected types for a column, pick the best Postgres type
  const unique = [...new Set(types.filter(t => t !== null))];
  if (unique.length === 0) return 'text';
  if (unique.length === 1) return unique[0];

  // If mix of integer sizes, widen
  const intTypes = new Set(['smallint', 'integer', 'bigint']);
  if (unique.every(t => intTypes.has(t))) {
    if (unique.includes('bigint')) return 'bigint';
    if (unique.includes('integer')) return 'integer';
    return 'smallint';
  }

  // If mix of int and numeric, use numeric
  const numericTypes = new Set(['smallint', 'integer', 'bigint', 'numeric']);
  if (unique.every(t => numericTypes.has(t))) return 'numeric';

  // If mix of date/timestamp types, widen to timestamptz
  const timeTypes = new Set(['date', 'timestamp', 'timestamptz']);
  if (unique.every(t => timeTypes.has(t))) {
    if (unique.includes('timestamptz')) return 'timestamptz';
    if (unique.includes('timestamp')) return 'timestamp';
    return 'date';
  }

  // If mix of boolean and integer types, use smallint (0/1 compatible)
  const boolIntTypes = new Set(['boolean', 'smallint', 'integer', 'bigint']);
  if (unique.every(t => boolIntTypes.has(t))) return 'smallint';

  // Fallback: text
  return 'text';
}

function analyzeColumn(values) {
  const types = values.map(detectType);
  const nullCount = types.filter(t => t === null).length;
  const nullable = nullCount > 0;
  const pgType = resolveType(types);

  // Check if all non-null values are unique (potential primary key / unique constraint)
  const nonNull = values.filter(v => v !== null && v !== undefined && String(v).trim() !== '');
  const isUnique = new Set(nonNull.map(String)).size === nonNull.length && nonNull.length > 1;

  return { pgType, nullable, isUnique, sampleSize: values.length, nullCount };
}

module.exports = { detectType, resolveType, analyzeColumn };
