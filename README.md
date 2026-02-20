# pgtools

Free, fast Postgres developer utilities. No signup, no tracking, no BS.

**Zero dependencies. Runs in the browser or as a CLI.**

## Tools

### pgsheet - CSV/JSON to Postgres SQL
Paste CSV or JSON data and get production-ready Postgres SQL. Auto-detects column types, generates `CREATE TABLE`, `INSERT`, and `COPY` statements.

### pgquery - SQL Formatter & Analyzer
Format messy SQL and catch common Postgres mistakes: `UPDATE` without `WHERE`, `SELECT *`, leading wildcard `LIKE`, `NOT IN` null traps, large `OFFSET` pagination, and more.

## Web UI

```bash
node server.js
# Open http://localhost:3000
```

Everything runs client-side. Your data never leaves your browser.

## CLI

```bash
# Install globally
npm install -g pgtools

# Convert CSV/JSON to SQL
pgtools sheet data.csv --table users
pgtools sheet data.json --table products --mode ddl

# Format SQL
cat query.sql | pgtools format -

# Format + analyze SQL
pgtools analyze slow-query.sql
```

### CLI Options

```
pgtools sheet <file> [options]     Convert CSV/JSON to Postgres SQL
  --table <name>      Table name (default: imported_data)
  --schema <name>     Schema name (default: public)
  --no-id             Don't add auto-increment id column
  --no-indexes        Don't generate index suggestions
  --mode <mode>       Output: ddl, inserts, copy, all (default: all)

pgtools format <file|->            Format SQL query
pgtools analyze <file|->           Format + analyze SQL for issues
```

## Type Detection

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

## SQL Analysis Rules

- **UPDATE/DELETE without WHERE** - will modify/delete ALL rows
- **SELECT \*** - performance issues, breaks on schema changes
- **Leading wildcard LIKE** - can't use B-tree index
- **NOT IN with subquery** - null trap, use NOT EXISTS
- **ORDER BY without LIMIT** - sorts entire result set
- **Large OFFSET** - use keyset pagination instead
- **now() usage** - same value in entire transaction
- **COALESCE in WHERE** - may prevent index usage

## License

MIT
