// dev.tsx — local dev sandbox for netget.gui
// Run: npm run dev
// Renders GatewayDashboard pointed at local.netget (requires nginx running)

import React from 'react';
import ReactDOM from 'react-dom/client';
import { Theme } from 'this.gui';
import { GatewayDashboard } from './compounds';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Theme initialMode="dark">
      <div style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
        <GatewayDashboard
          identityEndpoint="http://local.netget/gateway-identity"
          appsEndpoint="http://local.netget/apps"
          pollMs={5000}
        />
      </div>
    </Theme>
  </React.StrictMode>,
);
