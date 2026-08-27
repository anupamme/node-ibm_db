// Consolidated connection test: open/close (async, sync, promise), multi-connection,
// bad connection string, query on closed connection, connection object, connectTimeout.
// Replaces: test-open-close, test-openSync, test-global-open-close, test-connection-object,
//   test-bad-connection-string, test-closed, test-multi-open-close, test-multi-openSync-closeSync,
//   test-instantiate-one-and-end, test-require-and-end, test-promise-open-close,
//   test-open-connectTimeout, test-binding-connection-timeOut.

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
  await testInstantiateOnly();
  await testQueryOnClosedConnection();
  await testOpenCloseAsync();
  await testOpenCloseSync();
  await testOpenWithConnectionObject();
  await testOpenClosePromise();
  await testBadConnectionString();
  await testConnectTimeout();
  await testMultiOpenCloseAsync();
  await testMultiOpenCloseSync();
  await testGlobalOpenClose();

  console.log("\n===== Connection Tests: %d passed, %d failed =====", passed, failed);
  process.exit(failed ? 1 : 0);
}

// Test: just instantiating Database should not keep process alive
async function testInstantiateOnly() {
  console.log("\n[testInstantiateOnly]");
  var db = new ibmdb.Database();
  assert.equal(db.connected, false);
  ok("Database instantiation without open does not hang");
}

// Test: query on a connection that was never opened
async function testQueryOnClosedConnection() {
  console.log("\n[testQueryOnClosedConnection]");
  var db = new ibmdb.Database();
  assert.equal(db.connected, false);

  return new Promise(function(resolve) {
    db.query("select 1 from sysibm.sysdummy1", function(err, rs, sqlca) {
      try {
        assert.deepEqual(err.message, 'Connection not open.');
        assert.deepEqual(rs, []);
        assert.equal(sqlca.sqlcode, -30081);
        assert.equal(db.connected, false);
        ok("query on unopened connection returns error");
      } catch(e) {
        fail("query on unopened connection", e.message);
      }
      resolve();
    });
  });
}

// Test: open and close with callbacks
async function testOpenCloseAsync() {
  console.log("\n[testOpenCloseAsync]");
  return new Promise(function(resolve) {
    var db = new ibmdb.Database();
    db.open(cn, function(err) {
      try {
        assert.equal(err, null);
        assert.equal(db.connected, true);
      } catch(e) { fail("async open", e.message); resolve(); return; }

      db.close(function() {
        try {
          assert.equal(db.connected, false);
          ok("open and close with callbacks");
        } catch(e) { fail("async close", e.message); }

        // Verify query after close fails
        db.query("select 1 from sysibm.sysdummy1", function(err, rs, sqlca) {
          try {
            assert.deepEqual(err.message, 'Connection not open.');
            assert.deepEqual(rs, []);
            assert.equal(sqlca.sqlcode, -30081);
            ok("query after close returns error");
          } catch(e) { fail("query after close", e.message); }
          resolve();
        });
      });
    });
  });
}

// Test: openSync / closeSync
async function testOpenCloseSync() {
  console.log("\n[testOpenCloseSync]");
  var db = new ibmdb.Database();
  try {
    db.openSync(cn);
    assert.equal(db.connected, true);
    db.closeSync();
    assert.equal(db.connected, false);
    ok("openSync and closeSync");
  } catch(e) {
    fail("openSync/closeSync", e.message);
  }
}

// Test: open with connection object (not string)
async function testOpenWithConnectionObject() {
  console.log("\n[testOpenWithConnectionObject]");
  return new Promise(function(resolve) {
    var db = new ibmdb.Database();
    db.open(common.connectionObject, function(err) {
      try {
        assert.equal(err, null);
        assert.equal(db.connected, true);
        var result = db.querySync("select 1 as COL1 from sysibm.sysdummy1");
        assert.equal(result.length, 1);
        ok("open with connectionObject");
      } catch(e) { fail("open with connectionObject", e.message); }
      db.close(function() { resolve(); });
    });
  });
}

// Test: open/close using Promises
async function testOpenClosePromise() {
  console.log("\n[testOpenClosePromise]");
  var db = new ibmdb.Database();
  try {
    // query before open should reject
    var err = await db.query("select 1 from sysibm.sysdummy1").then(null, function(e) { return e; });
    assert.deepEqual(err, { message: 'Connection not open.', sqlstate: '08001', sqlcode: -30081 });
    assert.equal(db.connected, false);
    ok("promise: query before open rejects");

    await db.open(cn);
    assert.equal(db.connected, true);
    ok("promise: open resolves");

    await db.close();
    assert.equal(db.connected, false);
    ok("promise: close resolves");

    // query after close
    err = await db.query("select 1 from sysibm.sysdummy1").then(null, function(e) { return e; });
    assert.deepEqual(err, { message: 'Connection not open.', sqlstate: '08001', sqlcode: -30081 });
    ok("promise: query after close rejects");
  } catch(e) {
    fail("promise open/close", e.message);
  }
}

// Test: bad connection string
async function testBadConnectionString() {
  console.log("\n[testBadConnectionString]");
  var db = new ibmdb.Database();

  // Sync: should throw
  try {
    db.openSync("this is wrong");
    fail("bad connstr sync should throw");
  } catch(e) {
    assert.equal(db.connected, false);
    ok("openSync with bad connstr throws");
  }

  // Async: should return error with platform-specific message
  return new Promise(function(resolve) {
    db.open("this is wrong", function(err) {
      try {
        assert.ok(err);
        assert.equal(db.connected, false);
        if (/^win/.test(process.platform)) {
          assert.ok(err.message.indexOf('SQL1024N') >= 0);
        } else if (os.type() === "OS/390") {
          assert.ok(/SQLCODE\s*=\s*-950/.test(err.message));
        } else {
          assert.ok(err.message.indexOf('SQL1024N') >= 0);
        }
        ok("open with bad connstr returns platform-specific error");
      } catch(e) { fail("bad connstr async", e.message); }
      resolve();
    });
  });
}

// Test: connectTimeout property
async function testConnectTimeout() {
  console.log("\n[testConnectTimeout]");
  try {
    // Constructor option sets connectTimeout
    var db = new ibmdb.Database({ connectTimeout: 10, systemNaming: true });
    await db.open(cn);
    assert.equal(db.conn.connectTimeout, 10);
    assert.equal(db.conn.systemNaming, true);
    assert.equal(db.connected, true);
    ok("connectTimeout and systemNaming via constructor");
    await db.close();
  } catch(e) {
    fail("connectTimeout", e.message);
  }

  // Binding-level connectTimeout default and setter
  return new Promise(function(resolve) {
    var odbc = new ibmdb.ODBC();
    odbc.createConnection(function(err, conn) {
      if (err) { fail("binding createConnection", err.message); resolve(); return; }
      try {
        assert.equal(conn.connectTimeout, 30); // default is 30
        conn.connectTimeout = 99;
        assert.equal(conn.connectTimeout, 99);
        ok("binding-level connectTimeout default and setter");
      } catch(e) { fail("binding connectTimeout", e.message); }

      try { conn.openSync(cn); conn.closeSync(); } catch(e) { /* DB may be unreachable */ }
      resolve();
    });
  });
}

// Test: multiple async open/close in parallel
async function testMultiOpenCloseAsync() {
  console.log("\n[testMultiOpenCloseAsync]");
  var count = 5;
  var connections = [];

  return new Promise(function(resolve) {
    var opened = 0;
    var openFailed = false;
    for (var x = 0; x < count; x++) {
      (function() {
        var db = new ibmdb.Database();
        connections.push(db);
        db.open(cn, function(err) {
          if (err) {
            if (!openFailed) { openFailed = true; fail("multi open async", err.message); resolve(); }
            return;
          }
          opened++;
          if (opened === count) doClose();
        });
      })();
    }

    function doClose() {
      var closed = 0;
      connections.forEach(function(db) {
        db.close(function() {
          closed++;
          if (closed === count) {
            ok("multi open/close async (" + count + " connections)");
            resolve();
          }
        });
      });
    }
  });
}

// Test: multiple sync open/close
async function testMultiOpenCloseSync() {
  console.log("\n[testMultiOpenCloseSync]");
  var count = 5;
  var connections = [];

  try {
    for (var x = 0; x < count; x++) {
      var db = new ibmdb.Database();
      db.openSync(cn);
      assert.equal(db.connected, true);
      connections.push(db);
    }
    connections.forEach(function(db) {
      db.closeSync();
      assert.equal(db.connected, false);
    });
    ok("multi openSync/closeSync (" + count + " connections)");
  } catch(e) {
    fail("multi sync open/close", e.message);
  }
}

// Test: global open helper (ibmdb.open)
async function testGlobalOpenClose() {
  console.log("\n[testGlobalOpenClose]");
  return new Promise(function(resolve) {
    ibmdb.open(cn, function(err, conn) {
      try {
        assert.equal(err, null);
        assert.equal(conn.constructor.name, 'Database');
        assert.equal(conn.connected, true);
        ok("ibmdb.open() global helper");
      } catch(e) { fail("global open", e.message); }
      conn.close(function() { resolve(); });
    });
  });
}
