'use strict';

// Wraps a sync or async route handler: a returned value is sent as JSON and
// thrown errors (HttpError or otherwise) go to the Express error handler.
function handler(fn) {
  return (req, res, next) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch(next);
  };
}

module.exports = { handler };
