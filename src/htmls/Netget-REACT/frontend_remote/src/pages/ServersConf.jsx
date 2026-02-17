import React from "react";
import { Box, Card, CardContent, Typography } from "@mui/material";
import Footer from "../components/Footer/Footer.jsx";

const ServersConf = () => {
  return (
    <>
      <Box sx={{ px: 2, py: 2, display: "flex", justifyContent: "center" }}>
        <Card sx={{ width: "90%", p: 3, boxShadow: 2, borderRadius: 2 }}>
          <Typography variant="h5" sx={{ textAlign: "center", fontWeight: "bold", mb: 3 }}>
            Servers Configuration
          </Typography>
          <CardContent>
            <Typography variant="body1" sx={{ mb: 2 }}>
              Configure your servers here.
            </Typography>
            {/* Add server configuration form/content here */}
          </CardContent>
        </Card>
      </Box>
      <Footer />
    </>
  );
};

export default ServersConf;
