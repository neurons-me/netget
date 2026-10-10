// The address bar and the route the GUI declares are two different things on the main server's own door.
//
// netget.site is the main-server app: its front page is "/". The root GUI declares that screen at "/netget"
// (cleaker.me/netget) and the namespace landing at "/". Three routes are involved and only these three are mapped;
// every other path means exactly what it meant before:
//
//   address bar   route the GUI renders
//   "/"           "/netget"      the main-server screen (this is what the door is)
//   "/.me"        "/"            the namespace landing (sign in / register). A path that starts with a dot is
//                                outside the tree, like /.gateway and /.monads, so it cannot shadow a node.
//   "/netget"     (moved to "/") would be cleaker.me/netget/netget, which is not a page
//
// The mapping is a bijection on the two paths it touches, so a Link to "/netget" is written "/" and a Link to "/"
// is written "/.me", and following either lands on the screen it names.

export const DOOR_ENTRY_ROUTE = '/netget';
export const DOOR_LANDING_URL = '/.me';

const clean = (p) => {
  const s = String(p == null ? '' : p);
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s || '/';
};

// address-bar path -> route the GUI renders
export function doorUrlToRoute(pathname) {
  const p = clean(pathname);
  if (p === '/') return DOOR_ENTRY_ROUTE;
  if (p === DOOR_LANDING_URL) return '/';
  return p;
}

// route the GUI names -> address-bar path
export function doorRouteToUrl(route) {
  const p = clean(route);
  if (p === DOOR_ENTRY_ROUTE) return '/';
  if (p === '/') return DOOR_LANDING_URL;
  return p;
}
