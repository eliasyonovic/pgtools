# pgsheet

Paste CSV or JSON. Get production-ready Postgres SQL.

**pgsheet** auto-detects column types, generates `CREATE TABLE` DDL, `INSERT` statements, and `COPY` commands — optimized for Postgres.

## Features

- **Smart type detection**: boolean, smallint, integer, bigint, numeric, date, timestamp, timestamptz, uuid, jsonb, text
- **Auto-detects format**: CSV (with delimiter detection) or JSON
- **Generates 3 output formats**: DDL (CREATE TABLE), INSERT batches, COPY from stdin
- **Suggests indexes** for UUID columns
- **Handles edge cases**: nullable columns, reserved word escaping, nested JSON → jsonb, quoted CSV fields
- **Real-time conversion** in the browser

## Quick Start

```bash
node server.js
# Open http://localhost:3000
```

## API

```bash
curl -X POST http://localhost:3000/api/convert \
  -H 'Content-Type: application/json' \
  -d '{"data":"name,age\nAlice,30\nBob,25","tableName":"users"}'
```

### Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| data | string | required | CSV or JSON text |
| tableName | string | imported_data | Postgres table name |
| schema | string | public | Schema name |
| addId | boolean | true | Add auto-increment id column |
| includeIndexes | boolean | true | Generate index suggestions |

## Type Detection Rules

| Priority | Type | Pattern |
|----------|------|---------|
| 1 | uuid | 8-4-4-4-12 hex |
| 2 | smallint/integer/bigint | integers by range |
| 3 | numeric | decimal numbers |
| 4 | boolean | true/false/t/f/yes/no |
| 5 | timestamptz | ISO 8601 with timezone |
| 6 | timestamp | ISO 8601 without timezone |
| 7 | date | YYYY-MM-DD |
| 8 | jsonb | valid JSON object/array |
| 9 | text | everything else |

## No Dependencies

Zero npm dependencies. Pure Node.js.

## License

MIT
