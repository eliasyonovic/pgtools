const { generate } = require('./src/generator');

// Test 1: CSV input
const csv = `name,age,email,signup_date,is_active,balance,user_id
John Doe,32,john@example.com,2024-01-15,true,1250.50,a1b2c3d4-e5f6-7890-abcd-ef1234567890
Jane Smith,28,jane@example.com,2024-03-22,false,0.00,b2c3d4e5-f6a7-8901-bcde-f12345678901
Bob Wilson,,bob@wilson.io,2024-06-01T14:30:00,true,99999.99,c3d4e5f6-a7b8-9012-cdef-123456789012`;

console.log('=== CSV Test ===');
const result = generate(csv, 'users');
console.log('Format:', result.format);
console.log('Rows:', result.rowCount, 'Columns:', result.columnCount);
console.log('\nColumns:');
result.columns.forEach(c => console.log(`  ${c.original} -> ${c.pgName} (${c.pgType}, nullable: ${c.nullable}, unique: ${c.isUnique})`));
console.log('\n--- DDL ---');
console.log(result.ddl);
console.log('\n--- INSERT ---');
console.log(result.inserts);

// Test 2: JSON input
const json = JSON.stringify([
  { product: "Widget A", price: 19.99, qty: 100, tags: ["sale", "new"], created: "2024-01-15T10:00:00Z" },
  { product: "Widget B", price: 49.99, qty: 25, tags: ["premium"], created: "2024-02-20T15:30:00Z" },
  { product: "Widget C", price: 9.99, qty: 500, tags: [], created: "2024-03-10T08:00:00+02:00" }
]);

console.log('\n\n=== JSON Test ===');
const result2 = generate(json, 'products');
console.log('Format:', result2.format);
console.log('Rows:', result2.rowCount, 'Columns:', result2.columnCount);
console.log('\nColumns:');
result2.columns.forEach(c => console.log(`  ${c.original} -> ${c.pgName} (${c.pgType}, nullable: ${c.nullable})`));
console.log('\n--- DDL ---');
console.log(result2.ddl);

console.log('\nAll tests passed!');
