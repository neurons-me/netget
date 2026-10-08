// Express 4 does not look at the promise an async route handler returns, so a handler that rejects (say a
// read through the monad while the monad is down) becomes an unhandled rejection, and on current Node that
// ends the whole process: every other route of this backend goes with it. This wraps every handler a router
// already holds so a rejection or a throw reaches next(err) instead, and adds the last-resort error handler
// that answers it as JSON. Call it on each router BEFORE it is mounted.
//
// Handlers with four parameters are error handlers and are left alone.
function wrap(handle) {
    if (typeof handle !== 'function' || handle.length >= 4 || handle.__guardedAsync) return handle;
    const guarded = function guardedHandler(req, res, next) {
        try {
            const result = handle.call(this, req, res, next);
            if (result && typeof result.then === 'function') result.then(undefined, next);
        } catch (error) {
            next(error);
        }
    };
    guarded.__guardedAsync = true;
    return guarded;
}

export function guardAsync(router) {
    for (const layer of router.stack || []) {
        if (layer.route) {
            for (const routeLayer of layer.route.stack) routeLayer.handle = wrap(routeLayer.handle);
        } else {
            layer.handle = wrap(layer.handle);
        }
    }
    return router;
}

// Answers whatever reached next(err). A request that already started its response cannot be changed, so it
// is handed to Express' own handler, which closes it.
export function jsonErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    const status = Number(error && (error.status || error.statusCode)) || 500;
    const cause = error && error.cause && error.cause.code ? ` (${error.cause.code})` : '';
    res.status(status >= 400 && status < 600 ? status : 500).json({
        error: status >= 500 ? 'INTERNAL_ERROR' : String((error && error.message) || 'ERROR'),
        detail: status >= 500 ? `${String((error && error.message) || error)}${cause}` : undefined,
    });
}
