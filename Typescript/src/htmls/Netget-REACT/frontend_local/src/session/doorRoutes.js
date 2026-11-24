// The address bar and the route the GUI declares are two different things on the main server's own door.
//
// netget.site is the main-server app: its front page is "/". The root GUI declares that screen at "/netget"
// (cleaker.me/netget). One path is mapped, nothing else:
//
//   address bar   route the GUI renders
//   "/"           "/netget"      the main-server screen: this is what the door is
//   "/netget"     (moved to "/") on this door it would be cleaker.me/netget/netget, which is not a page
//
// The namespace landing ("/" in the GUI's own routes) has no address on this door: identity is the card the rail's
// QR opens over whatever page this is, not a place to go to. A link to the GUI's "/" is written "/" here, and "/"
// opens the main-server screen. Every other path means exactly what it meant before.

export const DOOR_ENTRY_ROUTE = '/netget';

const clean = (p) => {
  const s = String(p == null ? '' : p);
  return s.length > 1 ? s.replace(/\/+$/, '') || '/' : s || '/';
};

// address-bar path -> route the GUI renders.
// `mapRootToNetget` (default true): the main-server door's "/" is /netget. The visitor is not
// offered the gateway panel, so App passes false and "/" stays the namespace itself.
export function doorUrlToRoute(pathname, { mapRootToNetget } = { mapRootToNetget: true }) {
  const p = clean(pathname);
  return mapRootToNetget !== false && p === '/' ? DOOR_ENTRY_ROUTE : p;
}

// route the GUI names -> address-bar path
export function doorRouteToUrl(route, { mapRootToNetget } = { mapRootToNetget: true }) {
  const p = clean(route);
  return mapRootToNetget !== false && p === DOOR_ENTRY_ROUTE ? '/' : p;
}
