import { useEffect, useMemo, useState } from 'react';
import { Router, parsePath } from 'react-router-dom';
import { doorUrlToRoute, doorRouteToUrl } from './doorRoutes.js';

// A router whose address bar and routes differ in the two paths doorRoutes.js maps. The GUI shell reuses an ambient
// router when it finds one (RouterProvider), so wrapping <Cleaker> here is enough; nothing inside is told.
function readLocation() {
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash };
}

export default function DoorRouter({ children }) {
  const [loc, setLoc] = useState(readLocation);
  useEffect(() => {
    const on = () => setLoc(readLocation());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  const navigator = useMemo(() => {
    const toUrl = (to) => {
      const t = typeof to === 'string' ? parsePath(to) : to || {};
      return `${doorRouteToUrl(t.pathname || '/')}${t.search || ''}${t.hash || ''}`;
    };
    return {
      createHref: toUrl,
      go: (n) => window.history.go(n),
      push: (to, state) => { window.history.pushState(state ?? null, '', toUrl(to)); setLoc(readLocation()); },
      replace: (to, state) => { window.history.replaceState(state ?? null, '', toUrl(to)); setLoc(readLocation()); },
    };
  }, []);
  const location = useMemo(
    () => ({ pathname: doorUrlToRoute(loc.pathname), search: loc.search, hash: loc.hash, state: window.history.state ?? null, key: 'door' }),
    [loc],
  );
  return <Router location={location} navigationType="POP" navigator={navigator}>{children}</Router>;
}
