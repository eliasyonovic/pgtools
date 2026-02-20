#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { generate } = require('./src/generator');
const { format, analyze } = require('./src/sql-formatter');

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
pgtools - Postgres Developer Toolkit

Usage:
  pgtools sheet <file> [options]     Convert CSV/JSON to Postgres SQL
  pgtools format <file|->            Format SQL query
  pgtools analyze <file|->           Analyze SQL for common issues
  pgtools help                       Show this help

Sheet options:
  --table <name>      Table name (default: imported_data)
  --schema <name>     Schema name (default: public)
  --no-id             Don't add auto-increment id column
  --no-indexes        Don't generate index suggestions
  --mode <mode>       Output mode: ddl, inserts, copy, all (default: all)

Examples:
  pgtools sheet data.csv --table users
  pgtools sheet data.json --table products --mode ddl
  cat query.sql | pgtools format -
  pgtools analyze slow-query.sql
`;

function readInput(fileArg) {
  if (!fileArg || fileArg === '-') {
    return fs.readFileSync('/dev/stdin', 'utf8');
  }
  const filePath = path.resolve(fileArg);
  if (!fs.existsSync(filePath)) {
    console.error('Error: File not found: ' + filePath);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function getFlag(name, defaultVal) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return defaultVal;
  if (idx + 1 < args.length) return args[idx + 1];
  return true;
}

function hasFlag(name) {
  return args.includes('--' + name);
}

if (!command || command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (command === 'sheet') {
  const file = args[1];
  if (!file) { console.error('Error: Please provide a file path or - for stdin'); process.exit(1); }
  const data = readInput(file);
  const tableName = getFlag('table', 'imported_data');
  const schema = getFlag('schema', 'public');
  const mode = getFlag('mode', 'all');

  try {
    const result = generate(data, tableName, {
      schema,
      addId: !hasFlag('no-id'),
      includeIndexes: !hasFlag('no-indexes'),
    });

    if (mode === 'ddl') {
      process.stdout.write(result.ddl);
    } else if (mode === 'inserts') {
      process.stdout.write(result.inserts);
    } else if (mode === 'copy') {
      process.stdout.write(result.copy);
    } else {
      console.log('-- Table: ' + schema + '.' + tableName);
      console.log('-- Format: ' + result.format + ' | Rows: ' + result.rowCount + ' | Columns: ' + result.columnCount);
      console.log('-- Columns: ' + result.columns.map(c => c.pgName + ' (' + c.pgType + ')').join(', '));
      console.log('');
      process.stdout.write(result.ddl);
      console.log('');
      process.stdout.write(result.inserts);
    }
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }
}

else if (command === 'format') {
  const file = args[1];
  const sql = readInput(file);
  try {
    process.stdout.write(format(sql));
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }
}

else if (command === 'analyze') {
  const file = args[1];
  const sql = readInput(file);
  try {
    const formatted = format(sql);
    const findings = analyze(sql);
    process.stdout.write(formatted);
    if (findings.length > 0) {
      console.log('\n-- Analysis: ' + findings.length + ' finding(s)');
      for (const f of findings) {
        const prefix = f.level === 'error' ? 'ERROR' : f.level === 'warn' ? 'WARN ' : 'INFO ';
        console.log('-- [' + prefix + '] ' + f.message);
      }
    } else {
      console.log('\n-- No issues found.');
    }
  } catch (err) {
    console.error('Error: ' + err.message);
    process.exit(1);
  }
}

else {
  console.error('Unknown command: ' + command);
  console.log(HELP);
  process.exit(1);
}
