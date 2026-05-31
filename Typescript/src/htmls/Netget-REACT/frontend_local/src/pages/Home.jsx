// Home — local.netget dashboard
// Uses GatewayDashboard from netget.gui (resolved via Vite alias to ../../../../gui/src).
// GatewayDashboard fetches /gateway-identity and /apps, renders GatewayCard + MonadMesh.

import { Box, Typography } from "@mui/material";
import { GatewayDashboard } from "netget.gui/compounds";
import NetGetAppBar from "../components/AppBar/NetGetAppBar.jsx";
import Footer from "../components/Footer/Footer.jsx";

const Home = () => (
  <>
    <NetGetAppBar />
    <Box sx={{ px: 3, py: 2, mt: 9, maxWidth: 1100, mx: "auto" }}>
      <GatewayDashboard
        identityEndpoint="/gateway-identity"
        appsEndpoint="/apps"
        pollMs={5000}
        onMonadClick={(monad) => {
          window.location.href = `/monads/${monad.name}`;
        }}
      />
    </Box>
    <Footer />
  </>
);

export default Home;
