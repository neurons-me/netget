// Home — local.netget dashboard
// Uses GatewayDashboard from netget.gui (resolved via Vite alias to ../../../../gui/src).
// GatewayDashboard fetches /gateway-identity and /apps, renders GatewayCard + MonadMesh.

import { Box } from "@mui/material";
import { GatewayDashboard } from "netget.gui/compounds";
import { useRegisterGuiNode } from "this.gui";

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
          window.location.href = `/monads/${monad.name}`;
        }}
      />
    </Box>
  );
};

export default Home;
