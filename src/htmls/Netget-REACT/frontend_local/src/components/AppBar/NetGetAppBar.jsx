import { AppBar, Toolbar, Typography, Box, Button } from "@mui/material";
import { useNavigate } from "react-router-dom";

const NetGetAppBar = () => {
  const navigate = useNavigate();

  return (
    <AppBar
      position="fixed"
      sx={{
        backgroundColor: "#1a1a1a",
        boxShadow: "none",
        borderBottom: "1px solid #2c2c2c",
        height: "64px",
        zIndex: 1201,
      }}
    >
      <Toolbar sx={{ display: "flex", justifyContent: "space-between", px: 2 }}>
        <Typography
          variant="h6"
          sx={{ fontWeight: "bold", color: "#eee", cursor: "pointer", fontFamily: "monospace" }}
          onClick={() => navigate("/")}
        >
          local.netget
        </Typography>

        <Box sx={{ display: "flex", gap: 1 }}>
          <Button color="inherit" onClick={() => navigate("/home")} sx={{ color: "#bbb", textTransform: "none" }}>
            Gateway
          </Button>
          <Button color="inherit" onClick={() => navigate("/domains")} sx={{ color: "#bbb", textTransform: "none" }}>
            Domains
          </Button>
          <Button color="inherit" onClick={() => navigate("/logs")} sx={{ color: "#bbb", textTransform: "none" }}>
            Logs
          </Button>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default NetGetAppBar;
