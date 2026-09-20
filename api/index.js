// Vercel serverless entry point.
//
// Vercel serves index.html / app.js / styles.css straight from its CDN and
// rewrites only /api/* into this function (see vercel.json). An Express app is
// already a (req, res) handler, so handing Vercel the app is the whole adapter.
//
// server.js calls listen() only when it is the program being run, so the same
// file still works as `node server.js` locally and as `npm start` on a
// long-lived host. Nothing here is used outside Vercel.
//
// Note the cost of running this backend serverlessly: places-cache.js keeps its
// index on disk, and a serverless filesystem is read-only. The cache degrades to
// per-invocation memory and logs a warning it cannot write -- which means a cold
// start re-bills every Places query. Set PLACES_CACHE=off to silence the
// warnings, or accept the repeat billing.
module.exports = require('../server/server.js');
