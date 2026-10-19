// Home — local.netget dashboard
// Gateway identity + the monad mesh (GatewayDashboard) and, under it, the host this gateway runs on (HostSurface).
// Uses GatewayDashboard from netget.gui (resolved via Vite alias to ../../../../gui/src).
// GatewayDashboard fetches /gateway-identity and /apps, renders GatewayCard + MonadMesh.

import { Box } from "@mui/material";
import { GatewayDashboard } from "netget.gui/compounds";
import { useRegisterGuiNode } from "this.gui";
import { HostSurface } from "this.gui/react";
import { netgetMonadTransportOrigin } from "../session/resolveNetgetSeed.js";

// GatewayDashboard's own internals (GatewayCard, MonadMesh) aren't
// registered here — it ships from the separate netget.gui package, not
// this.gui or this app's own source, so this only covers the boundary
// this page actually owns.
const Home = () => {
  useRegisterGuiNode("Home.dashboard", "GatewayDashboard");
  return (
    <Box
      data-gui-node-id="Home.dashboard"
      data-gui-component="GatewayDashboard"
      sx={{ px: 3, py: 2, maxWidth: 1100, mx: "auto" }}
    >
      <GatewayDashboard
        identityEndpoint="/gateway-identity"
        appsEndpoint="/apps"
        pollMs={5000}
        onMonadClick={(monad) => {
          // The registry names a monad `monad:<name>`; the door is /apps/<name>/ (the prefixed form is a 404).
          const name = String(monad.name || '').replace(/^monad:/, '');
          if (name) window.location.href = `/apps/${encodeURIComponent(name)}/`;
        }}
      />
      {/* The machine this gateway runs on: its resources and activity, as its own monad reports them (not verified by
          the mesh). It belongs to the gateway, not to the monad's page. */}
      <Box sx={{ mt: 4 }} data-gui-node-id="Home.host" data-gui-component="HostSurface">
        <HostSurface endpoint={netgetMonadTransportOrigin()} />
      </Box>
    </Box>
  );
};

export default Home;
