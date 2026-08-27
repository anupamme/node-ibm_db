// Consolidated describe/metadata test: describe database, table, column,
// db.columns() API, db.tables() API.
// Replaces: test-describe-column, test-describe-table, test-describe-database.

var common = require("./common")
  , ibmdb = require("../")
  , assert = require("assert")
  , cn = common.connectionString
  ;

var passed = 0, failed = 0;

function ok(label) { passed++; console.log("  PASS: " + label); }
function fail(label, detail) { failed++; console.log("  FAIL: " + label + " " + (detail || "")); }

var TABLE = common.tableName;
var DB = common.databaseName;

main();

async function main() {
  var conn;
  try {
    conn = await ibmdb.open(cn);
  } catch(e) {
    console.log("Connection failed:", e);
    process.exit(1);
  }

  // Setup
  await new Promise(function(resolve) {
    common.dropTables(conn, function() {
      common.createTables(conn, function(err) {
        if (err) console.log("createTables:", err.message);
        resolve();
      });
    });
  });

  await testDescribeDatabase(conn);
  await testDescribeTable(conn);
  await testDescribeColumn(conn);
  await testDescribePromise(conn);
  await testColumnsAPI(conn);
  await testColumnsInvalidArgs(conn);

  console.log("\n===== Describe/Metadata Tests: %d passed, %d failed =====", passed, failed);

  // Cleanup
  await new Promise(function(resolve) {
    common.dropTables(conn, function() { resolve(); });
  });

  await conn.close();
  process.exit(failed ? 1 : 0);
}

// describe with database only (list tables)
async function testDescribeDatabase(conn) {
  console.log("\n[testDescribeDatabase]");
  return new Promise(function(resolve) {
    conn.describe({ database: DB }, function(err, data) {
      try {
        if (err) throw err;
        assert.ok(data.length > 0, "describe database should return tables");
        ok("describe({ database }) returns table list");
      } catch(e) { fail("describe database", e.message); }
      resolve();
    });
  });
}

// describe with database + table (list columns of table)
async function testDescribeTable(conn) {
  console.log("\n[testDescribeTable]");
  return new Promise(function(resolve) {
    conn.describe({ database: DB, table: TABLE }, function(err, data) {
      try {
        if (err) throw err;
        assert.ok(data.length > 0, "describe table should return columns");
        ok("describe({ database, table }) returns column list");
      } catch(e) { fail("describe table", e.message); }
      resolve();
    });
  });
}

// describe with database + table + column
async function testDescribeColumn(conn) {
  console.log("\n[testDescribeColumn]");
  return new Promise(function(resolve) {
    conn.describe({ database: DB, table: TABLE, column: 'COLDATETIME' }, function(err, data) {
      try {
        if (err) throw err;
        assert.ok(data.length > 0, "describe column should return metadata");
        ok("describe({ database, table, column }) returns column metadata");
      } catch(e) { fail("describe column", e.message); }
      resolve();
    });
  });
}

// describe with Promise interface
async function testDescribePromise(conn) {
  console.log("\n[testDescribePromise]");
  try {
    var data = await conn.describe({ database: DB, table: TABLE });
    assert.ok(data.length > 0);
    ok("describe() with Promise returns column list");

    data = await conn.describe({ database: DB });
    assert.ok(data.length > 0);
    ok("describe() with Promise returns table list");

    data = await conn.describe({ database: DB, table: TABLE, column: 'COLDATETIME' });
    assert.ok(data.length > 0);
    ok("describe() with Promise returns column detail");
  } catch(e) { fail("describe promise", e.message); }
}

// db.columns() API
async function testColumnsAPI(conn) {
  console.log("\n[testColumnsAPI]");
  try {
    var result = await conn.columns(DB, '%', TABLE, 'COLDATETIME');
    assert.ok(result.length > 0, "columns() should return metadata");
    ok("db.columns(catalog, schema, table, column) works");
  } catch(e) { fail("db.columns", e.message); }
}

// db.columns() with invalid args
async function testColumnsInvalidArgs(conn) {
  console.log("\n[testColumnsInvalidArgs]");
  // columns() with wrong args fires two rejections; suppress the unhandled one
  var savedHandler = null;
  var unhandled = false;
  savedHandler = function(reason) { unhandled = true; };
  process.on('unhandledRejection', savedHandler);
  try {
    await conn.columns(DB, TABLE, 'COLDATETIME');
    fail("columns() with 3 args should throw");
  } catch(e) {
    ok("db.columns() with invalid args rejects");
  }
  // Allow microtask queue to flush before removing handler
  await new Promise(function(r) { setImmediate(r); });
  process.removeListener('unhandledRejection', savedHandler);
}
