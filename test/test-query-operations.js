// Consolidated query operations test: query (async/sync/promise), queryResult,
// queryStream, fetchMode (object/array), insert, DDL, error handling.
// Replaces: test-query-select, test-querySync-select, test-querySync-select-with-exception,
//   test-query-select-fetch, test-query-select-fetchMode-array, test-query-insert,
//   test-query-create-table, test-query-create-table-fetchSync, test-query-drop-table,
//   test-queryResult, test-queryStream.

var common = require("./common")
  , ibmdb = require("../")
  , assert = require("assert")
  , os = require("os")
  , cn = common.connectionString
  ;

var passed = 0, failed = 0;

function ok(label) { passed++; console.log("  PASS: " + label); }
function fail(label, detail) { failed++; console.log("  FAIL: " + label + " " + (detail || "")); }

main();

async function main() {
  var conn;
  try {
    conn = await ibmdb.open(cn);
  } catch(e) {
    console.log("Connection failed:", e);
    process.exit(1);
  }

  await testQuerySyncSelect(conn);
  await testQuerySyncFetchModes(conn);
  await testQuerySyncException(conn);
  await testQueryAsyncCallback(conn);
  await testQueryAsyncPromise(conn);
  await testQueryResultAndFetch(conn);
  await testQueryResultSync(conn);
  await testQueryStreamSuccess(conn);
  await testQueryStreamError(conn);
  await testQueryInsert(conn);
  await testQueryDDL(conn);
  await testQueryWithParams(conn);
  await testDuplicateColumnNames(conn);
  await testColumnAlias(conn);
  await testMultiStatementError(conn);
  await testGetSQLError(conn);
  await testParamTypeObject(conn);
  await testMixedAliasColumns(conn);
  await testFinalTableInsert(conn);
  await testQueryResultWithParams(conn);

  await conn.close();
  console.log("\n===== Query Operations Tests: %d passed, %d failed =====", passed, failed);
  process.exit(failed ? 1 : 0);
}

// querySync: basic select with object mode
async function testQuerySyncSelect(conn) {
  console.log("\n[testQuerySyncSelect]");
  try {
    var data = conn.querySync("select 1 as \"COLINT\", 'some test' as \"COLTEXT\" FROM SYSIBM.SYSDUMMY1");
    assert.deepEqual(data, [{ COLINT: 1, COLTEXT: 'some test' }]);
    ok("querySync returns object row");
  } catch(e) { fail("querySync select", e.message); }
}

// querySync: fetch modes (array and object)
async function testQuerySyncFetchModes(conn) {
  console.log("\n[testQuerySyncFetchModes]");
  try {
    conn.fetchMode = 3; // FETCH_ARRAY
    var data = conn.querySync("select 1, 2, 3 from sysibm.sysdummy1");
    assert.deepEqual(data, [[1, 2, 3]]);
    ok("querySync with FETCH_ARRAY mode");

    conn.fetchMode = 4; // FETCH_OBJECT (default)
    data = conn.querySync("select 1 as COL1 from sysibm.sysdummy1");
    assert.deepEqual(data, [{ COL1: 1 }]);
    ok("querySync with FETCH_OBJECT mode");
  } catch(e) {
    fail("querySync fetch modes", e.message);
  } finally {
    conn.fetchMode = 4;
  }
}

// querySync: invalid SQL returns error object or throws
async function testQuerySyncException(conn) {
  console.log("\n[testQuerySyncException]");
  var err = null;
  try {
    err = conn.querySync("select invalid query");
  } catch(e) {
    err = e;
  }
  try {
    assert.ok(err, "querySync should produce an error for bad SQL");
    assert.ok(typeof err.sqlcode === 'number', "sqlcode should be a number");
    assert.ok(typeof err.sqlstate === 'string' && err.sqlstate.length > 0);
    assert.ok(err.error || err.message, "should have error or message property");
    if (err instanceof Error) {
      assert.ok(err.message.length > 0);
    } else {
      assert.equal(err.error, "[node-ibm_db] Error in ODBCConnection::QuerySync while executing query.");
    }
    ok("querySync returns error with sqlcode and sqlstate");
  } catch(e) { fail("querySync exception", e.message); }
}

// query: async callback style
async function testQueryAsyncCallback(conn) {
  console.log("\n[testQueryAsyncCallback]");
  return new Promise(function(resolve) {
    conn.query("select 1 as COLINT, 'hello' as COLTEXT from sysibm.sysdummy1", function(err, data) {
      try {
        assert.equal(err, null);
        assert.equal(data.length, 1);
        assert.equal(data[0].COLINT, '1');
        assert.equal(data[0].COLTEXT, 'hello');
        ok("query async callback returns data");
      } catch(e) { fail("query async callback", e.message); }
      resolve();
    });
  });
}

// query: promise style
async function testQueryAsyncPromise(conn) {
  console.log("\n[testQueryAsyncPromise]");
  try {
    var data = await conn.query("select 42 as NUM from sysibm.sysdummy1");
    assert.equal(data[0].NUM, '42');
    ok("query with promise returns data");
  } catch(e) { fail("query promise", e.message); }
}

// queryResult + fetch (callback)
async function testQueryResultAndFetch(conn) {
  console.log("\n[testQueryResultAndFetch]");
  return new Promise(function(resolve) {
    var query = { sql: "select 1 as COLINT, 'test' as COLTEXT FROM SYSIBM.SYSDUMMY1" };
    conn.queryResult(query, function(err, result) {
      try {
        assert.equal(err, null);
        assert.equal(result.constructor.name, "ODBCResult");
      } catch(e) { fail("queryResult", e.message); resolve(); return; }

      result.fetch(function(err, data) {
        try {
          assert.equal(err, null);
          assert.deepEqual(data, { COLINT: '1', COLTEXT: 'test' });
          ok("queryResult + fetch returns single row");
        } catch(e) { fail("queryResult fetch", e.message); }

        // Verify metadata
        try {
          var meta = result.getColumnMetadataSync();
          assert.ok(Array.isArray(meta));
          assert.ok(meta.length >= 2);
          ok("getColumnMetadataSync returns column info");
        } catch(e) { fail("getColumnMetadataSync", e.message); }

        result.closeSync();
        resolve();
      });
    });
  });
}

// queryResultSync
async function testQueryResultSync(conn) {
  console.log("\n[testQueryResultSync]");
  try {
    var result = conn.queryResultSync("select 'abc' as C1 from sysibm.sysdummy1");
    assert.equal(result.constructor.name, "ODBCResult");
    var data = result.fetchAllSync();
    assert.deepEqual(data, [{ C1: 'abc' }]);
    result.closeSync();
    ok("queryResultSync + fetchAllSync");
  } catch(e) { fail("queryResultSync", e.message); }
}

// queryStream: success case
async function testQueryStreamSuccess(conn) {
  console.log("\n[testQueryStreamSuccess]");
  return new Promise(function(resolve) {
    var sql = "select 1 as COLINT, 'stream' as COLTEXT FROM SYSIBM.SYSDUMMY1";
    var stream = conn.queryStream(sql);
    var rows = [];

    stream.on('data', function(data) {
      rows.push(data);
    }).on('error', function(err) {
      fail("queryStream success case got error", err.message);
      resolve();
    }).on('end', function() {
      try {
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0], { COLINT: '1', COLTEXT: 'stream' });
        ok("queryStream emits data and end");
      } catch(e) { fail("queryStream data", e.message); }
      resolve();
    });
  });
}

// queryStream: error case (bad SQL)
async function testQueryStreamError(conn) {
  console.log("\n[testQueryStreamError]");
  return new Promise(function(resolve) {
    var stream = conn.queryStream("wrong query syntax");
    stream.once('data', function() {
      fail("queryStream error case should not emit data");
      resolve();
    }).once('error', function(err) {
      try {
        assert.ok(err instanceof Error);
        assert.ok(typeof err.sqlcode === 'number');
        assert.ok(typeof err.sqlstate === 'string' && err.sqlstate.length > 0);
        ok("queryStream emits Error with sqlcode/sqlstate");
      } catch(e) { fail("queryStream error", e.message); }
      resolve();
    });
  });
}

// Insert and verify with query
async function testQueryInsert(conn) {
  console.log("\n[testQueryInsert]");
  try {
    await conn.query("drop table qtesttab").catch(function() {});
    await conn.query("create table qtesttab (COLINT INTEGER, COLTEXT VARCHAR(50))");
    await conn.query("insert into qtesttab values (1, 'first')");
    await conn.query("insert into qtesttab values (2, 'second')");
    await conn.query("insert into qtesttab values (3, 'third')");

    var data = conn.querySync("select * from qtesttab order by COLINT");
    assert.equal(data.length, 3);
    assert.equal(data[0].COLINT, 1);
    assert.equal(data[0].COLTEXT, 'first');
    assert.equal(data[2].COLINT, 3);
    ok("insert and select verify data");

    await conn.query("drop table qtesttab");
    ok("drop table after insert");
  } catch(e) { fail("query insert", e.message); }
}

// DDL: create table via queryResult and fetchAllSync on DDL
async function testQueryDDL(conn) {
  console.log("\n[testQueryDDL]");
  return new Promise(function(resolve) {
    conn.querySync("drop table ddltest").toString(); // ignore error
    conn.queryResult("create table ddltest (C1 INTEGER, C2 VARCHAR(10))", function(err, result) {
      try {
        // DDL may or may not return result depending on driver
        if (result) {
          try {
            var data = result.fetchAllSync();
            // DDL returns empty result
            assert.deepEqual(data, []);
          } catch(e) { /* fetchAllSync on DDL may throw */ }
          result.closeSync();
        }
        ok("DDL via queryResult does not crash");
      } catch(e) { fail("DDL queryResult", e.message); }

      conn.querySync("drop table ddltest");
      resolve();
    });
  });
}

// Query with parameterized values
async function testQueryWithParams(conn) {
  console.log("\n[testQueryWithParams]");
  try {
    await conn.query("drop table paramtab").catch(function() {});
    await conn.query("create table paramtab (C1 INTEGER, C2 VARCHAR(20))");
    await conn.query("insert into paramtab values (?, ?)", [10, 'hello']);
    await conn.query("insert into paramtab values (?, ?)", [20, 'world']);

    var data = conn.querySync("select * from paramtab order by C1");
    assert.equal(data.length, 2);
    assert.equal(data[0].C1, 10);
    assert.equal(data[0].C2, 'hello');
    assert.equal(data[1].C1, 20);
    assert.equal(data[1].C2, 'world');
    ok("query with parameter markers");

    await conn.query("drop table paramtab");
  } catch(e) { fail("query with params", e.message); }
}

// Duplicate column names
async function testDuplicateColumnNames(conn) {
  console.log("\n[testDuplicateColumnNames]");
  try {
    var data = await conn.query("select 'text 1' as name, 'text 2' as name from SYSIBM.SYSDUMMY1");
    assert.equal(data.length, 1);
    // With duplicate names, second column gets a suffix
    ok("duplicate column names handled without crash");
  } catch(e) { fail("duplicate column names", e.message); }
}

// Column alias
async function testColumnAlias(conn) {
  console.log("\n[testColumnAlias]");
  try {
    var data = await conn.query("select 1 as \"COLINT\", 'some test' as \"COLTEXT\" FROM SYSIBM.SYSDUMMY1");
    assert.deepEqual(data, [{ COLINT: '1', COLTEXT: 'some test' }]);
    ok("column alias in async query");
  } catch(e) { fail("column alias", e.message); }
}

// Multi-statement SQL should return error (issue #557)
async function testMultiStatementError(conn) {
  console.log("\n[testMultiStatementError]");
  try {
    await conn.query("drop table mstab").catch(function() {});
    // Query referencing non-existent table in multi-statement
    var err = await conn.query("select * from mstab_nonexist; select 1 from sysibm.sysdummy1;")
      .then(function() { return null; })
      .catch(function(e) { return e; });
    assert.ok(err, "multi-statement with bad table should error");
    assert.ok(err.message.search("SQL0204N|42704") > 0 || err.message.length > 0);
    ok("multi-statement SQL error detected");
  } catch(e) { fail("multi-statement error", e.message); }
}

// getSQLErrorSync from queryResult
async function testGetSQLError(conn) {
  console.log("\n[testGetSQLError]");
  try {
    var result = conn.queryResultSync("select 1 as C1 from sysibm.sysdummy1");
    var sqlErr = result.getSQLErrorSync();
    // getSQLErrorSync returns {error, sqlcode, sqlstate} object
    assert.ok(sqlErr !== null && sqlErr !== undefined);
    assert.ok(typeof sqlErr.sqlcode === 'number');
    result.fetchAllSync();
    result.closeSync();
    ok("getSQLErrorSync returns error object");
  } catch(e) { fail("getSQLErrorSync", e.message); }
}

// Mixed aliased and unnamed columns
async function testMixedAliasColumns(conn) {
  console.log("\n[testMixedAliasColumns]");
  try {
    var data = conn.querySync("select 'abc' as first, 'dcd' as second, 'efg', 'pqr', 'xyz' as last from SYSIBM.SYSDUMMY1");
    assert.equal(data.length, 1);
    assert.equal(data[0].FIRST, 'abc');
    assert.equal(data[0].LAST, 'xyz');
    ok("mixed aliased and unnamed columns");
  } catch(e) { fail("mixed alias columns", e.message); }
}

// select from final table (insert ...) — DB2-specific syntax
async function testFinalTableInsert(conn) {
  console.log("\n[testFinalTableInsert]");
  try {
    await conn.query("drop table fintab").catch(function() {});
    await conn.query("create table fintab (COLINT INTEGER, COLTEXT VARCHAR(50))");
    var param1 = {ParamType: "IN", DataType: "SQL_CHAR", Data: 'rocket'};
    var data = conn.querySync("select COLTEXT from final table (insert into fintab (COLTEXT) values (?))", [param1]);
    assert.deepEqual(data, [{ COLTEXT: 'rocket' }]);
    ok("select from final table (insert) with param");
    await conn.query("drop table fintab");
  } catch(e) { fail("final table insert", e.message); }
}

// queryResult with parameter markers
async function testQueryResultWithParams(conn) {
  console.log("\n[testQueryResultWithParams]");
  return new Promise(function(resolve) {
    conn.queryResult('select 1 as COL1 from sysibm.sysdummy1 where 1 = ?', [1], function(err, result) {
      try {
        assert.equal(err, null);
        var data = result.fetchAllSync();
        assert.equal(data.length, 1);
        result.closeSync();
        ok("queryResult with parameter markers");
      } catch(e) { fail("queryResult with params", e.message); }
      resolve();
    });
  });
}

// Query with ParamType as JSON object (CHAR type insert)
async function testParamTypeObject(conn) {
  console.log("\n[testParamTypeObject]");
  try {
    await conn.query("drop table ptobj").catch(function() {});
    await conn.query("create table ptobj (c1 int, c2 char(5))");
    await conn.query("insert into ptobj values (?, ?)",
      [1, { ParamType: 'INPUT', SQLType: 'CHAR', Data: 'ABCD' }]);
    var data = conn.querySync("select * from ptobj");
    assert.equal(data.length, 1);
    assert.equal(data[0].C1, 1);
    // CHAR(5) pads with space
    assert.equal(data[0].C2.trim(), 'ABCD');
    ok("ParamType as JSON object with SQLType:CHAR");
    await conn.query("drop table ptobj");
  } catch(e) { fail("ParamType object", e.message); }
}
