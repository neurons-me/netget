import React, { useState } from "react";
import StaticServerMenu from "./StaticServerMenu";
import NetGetAppBar from "./AppBar/NetGetAppBar";
import { Box } from "@mui/material";

const NetGetMainLayout = ({ children }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState(1);
  const drawerWidth = "25vw";

  return (
    <Box sx={{ display: "flex", height: "100vh", width: "100vw", background: "#181818" }}>
      <StaticServerMenu
        open={menuOpen}
        setOpen={setMenuOpen}
        selectedServerId={selectedServerId}
        onSelectServer={setSelectedServerId}
      />
      <Box 
        sx={{ 
          flex: 1, 
          display: "flex", 
          flexDirection: "column", 
          minWidth: 0,
          marginLeft: menuOpen ? drawerWidth : 0,
          width: menuOpen ? `calc(100% - ${drawerWidth})` : '100%',
          transition: 'margin 0.3s ease, width 0.3s ease',
        }}
      >
        <NetGetAppBar onMenuClick={() => setMenuOpen(!menuOpen)} />
        <Box sx={{ flex: 1, p: 3, overflow: "auto" }}>
          {/* Render children or server-specific content here */}
          {children ? children : (
            <Box sx={{ color: '#fff', fontSize: 24 }}>
              Selected Server ID: {selectedServerId}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default NetGetMainLayout;