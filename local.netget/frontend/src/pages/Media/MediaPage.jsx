import React from "react";
import { Box } from "@mui/material";
import NeuronsAppBar from "../../components/AppBar/NeuronsAppBar";
import Footer from "../../components/Footer/Footer";

const MediaPage = ({ children }) => {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100vh",
      }}
    >
      <NeuronsAppBar />
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          padding: 2,
        }}
      >
        {children}
      </Box>
      <Footer />
    </Box>
  );
};

export default MediaPage;