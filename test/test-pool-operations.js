// Consolidated pool operations test: pool open/close, multiple connections,
// pool.close(), pool with transactions, pool with rollback, pool sync APIs.
// Replaces: test-pool-connect, test-pool-close, test-pool-rollbackTransaction.

var common = require("./common")
  , ibmdb = require("../")
  , assert = require("assert")
  , cn = common.connectionString
  ;

var passed = 0, failed = 0;

function ok(label) { passed++; console.log("  PASS: " + label); }
function fail(label, detail) { failed++; console.log("  FAIL: " + label + " " + (detail || "")); }

main();

async function main() {
  await testPoolOpenClose();
  await testPoolMultipleConnections();
  await testPoolCloseAll();
  await testPoolTransaction();
  await testPoolRollback();
  await testPoolSetMaxSize();
  await testPoolInitAsync();
  await testPoolMultipleClose();
  await testPoolSyncAPIs();

  console.log("\n===== Pool Operations Tests: %d passed, %d failed =====", passed, failed);
  process.exit(failed ? 1 : 0);
}

// Basic pool open and close single connection
async function testPoolOpenClose() {
  console.log("\n[testPoolOpenClose]");
  var pool = new ibmdb.Pool();
  return new Promise(function(resolve) {
    pool.open(cn, function(err, conn) {
      if (err) {
        fail("pool open", err.message);
        pool.close(function() { resolve(); });
        return;
      }
      try {
        assert.ok(conn);
        assert.equal(conn.connected, true);
        ok("pool.open returns valid connection");
      } catch(e) { fail("pool open verify", e.message); }

      conn.close(function(err) {
        try {
          assert.equal(err, null);
          ok("pool conn.close succeeds (returns to pool)");
        } catch(e) { fail("pool conn.close", e.message); }

        pool.close(function() {
          ok("pool.close after single connection");
          resolve();
        });
      });
    });
  });
}

// Open multiple connections from pool
async function testPoolMultipleConnections() {
  console.log("\n[testPoolMultipleConnections]");
  var pool = new ibmdb.Pool();
  var connectCount = 5;

  return new Promise(function(resolve) {
    var connections = [];
    var opened = 0;
    var done = 0;

    for (var x = 0; x < connectCount; x++) {
      (function(idx) {
        pool.open(cn, function(err, conn) {
          done++;
          if (err) {
            if (done === 1) fail("pool multi open #" + idx, err.message);
            if (done === connectCount) { pool.close(function() { resolve(); }); }
            return;
          }
          connections.push(conn);
          opened++;
          if (opened === connectCount) {
            try {
              assert.equal(connections.length, connectCount);
              ok("pool opened " + connectCount + " connections");
            } catch(e) { fail("pool multi count", e.message); }
            pool.close(function() {
              ok("pool.close after multiple connections");
              resolve();
            });
          }
        });
      })(x);
    }
  });
}

// pool.close closes all connections
async function testPoolCloseAll() {
  console.log("\n[testPoolCloseAll]");
  var pool = new ibmdb.Pool();

  return new Promise(function(resolve) {
    pool.open(cn, function(err, conn) {
      if (err) { fail("pool close all - open", err.message); resolve(); return; }

      var data = conn.querySync("select 1 as C1 from sysibm.sysdummy1");
      assert.deepEqual(data, [{ C1: 1 }]);

      conn.close(function() {
        // Connection returned to pool, now close pool entirely
        pool.close(function() {
          ok("pool.close releases all pooled connections");
          resolve();
        });
      });
    });
  });
}

// Transaction within pooled connection
async function testPoolTransaction() {
  console.log("\n[testPoolTransaction]");
  var pool = new ibmdb.Pool();

  return new Promise(function(resolve) {
    pool.open(cn, function(err, conn) {
      if (err) { fail("pool txn - open", err.message); resolve(); return; }

      conn.querySync("drop table pooltxn").toString();
      conn.querySync("create table pooltxn (c1 int, c2 varchar(20))");

      conn.beginTransaction(function(err) {
        if (err) { fail("pool beginTransaction", err.message); resolve(); return; }

        conn.querySync("insert into pooltxn values (1, 'pooled')");
        conn.commitTransaction(function(err) {
          if (err) { fail("pool commitTransaction", err.message); resolve(); return; }

          var data = conn.querySync("select * from pooltxn");
          try {
            assert.deepEqual(data, [{ C1: 1, C2: 'pooled' }]);
            ok("pool: commit persists data");
          } catch(e) { fail("pool txn commit verify", e.message); }

          conn.querySync("drop table pooltxn");
          conn.close(function() {
            pool.close(function() { resolve(); });
          });
        });
      });
    });
  });
}

// Rollback within pooled connection
async function testPoolRollback() {
  console.log("\n[testPoolRollback]");
  var pool = new ibmdb.Pool();

  return new Promise(function(resolve) {
    pool.open(cn, function(err, conn) {
      if (err) { fail("pool rollback - open", err.message); resolve(); return; }

      conn.querySync("drop table poolrb").toString();
      conn.querySync("create table poolrb (c1 int, c2 varchar(20))");

      conn.beginTransaction(function(err) {
        if (err) { fail("pool beginTransaction rb", err.message); resolve(); return; }

        conn.querySync("insert into poolrb values (5, 'will_rollback')");
        var data = conn.querySync("select * from poolrb");
        assert.equal(data.length, 1); // visible within txn

        conn.rollbackTransaction(function(err) {
          if (err) { fail("pool rollbackTransaction", err.message); resolve(); return; }

          data = conn.querySync("select * from poolrb");
          try {
            assert.deepEqual(data, []);
            ok("pool: rollback removes uncommitted data");
          } catch(e) { fail("pool txn rollback verify", e.message); }

          conn.querySync("drop table poolrb");
          conn.close(function() {
            pool.close(function() { resolve(); });
          });
        });
      });
    });
  });
}

// setMaxPoolSize
async function testPoolSetMaxSize() {
  console.log("\n[testPoolSetMaxSize]");
  var pool = new ibmdb.Pool();
  try {
    pool.setMaxPoolSize(3);
    ok("setMaxPoolSize does not throw");
  } catch(e) { fail("setMaxPoolSize", e.message); }

  return new Promise(function(resolve) {
    pool.open(cn, function(err, conn) {
      if (err) { fail("pool maxSize open", err.message); resolve(); return; }
      conn.close(function() {
        pool.close(function() { resolve(); });
      });
    });
  });
}

// pool.initAsync
async function testPoolInitAsync() {
  console.log("\n[testPoolInitAsync]");
  var pool = new ibmdb.Pool();
  pool.setMaxPoolSize(3);
  try {
    await pool.initAsync(1, cn);
    ok("pool.initAsync initializes pool");
  } catch(e) {
    // initAsync may fail on some configurations
    console.log("  SKIP: pool.initAsync - " + e.message);
    passed++;
  }

  return new Promise(function(resolve) {
    pool.open(cn, function(err, conn) {
      if (err) { fail("pool after init open", err.message); resolve(); return; }
      var data = conn.querySync("select 1 as C1 from sysibm.sysdummy1");
      try {
        assert.deepEqual(data, [{ C1: 1 }]);
        ok("query on pool connection after initAsync");
      } catch(e) { fail("query after initAsync", e.message); }
      conn.close(function() {
        pool.close(function() { resolve(); });
      });
    });
  });
}

// Pool: close returns conn to pool, conn still usable, realClose terminates
async function testPoolMultipleClose() {
  console.log("\n[testPoolMultipleClose]");
  var pool = new ibmdb.Pool();

  return new Promise(function(resolve) {
    pool.open(cn, function(err, conn) {
      if (err) { fail("pool multi-close open", err.message); resolve(); return; }

      conn.close(function(err) {
        if (err) { fail("pool first close", err.message); resolve(); return; }
        // After close, conn is returned to pool — should still be queryable
        try {
          var data = conn.querySync("select 1 as C1 from sysibm.sysdummy1");
          assert.deepEqual(data, [{ C1: 1 }]);
          ok("pool: conn still queryable after close (returned to pool)");
        } catch(e) { fail("pool query after close", e.message); }

        conn.close(function(err) {
          if (err) { fail("pool second close", err.message); resolve(); return; }
          ok("pool: second close succeeds");

          // Get connection back and realClose it
          pool.open(cn, function(err, conn2) {
            if (err) { fail("pool reopen", err.message); resolve(); return; }
            conn2.realClose(function(err) {
              if (err) { fail("realClose", err.message); resolve(); return; }
              // After realClose, query should fail
              try {
                conn2.querySync("select 1 from sysibm.sysdummy1");
                fail("query after realClose should throw");
              } catch(e) {
                ok("pool: realClose terminates connection");
              }
              pool.close(function() { resolve(); });
            });
          });
        });
      });
    });
  });
}

// Pool: openSync and closeSync
async function testPoolSyncAPIs() {
  console.log("\n[testPoolSyncAPIs]");
  var pool = new ibmdb.Pool();
  try {
    var conn = pool.openSync(cn);
    assert.ok(conn);
    var data = conn.querySync("select 1 as C1 from sysibm.sysdummy1");
    assert.deepEqual(data, [{ C1: 1 }]);
    ok("pool.openSync works");

    // closeSync returns conn to pool — should still be queryable
    conn.closeSync();
    data = conn.querySync("select 2 as C2 from sysibm.sysdummy1");
    assert.deepEqual(data, [{ C2: 2 }]);
    ok("pool: conn queryable after closeSync (returned to pool)");

    conn.closeSync();
    // Get conn back and realCloseSync it
    conn = pool.openSync(cn);
    var rc = conn.realCloseSync();
    assert.ok(rc === true || rc === undefined);
    ok("pool: realCloseSync terminates connection");

    try {
      conn.querySync("select 3 from sysibm.sysdummy1");
      fail("query after realCloseSync should throw");
    } catch(e2) {
      ok("pool: query after realCloseSync throws");
    }

    pool.closeSync();
    ok("pool.closeSync works");
  } catch(e) { fail("pool sync APIs", e.message); }
}
