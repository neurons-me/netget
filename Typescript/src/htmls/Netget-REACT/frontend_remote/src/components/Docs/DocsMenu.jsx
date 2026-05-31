import React from "react";
import { Box, Grid, Typography, Card, CardActionArea, CardContent } from "@mui/material";

// Define menu items with images and explicit links
const menuItems = [
  {
    title: "All.This",
    description: "A collection of modular tools.",
    image: "/media/all.this.png", // Replace with the actual image path
    link: "/all-this", // Explicit link
  },
  {
    title: "i.mLearning",
    description: "Machine learning simplified.",
    image: "/media/mlearning.studio.png", // Replace with the actual image path
    link: "/i-mlearning", // Explicit link
  },
  {
    title: "neurons.me",
    description: "Framework for neural networks.",
    image: "/media/neurons.me.dev.png", // Replace with the actual image path
    link: "/neurons-me", // Explicit link
  },
  {
    title: "Cleaker",
    description: "Decentralized identity solutions.",
    image: "/media/cleaker.me.png", // Replace with the actual image path
    link: "/cleaker", // Explicit link
  },
  {
    title: "NetGet",
    description: "Secure connection manager.",
    image: "/media/netget.png", // Replace with the actual image path
    link: "/netget", // Explicit link
  },
];

const DocsMenu = () => {
  return (
    <Box
      sx={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: 3,
      }}
    >
      {/* Title */}
      <Typography
        variant="h4"
        sx={{
          fontWeight: 700,
          color: "primary.main",
          textAlign: "center", // Center-align title
          lineHeight: 1.3, // Adjust line height
          marginBottom: 4,
          fontFamily: "Roboto, sans-serif",
        }}
      >
        Explore Documentation
      </Typography>

      {/* Grid of Items */}
      <Grid container spacing={3}>
        {menuItems.map((item, index) => (
          <Grid
            item
            xs={12} // Full-width on extra small screens
            sm={6} // 2 per row on small screens
            md={4} // 3 per row on medium and up
            key={index}
          >
            <Card
              sx={{
                height: "100%",
                backgroundColor: "background.paper",
                boxShadow: 3,
                borderRadius: 2,
                "&:hover": {
                  boxShadow: 6,
                  transform: "translateY(-4px)",
                  transition: "0.3s ease-in-out",
                },
              }}
            >
              {/* Use explicit link */}
              <CardActionArea href={item.link}>
                <CardContent
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                    padding: 3,
                  }}
                >
                  {/* Add the image */}
                  <Box
                    component="img"
                    src={item.image}
                    alt={item.title}
                    sx={{
                      width: "100%",
                      maxWidth: "150px", // Standardized image size
                      height: "150px", // Fixed height for consistency
                      objectFit: "cover", // Ensures images are cropped appropriately
                      marginBottom: 2,
                      borderRadius: 2, // Optional rounded corners
                    }}
                  />

                  {/* Title */}
                  <Typography
                    variant="h6"
                    sx={{
                      fontWeight: 600,
                      color: "text.primary",
                      marginBottom: 1,
                    }}
                  >
                    {item.title}
                  </Typography>

                  {/* Description */}
                  <Typography
                    variant="body2"
                    sx={{
                      fontSize: "0.9rem",
                      color: "text.secondary",
                    }}
                  >
                    {item.description}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default DocsMenu;
