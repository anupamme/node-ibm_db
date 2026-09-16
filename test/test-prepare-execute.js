// Consolidated prepare/execute test: prepare, bind, execute (sync/async),
// executeNonQuery, bad SQL, multiple execution, affected rows, statement close.
// Replaces: test-prepareSync-bad-sql, test-affected-rows, test-statement-close,
//   test-binding-statement-executeSync.

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

  await testPrepareSyncBadSql(conn);
  await testPrepareBindExecuteSync(conn);
  await testPrepareBindExecuteAsync(conn);
  await testExecuteNonQuery(conn);
  await testAffectedRows(conn);
  await testMultipleExecution(conn);
  await testStatementClose(conn);
  await testBindingLevelStatement(conn);

  await conn.close();
  console.log("\n===== Prepare/Execute Tests: %d passed, %d failed =====", passed, failed);
  process.exit(failed ? 1 : 0);
}

// prepareSync with bad SQL (deferred prepare may not throw until execute)
async function testPrepareSyncBadSql(conn) {
  console.log("\n[testPrepareSyncBadSql]");
  try {
    var stmt = conn.prepareSync("asdf asdf asdf asdf");
    // With deferred prepare on LUW, prepareSync may succeed
    assert.equal(stmt.constructor.name, "ODBCStatement");

    // Execute should fail
    return new Promise(function(resolve) {
      stmt.execute(function(err, result) {
        try {
          assert.ok(err, "execute of bad SQL should produce error");
          ok("bad SQL: execute returns error after deferred prepare");
        } catch(e) { fail("bad SQL execute", e.message); }

        // executeNonQuery should also fail
        stmt.executeNonQuery(function(err, count) {
          try {
            assert.ok(err, "executeNonQuery of bad SQL should produce error");
            ok("bad SQL: executeNonQuery returns error");
          } catch(e) { fail("bad SQL executeNonQuery", e.message); }
          resolve();
        });
      });
    });
  } catch(e) {
    // z/OS or non-deferred prepare: error at prepare time
    ok("bad SQL: prepareSync throws on non-deferred prepare");
  }
}

// Prepare + bindSync + executeSync
async function testPrepareBindExecuteSync(conn) {
  console.log("\n[testPrepareBindExecuteSync]");
  try {
    await conn.query("drop table pbe_tab").catch(function() {});
    await conn.query("create table pbe_tab (c1 int, c2 varchar(20))");

    var stmt = conn.prepareSync("insert into pbe_tab values (?, ?)");
    assert.equal(stmt.constructor.name, "ODBCStatement");

    var r = stmt.bindSync([10, 'hello']);
    assert.equal(r, true, "bindSync should return true");

    var result = stmt.executeSync();
    assert.equal(result.constructor.name, "ODBCResult");
    result.closeSync();

    var data = conn.querySync("select * from pbe_tab");
    assert.deepEqual(data, [{ C1: 10, C2: 'hello' }]);
    ok("prepareSync + bindSync + executeSync");

    stmt.closeSync();
    await conn.query("drop table pbe_tab");
  } catch(e) { fail("prepare/bind/executeSync", e.message); }
}

// Prepare + execute with params (async callback)
async function testPrepareBindExecuteAsync(conn) {
  console.log("\n[testPrepareBindExecuteAsync]");
  try {
    await conn.query("drop table pbe_async").catch(function() {});
    await conn.query("create table pbe_async (c1 int, c2 varchar(20))");
  } catch(e) { fail("setup pbe_async", e.message); return; }

  return new Promise(function(resolve) {
    conn.prepare("insert into pbe_async values (?, ?)", function(err, stmt) {
      if (err) { fail("prepare async", err.message); resolve(); return; }

      stmt.execute([5, 'world'], function(err, result) {
        if (err) { fail("execute async", err.message); resolve(); return; }
        result.closeSync();

        var data = conn.querySync("select * from pbe_async");
        try {
          assert.deepEqual(data, [{ C1: 5, C2: 'world' }]);
          ok("prepare + execute async with params");
        } catch(e) { fail("async execute verify", e.message); }

        stmt.closeSync();
        conn.querySync("drop table pbe_async");
        resolve();
      });
    });
  });
}

// executeNonQuery (returns affected row count directly)
async function testExecuteNonQuery(conn) {
  console.log("\n[testExecuteNonQuery]");
  try {
    await conn.query("drop table enq_tab").catch(function() {});
    await conn.query("create table enq_tab (c1 int, c2 varchar(20))");

    var stmt = await conn.prepare("insert into enq_tab values (?, ?)");
    var count = await stmt.executeNonQuery([1, 'one']);
    assert.equal(count, 1);
    ok("executeNonQuery returns 1 for single insert");

    count = await stmt.executeNonQuery([2, 'two']);
    assert.equal(count, 1);

    // executeNonQuerySync
    var insertedRows = stmt.executeNonQuerySync([3, 'three']);
    assert.equal(insertedRows, 1);
    ok("executeNonQuerySync returns 1");

    stmt.closeSync();
    await conn.query("drop table enq_tab");
  } catch(e) { fail("executeNonQuery", e.message); }
}

// getAffectedRowsSync after insert/update/delete
async function testAffectedRows(conn) {
  console.log("\n[testAffectedRows]");
  try {
    await conn.query("drop table ar_tab").catch(function() {});
    await conn.query("create table ar_tab (c1 int, c2 varchar(10))");
    conn.querySync("insert into ar_tab values (1, 'a')");
    conn.querySync("insert into ar_tab values (2, 'b')");
    conn.querySync("insert into ar_tab values (3, 'c')");
  } catch(e) { fail("affected rows setup", e.message); return; }

  return new Promise(function(resolve) {
    conn.prepare("update ar_tab set c2 = 'x' where c1 > ?", function(err, stmt) {
      if (err) { fail("affected rows prepare", err.message); resolve(); return; }

      var result = stmt.executeSync([1]);
      var affected = result.getAffectedRowsSync();
      try {
        assert.equal(affected, 2);
        ok("getAffectedRowsSync: update 2 rows");
      } catch(e) { fail("affected rows update", e.message); }
      result.closeSync();
      stmt.closeSync();

      conn.prepare("delete from ar_tab where c1 = ?", function(err, stmt) {
        if (err) { fail("affected rows delete prepare", err.message); resolve(); return; }
        stmt.execute([1], function(err, result) {
          if (err) { fail("affected rows delete", err.message); resolve(); return; }
          try {
            assert.equal(result.getAffectedRowsSync(), 1);
            ok("getAffectedRowsSync: delete 1 row");
          } catch(e) { fail("affected rows delete verify", e.message); }
          result.closeSync();
          stmt.closeSync();
          conn.querySync("drop table ar_tab");
          resolve();
        });
      });
    });
  });
}

// Multiple executions of same prepared statement
async function testMultipleExecution(conn) {
  console.log("\n[testMultipleExecution]");
  try {
    await conn.query("drop table multi_exec").catch(function() {});
    await conn.query("create table multi_exec (c1 int, c2 varchar(20))");

    var stmt = conn.prepareSync("insert into multi_exec values (?, ?)");
    for (var i = 1; i <= 5; i++) {
      stmt.bindSync([i, 'row' + i]);
      var result = stmt.executeSync();
      result.closeSync();
    }

    var data = conn.querySync("select * from multi_exec order by c1");
    assert.equal(data.length, 5);
    assert.equal(data[0].C1, 1);
    assert.equal(data[4].C1, 5);
    ok("multiple executions of same prepared statement");

    stmt.closeSync();
    await conn.query("drop table multi_exec");
  } catch(e) { fail("multiple execution", e.message); }
}

// Statement close with different options (0, 1, 2, 3, and no-arg)
async function testStatementClose(conn) {
  console.log("\n[testStatementClose]");
  var closeOptions = [0, 1, 2, 3]; // SQL_CLOSE, SQL_DROP, SQL_UNBIND, SQL_RESET_PARAMS

  for (var i = 0; i < closeOptions.length; i++) {
    var opt = closeOptions[i];
    try {
      await conn.query("drop table stclose" + opt).catch(function() {});
      await conn.query("create table stclose" + opt + " (col1 varchar(10))");
    } catch(e) { fail("stmt close setup opt " + opt, e.message); continue; }

    await (function(option) {
      return new Promise(function(resolve) {
        conn.prepare("insert into stclose" + option + " values(?)", function(err, stmt) {
          if (err) { fail("stmt close prepare opt " + option, err.message); resolve(); return; }
          stmt.execute(['test'], function(err, result) {
            if (err) { console.log(err); }
            conn.querySync("drop table stclose" + option);
            stmt.close(option, function(err) {
              try {
                assert.equal(err, null);
                ok("stmt.close(option=" + option + ") succeeds");
              } catch(e) { fail("stmt.close option " + option, e.message); }
              resolve();
            });
          });
        });
      });
    })(opt);
  }

  // stmt.close() with no argument (default)
  try {
    await conn.query("drop table stclosedef").catch(function() {});
    await conn.query("create table stclosedef (col1 varchar(10))");
  } catch(e) { fail("stmt close default setup", e.message); return; }

  await new Promise(function(resolve) {
    conn.prepare("insert into stclosedef values(?)", function(err, stmt) {
      if (err) { fail("stmt close default prepare", err.message); resolve(); return; }
      stmt.execute(['test'], function(err, result) {
        if (err) { console.log(err); }
        conn.querySync("drop table stclosedef");
        stmt.close(function(err) {
          try {
            assert.equal(err, null);
            ok("stmt.close() with no option (default) succeeds");
          } catch(e) { fail("stmt.close default", e.message); }
          resolve();
        });
      });
    });
  });
}

// Binding-level: createStatement, prepareSync, bindSync, executeSync
async function testBindingLevelStatement(conn) {
  console.log("\n[testBindingLevelStatement]");
  return new Promise(function(resolve) {
    var db = new ibmdb.ODBC();
    db.createConnection(function(err, rawConn) {
      if (err) { fail("binding createConnection", err.message); resolve(); return; }
      rawConn.openSync(cn);

      rawConn.createStatement(function(err, stmt) {
        if (err) { fail("binding createStatement", err.message); rawConn.closeSync(); resolve(); return; }

        // Execute without prepare should error
        try {
          stmt.executeSync();
          fail("binding: executeSync without prepare should throw");
        } catch(e) {
          ok("binding: executeSync without prepare throws");
        }

        // bind with non-array should error
        try {
          stmt.bind("select 1 from sysibm.sysdummy1");
          fail("binding: bind with string should throw");
        } catch(e) {
          assert.equal(e.message, "Argument 1 must be an Array");
          ok("binding: bind with non-array throws correct error");
        }

        // Proper prepare + bind + execute
        try {
          var r = stmt.prepareSync("select 1 + ? as COL1 from SYSIBM.SYSDUMMY1");
          assert.equal(r, true);

          r = stmt.bindSync([2]);
          assert.equal(r, true);

          var result = stmt.executeSync();
          assert.equal(result.constructor.name, "ODBCResult");

          var data = result.fetchAllSync();
          assert.deepEqual(data, [{ COL1: 3 }]);
          result.closeSync();
          ok("binding: prepare + bind + execute");

          // Re-bind with different value
          stmt.bindSync([7]);
          result = stmt.executeSync();
          data = result.fetchAllSync();
          assert.deepEqual(data, [{ COL1: 8 }]);
          result.closeSync();
          ok("binding: re-bind with different value");
        } catch(e) { fail("binding statement", e.message); }

        stmt.closeSync();
        rawConn.closeSync();
        resolve();
      });
    });
  });
}
