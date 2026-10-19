import assert from 'node:assert/strict';

// The one path the main server's own door maps between address bar and GUI route. Nothing else is mapped.
const { doorUrlToRoute, doorRouteToUrl, DOOR_ENTRY_ROUTE } =
  await import('../src/htmls/Netget-REACT/frontend_local/src/session/doorRoutes.js');

assert.equal(DOOR_ENTRY_ROUTE, '/netget');

// address bar -> route
assert.equal(doorUrlToRoute('/'), '/netget', 'the door IS the main-server screen');
assert.equal(doorUrlToRoute(''), '/netget');
assert.equal(doorUrlToRoute('/domains'), '/domains', 'every other path means what it always meant');
assert.equal(doorUrlToRoute('/logs'), '/logs');
assert.equal(doorUrlToRoute('/users'), '/users');
assert.equal(doorUrlToRoute('/.me'), '/.me', '"/.me" is not a route this door invents');
assert.equal(doorUrlToRoute('/netget'), '/netget', '(the canonical redirect moves it to / before the router sees it)');
assert.equal(doorUrlToRoute('/domains/'), '/domains', 'a trailing slash is the same path');

// route -> address bar (what a Link to X is written as)
assert.equal(doorRouteToUrl('/netget'), '/', 'a link to the main-server screen is the door itself');
assert.equal(doorRouteToUrl('/'), '/', 'the GUI\'s landing route has no address here: its link is the door');
assert.equal(doorRouteToUrl('/domains'), '/domains');
assert.equal(doorRouteToUrl('/users'), '/users');
assert.equal(doorRouteToUrl('/.me'), '/.me');

// everything except the landing route round-trips
for (const route of ['/netget', '/domains', '/logs', '/monad', '/home', '/users', '/blockchain', '/url', '/keychain', '/@someone']) {
  assert.equal(doorUrlToRoute(doorRouteToUrl(route)), route, `round trip ${route}`);
}
// no route is ever written as "/netget/netget", and no path is ever invented
assert.notEqual(doorRouteToUrl('/netget'), '/netget');
for (const route of ['/', '/netget', '/domains']) assert.ok(!doorRouteToUrl(route).includes('.me'), `no ".me" path for ${route}`);
console.log('frontend-door-routes: ok');
