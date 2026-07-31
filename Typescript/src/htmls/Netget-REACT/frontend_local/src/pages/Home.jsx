// Home — local.netget dashboard
// Uses GatewayDashboard from netget.gui (resolved via Vite alias to ../../../../gui/src).
// GatewayDashboard fetches /gateway-identity and /apps, renders GatewayCard + MonadMesh.

import { Box } from "@mui/material";
import { GatewayDashboard } from "netget.gui/compounds";

const Home = () => (
  <Box sx={{ px: 3, py: 2, maxWidth: 1100, mx: "auto" }}>
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

export default Home;
