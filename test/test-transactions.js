// Consolidated transaction test: beginTransaction, commit, rollback (async/sync),
// via Database API and via ODBC binding level.
// Replaces: test-transaction-commit, test-transaction-commit-sync,
//   test-binding-transaction-commit, test-binding-transaction-commitSync.

var common = require("./common")
  , ibmdb = require("../")
  , assert = require("assert")
  , cn = common.connectionString
  ;

var passed = 0, failed = 0;

function ok(label) { passed++; console.log("  PASS: " + label); }
function fail(label, detail) { failed++; console.log("  FAIL: " + label + " " + (detail || "")); }

var TABLE = "TXN_TEST_TAB";

main();

async function main() {
  var conn;
  try {
    conn = await ibmdb.open(cn);
  } catch(e) {
    console.log("Connection failed:", e);
    process.exit(1);
  }

  await setup(conn);
  await testRollbackAsync(conn);
  await testCommitAsync(conn);
  await testRollbackSync(conn);
  await testCommitSync(conn);
  await testRollbackTransactionSync(conn);
  await testCommitTransactionSync(conn);
  await testBindingLevelTransaction(conn);
  await testBindingLevelTransactionAsync(conn);
  await cleanup(conn);

  await conn.close();
  console.log("\n===== Transaction Tests: %d passed, %d failed =====", passed, failed);
  process.exit(failed ? 1 : 0);
}

async function setup(conn) {
  await conn.query("drop table " + TABLE).catch(function() {});
  await conn.query("create table " + TABLE + " (C1 INTEGER, C2 VARCHAR(20))");
}

async function cleanup(conn) {
  await conn.query("drop table " + TABLE).catch(function() {});
}

async function clearTable(conn) {
  conn.querySync("delete from " + TABLE);
}

// beginTransaction + endTransaction(rollback=true) via callback
async function testRollbackAsync(conn) {
  console.log("\n[testRollbackAsync]");
  await clearTable(conn);
  return new Promise(function(resolve) {
    conn.beginTransaction(function(err) {
      if (err) { fail("beginTransaction async", err.message); resolve(); return; }

      conn.querySync("insert into " + TABLE + " values (1, 'rollback_test')");

      conn.endTransaction(true, function(err) {  // true = rollback
        if (err) { fail("endTransaction rollback", err.message); resolve(); return; }

        var data = conn.querySync("select * from " + TABLE);
        try {
          assert.deepEqual(data, []);
          ok("async rollback: data not persisted");
        } catch(e) { fail("async rollback verify", e.message); }
        resolve();
      });
    });
  });
}

// beginTransaction + endTransaction(commit=false) via callback
async function testCommitAsync(conn) {
  console.log("\n[testCommitAsync]");
  await clearTable(conn);
  return new Promise(function(resolve) {
    conn.beginTransaction(function(err) {
      if (err) { fail("beginTransaction async commit", err.message); resolve(); return; }

      conn.querySync("insert into " + TABLE + " values (42, 'commit_test')");

      conn.endTransaction(false, function(err) {  // false = commit
        if (err) { fail("endTransaction commit", err.message); resolve(); return; }

        var data = conn.querySync("select * from " + TABLE);
        try {
          assert.deepEqual(data, [{ C1: 42, C2: 'commit_test' }]);
          ok("async commit: data persisted");
        } catch(e) { fail("async commit verify", e.message); }
        resolve();
      });
    });
  });
}

// beginTransactionSync + rollbackTransactionSync
async function testRollbackSync(conn) {
  console.log("\n[testRollbackSync]");
  await clearTable(conn);
  try {
    conn.beginTransactionSync();
    conn.querySync("insert into " + TABLE + " values (99, 'sync_rollback')");
    conn.rollbackTransactionSync();
    var data = conn.querySync("select * from " + TABLE);
    assert.deepEqual(data, []);
    ok("sync rollback: data not persisted");
  } catch(e) { fail("sync rollback", e.message); }
}

// beginTransactionSync + commitTransactionSync
async function testCommitSync(conn) {
  console.log("\n[testCommitSync]");
  await clearTable(conn);
  try {
    conn.beginTransactionSync();
    conn.querySync("insert into " + TABLE + " values (77, 'sync_commit')");
    conn.commitTransactionSync();
    var data = conn.querySync("select * from " + TABLE);
    assert.deepEqual(data, [{ C1: 77, C2: 'sync_commit' }]);
    ok("sync commit: data persisted");
  } catch(e) { fail("sync commit", e.message); }
}

// rollbackTransaction (async method name)
async function testRollbackTransactionSync(conn) {
  console.log("\n[testRollbackTransactionSync]");
  await clearTable(conn);
  return new Promise(function(resolve) {
    conn.beginTransaction(function(err) {
      if (err) { fail("beginTransaction for rollbackTransaction", err.message); resolve(); return; }
      conn.querySync("insert into " + TABLE + " values (55, 'rollback_method')");
      conn.rollbackTransaction(function(err) {
        if (err) { fail("rollbackTransaction callback", err.message); resolve(); return; }
        var data = conn.querySync("select * from " + TABLE);
        try {
          assert.deepEqual(data, []);
          ok("rollbackTransaction callback: data not persisted");
        } catch(e) { fail("rollbackTransaction verify", e.message); }
        resolve();
      });
    });
  });
}

// commitTransaction (async method name)
async function testCommitTransactionSync(conn) {
  console.log("\n[testCommitTransactionSync]");
  await clearTable(conn);
  return new Promise(function(resolve) {
    conn.beginTransaction(function(err) {
      if (err) { fail("beginTransaction for commitTransaction", err.message); resolve(); return; }
      conn.querySync("insert into " + TABLE + " values (88, 'commit_method')");
      conn.commitTransaction(function(err) {
        if (err) { fail("commitTransaction callback", err.message); resolve(); return; }
        var data = conn.querySync("select * from " + TABLE);
        try {
          assert.deepEqual(data, [{ C1: 88, C2: 'commit_method' }]);
          ok("commitTransaction callback: data persisted");
        } catch(e) { fail("commitTransaction verify", e.message); }
        resolve();
      });
    });
  });
}

// Test via ODBC binding level (db.createConnection)
async function testBindingLevelTransaction(conn) {
  console.log("\n[testBindingLevelTransaction]");
  await clearTable(conn);
  return new Promise(function(resolve) {
    var db = new ibmdb.ODBC();
    db.createConnection(function(err, rawConn) {
      if (err) { fail("createConnection", err.message); resolve(); return; }
      rawConn.openSync(cn);

      try {
        // Rollback test at binding level
        rawConn.beginTransactionSync();
        rawConn.querySync("insert into " + TABLE + " values (11, 'binding_rollback')");
        rawConn.endTransactionSync(true); // rollback
        var result = rawConn.querySync("select * from " + TABLE);
        var data = result.fetchAllSync();
        assert.deepEqual(data, []);
        ok("binding level: endTransactionSync rollback");

        // Commit test at binding level
        rawConn.beginTransactionSync();
        rawConn.querySync("insert into " + TABLE + " values (22, 'binding_commit')");
        rawConn.endTransactionSync(false); // commit
        result = rawConn.querySync("select * from " + TABLE);
        data = result.fetchAllSync();
        assert.deepEqual(data, [{ C1: 22, C2: 'binding_commit' }]);
        ok("binding level: endTransactionSync commit");
      } catch(e) { fail("binding level txn", e.message); }

      rawConn.closeSync();
      resolve();
    });
  });
}

// Async binding-level transactions (createConnection + async beginTransaction/endTransaction)
async function testBindingLevelTransactionAsync(conn) {
  console.log("\n[testBindingLevelTransactionAsync]");
  await clearTable(conn);
  return new Promise(function(resolve) {
    var db = new ibmdb.ODBC();
    db.createConnection(function(err, rawConn) {
      if (err) { fail("createConnection async", err.message); resolve(); return; }
      rawConn.openSync(cn);

      rawConn.beginTransaction(function(err) {
        if (err) { fail("binding async beginTransaction", err.message); rawConn.closeSync(); resolve(); return; }

        rawConn.querySync("insert into " + TABLE + " values (33, 'async_binding_rb')");

        rawConn.endTransaction(true, function(err) { // rollback
          if (err) { fail("binding async rollback", err.message); rawConn.closeSync(); resolve(); return; }

          var result = rawConn.querySync("select * from " + TABLE);
          var data = result.fetchAllSync();
          try {
            assert.deepEqual(data, []);
            ok("binding level async: endTransaction rollback");
          } catch(e) { fail("binding async rollback verify", e.message); }

          rawConn.beginTransaction(function(err) {
            if (err) { fail("binding async beginTransaction 2", err.message); rawConn.closeSync(); resolve(); return; }

            rawConn.querySync("insert into " + TABLE + " values (44, 'async_binding_cm')");

            rawConn.endTransaction(false, function(err) { // commit
              if (err) { fail("binding async commit", err.message); rawConn.closeSync(); resolve(); return; }

              result = rawConn.querySync("select * from " + TABLE);
              data = result.fetchAllSync();
              try {
                assert.deepEqual(data, [{ C1: 44, C2: 'async_binding_cm' }]);
                ok("binding level async: endTransaction commit");
              } catch(e) { fail("binding async commit verify", e.message); }

              rawConn.closeSync();
              resolve();
            });
          });
        });
      });
    });
  });
}
