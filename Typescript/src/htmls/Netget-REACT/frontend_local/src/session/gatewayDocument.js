// gatewayDocument.js -- what THIS app (netget's own admin front end) adds on top of the root GUI's
// document (GatewayAccessContract.md §7, doors migration step 3): its own pages and their left-bar
// entries, merged into the SAME document cleaker.me's own door already renders from, not a second
// application. Plain data, no JSX -- App.jsx pairs it with GATEWAY_PAGE_REGISTRY (the real components,
// which do need JSX) at render time; kept separate so this shape alone is importable by a plain test
// (tests/gatewayDoorEquivalence.test.ts) without a DOM or a JSX transform.
//
// `/netget` (status + claim) needs nothing here: it is already in the base document.
export const GATEWAY_DOCUMENT_EXTENSION = {
  GUI: {
    children: {
      bars: {
        children: {
          left: {
            children: {
              dashboard: { label: 'Dashboard', to: '/dashboard', icon: 'dashboard' },
              domains: { label: 'Domains', to: '/domains', icon: 'language' },
              logs: { label: 'Logs', to: '/logs', icon: 'article' },
            },
          },
        },
      },
      content: {
        children: {
          dashboard: {
            label: 'Dashboard', component: 'Dashboard', route: '/dashboard',
            note: 'Renders GatewayDashboard (netget.gui/compounds) — REST-polled (/gateway-identity, /apps), no kernel binding.',
          },
          domains: {
            label: 'Domains', component: 'Domains', route: '/domains',
            note: 'Domain routing CRUD — REST-backed (fetch to /domains, /add-domain, /delete-domain, /provision-cert), no kernel binding.',
          },
          logs: {
            label: 'Logs', component: 'Logs', route: '/logs',
            note: 'Nginx log viewer — REST-backed (fetch to /logs), optional client-side auto-refresh, no kernel binding.',
          },
          termsAndConditions: { component: 'TermsAndConditions', route: '/terms-and-conditions' },
          privacyPolicy: { component: 'PrivacyPolicy', route: '/privacy-policy' },
        },
      },
    },
  },
};
