import assert from 'node:assert/strict';

// The two paths the main server's own door maps between address bar and GUI route. Nothing else is mapped.
const { doorUrlToRoute, doorRouteToUrl, DOOR_ENTRY_ROUTE, DOOR_LANDING_URL } =
  await import('../src/htmls/Netget-REACT/frontend_local/src/session/doorRoutes.js');

assert.equal(DOOR_ENTRY_ROUTE, '/netget');
assert.equal(DOOR_LANDING_URL, '/.me');

// address bar -> route
assert.equal(doorUrlToRoute('/'), '/netget', 'the door IS the main-server screen');
assert.equal(doorUrlToRoute(''), '/netget');
assert.equal(doorUrlToRoute('/.me'), '/', 'the namespace landing is reachable, outside the tree');
assert.equal(doorUrlToRoute('/domains'), '/domains', 'every other path means what it always meant');
assert.equal(doorUrlToRoute('/logs'), '/logs');
assert.equal(doorUrlToRoute('/users'), '/users');
assert.equal(doorUrlToRoute('/netget'), '/netget', '(the canonical redirect moves it to / before the router sees it)');
assert.equal(doorUrlToRoute('/domains/'), '/domains', 'a trailing slash is the same path');

// route -> address bar (what a Link to X is written as)
assert.equal(doorRouteToUrl('/netget'), '/', 'a link to the main-server screen is the door itself');
assert.equal(doorRouteToUrl('/'), '/.me', 'a link to the landing goes to /.me');
assert.equal(doorRouteToUrl('/domains'), '/domains');
assert.equal(doorRouteToUrl('/users'), '/users');

// the two mappings are inverse on everything the shell can name
for (const route of ['/', '/netget', '/domains', '/logs', '/monad', '/home', '/users', '/blockchain', '/url', '/keychain', '/@someone']) {
  assert.equal(doorUrlToRoute(doorRouteToUrl(route)), route, `round trip ${route}`);
}
// no route is ever written as "/netget/netget" or as a path that doubles the node
assert.notEqual(doorRouteToUrl('/netget'), '/netget');
console.log('frontend-door-routes: ok');
