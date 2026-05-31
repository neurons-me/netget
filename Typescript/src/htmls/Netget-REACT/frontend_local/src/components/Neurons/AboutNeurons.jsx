import React from "react";
import { Box, Typography } from "@mui/material";
import DocsMenu from "../Docs/DocsMenu.jsx"; // Import the menu component

const AboutNeuronsMe = () => {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column", // Stack content and menu vertically
        gap: 4, // Add spacing between sections
        maxWidth: "1200px",
        margin: "0 auto",
        padding: 3,
      }}
    >
      {/* Intro Section */}
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column-reverse", md: "row" }, // Image moves to the top on mobile
          alignItems: { xs: "flex-start", md: "flex-start" }, // Normal alignment
          justifyContent: "space-between",
          gap: 3,
        }}
      >
        {/* Text Content */}
        <Box
          sx={{
            flex: 1,
            maxWidth: { xs: "100%", md: "55%" },
            textAlign: "justify", // Always normal alignment
          }}
        >
          <Typography
            variant="h4"
            gutterBottom
            sx={{
              fontWeight: 700,
              color: "primary.main",
              fontFamily: "Roboto, sans-serif",
              lineHeight: 1.6,
            }}
          >
            Get Started Developing<br />with <b>neurons.me</b>
          </Typography>

          <Typography
            variant="body1"
            sx={{
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "text.primary",
            }}
          >
            <b>neurons.me</b> simplifies the creation and management of neural networks
             while ensuring sovereignty over <b>data</b> and <b>algorithms</b>.

         
          </Typography>

          <Typography
            variant="body1"
            sx={{
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "text.primary",
              marginTop: "10px",
            }}
          >
            Prioritizing <b>privacy</b> and <b>autonomy</b>, it enables building AI solutions tailored to unique needs, free from centralized systems.

         Ensuring that the  orchestratation, control and ownership of
          the underlying data and computations remain with the user.
          </Typography>
        </Box>

        {/* Responsive Image */}
        <Box
          sx={{
            flex: 1,
            maxWidth: { xs: "80%", md: "40%" },
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start",
            marginBottom: { xs: 2, md: 0 },
          }}
        >
          <img
            src="/media/neurons-me.png" // Replace with your image path
            alt="neurons.me illustration"
            style={{
              width: "100%",
              maxWidth: "250px",
              height: "auto",
              borderRadius: "8px",
            }}
          />
        </Box>
      </Box>

      {/* Documentation Menu */}
      <Box>
        <DocsMenu /> {/* Add the menu component here */}
      </Box>
    </Box>
  );
};

export default AboutNeuronsMe;
