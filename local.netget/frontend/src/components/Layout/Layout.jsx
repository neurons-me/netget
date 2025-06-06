import React from "react";
import { Box } from "@mui/material";
import NeuronsAppBar from "../AppBar/NeuronsAppBar";
import Footer from "../Footer/Footer";

const Layout = ({ children }) => {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
        overflow: "hidden", // Ensure no extra scrollbars are added unnecessarily
      }}
    >
      <NeuronsAppBar />
      <Box
        sx={{
          flex: 1,
          overflowY: "auto", // Allows scrolling for long content
        }}
      >
        {children}
      </Box>
      <Footer />
    </Box>
  );
};

export default Layout;
