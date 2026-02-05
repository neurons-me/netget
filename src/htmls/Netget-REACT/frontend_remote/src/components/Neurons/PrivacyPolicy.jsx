import React from "react";
import { Box, Typography, List, ListItem, ListItemText } from "@mui/material";

const PrivacyPolicy = () => {
  return (
    <Box
      sx={{
        maxWidth: "800px",
        margin: "0 auto",
        padding: 3,
        lineHeight: 1.8,
      }}
    >
      {/* Title */}
      <Typography
        variant="h4"
        sx={{
          fontWeight: 700,
          marginBottom: 3,
          color: "primary.main",
          textAlign: "center",
          fontFamily: "Roboto, sans-serif",
        }}
      >
        Terms and Conditions
      </Typography>

      {/* Last Updated */}
      <Typography
        variant="body2"
        sx={{
          marginBottom: 2,
          color: "text.secondary",
          textAlign: "center",
        }}
      >
        Last updated: January 05, 2025
      </Typography>

      {/* Sections */}
      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        1. Introduction
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        Welcome to neurons.me ("we", "our", or "us"). We respect the privacy of
        our users and are committed to protecting it through our compliance with
        this policy.
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        This policy describes:
      </Typography>
      <List sx={{ paddingLeft: 2 }}>
        <ListItem disableGutters>
          <ListItemText primary="The types of information we may collect or that you may provide when you visit our website neurons.me or use our services with any npm package or GitHub repo published by suiGn." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="Our practices for collecting, using, maintaining, protecting, and disclosing that information." />
        </ListItem>
      </List>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        2. Information We Collect About You
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        We collect several types of information, including:
      </Typography>
      <List sx={{ paddingLeft: 2 }}>
        <ListItem disableGutters>
          <ListItemText primary="Personal Data: Names, email addresses, and other information you provide." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="Usage Data: Information about how you use our website or services." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="Tracking & Cookies Data: We use cookies and similar tracking technologies to track activity on our service." />
        </ListItem>
      </List>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        3. How We Use Your Information
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        We use your information for various purposes, such as:
      </Typography>
      <List sx={{ paddingLeft: 2 }}>
        <ListItem disableGutters>
          <ListItemText primary="To provide and maintain our service." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="To notify you about changes to our service." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="To allow you to participate in interactive features of our service." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="To provide customer support." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="To gather analysis so that we can improve the service." />
        </ListItem>
      </List>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        4. Transfer of Data
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        Your information, including personal data, may be transferred to and
        maintained on computers located outside of your state, province, or
        country where data protection laws may differ.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        5. Disclosure of Your Information
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        We may disclose aggregated information about our users, and information
        that does not identify any individual, without restriction. We may
        disclose personal information:
      </Typography>
      <List sx={{ paddingLeft: 2 }}>
        <ListItem disableGutters>
          <ListItemText primary="To comply with any court order, law, or legal process." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="To enforce our terms of service and other agreements." />
        </ListItem>
        <ListItem disableGutters>
          <ListItemText primary="If we believe disclosure is necessary for the protection of our rights, your safety, or the safety of others." />
        </ListItem>
      </List>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        6. Cookies and Tracking
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        We use cookies and similar tracking technologies to track the activity
        on our service. Cookies are files with a small amount of data that can
        include an anonymous unique identifier.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        7. Your Choices
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        You may request that we delete any personal data we hold about you at
        any time. You may also request that we change any incorrect data or
        limit our use of your data.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        8. Changes to This Privacy Policy
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        We may update our privacy policy from time to time. We will notify you
        of any changes by posting the new privacy policy on this page.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        9. Contact Us
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        If you have any questions about this privacy policy, please contact us
        at:
      </Typography>
      <Typography variant="body2" sx={{ color: "primary.main" }}>
        Email: support@neurons.me
      </Typography>
    </Box>
  );
};

export default PrivacyPolicy;
