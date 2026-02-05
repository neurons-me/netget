import React from "react";
import { Box, Typography, List, ListItem, ListItemText } from "@mui/material";

const TermsAndConditions = () => {
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
        Privacy Policy and Terms of Use
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
        Welcome to neurons.me and this.me suite, including all packages
        published under the suiGn profile in npm and GitHub. This project is
        provided "as-is" without any guarantees or warranties of any kind.
        Users are responsible for their use of the project and any consequences
        thereof.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        2. Information We Don't Collect
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        Given the nature of our open-source project, we do not collect, store,
        or handle personal data of our users. Users might provide data or
        personal information through the project's usage, but we do not have
        access to or control over this information.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        3. No Guarantees
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        Our open-source project is provided without warranty of any kind,
        either express or implied. We make no guarantees regarding the
        continuous functionality, accuracy, or security of the project.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        4. Non-liability
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        We are not responsible for any damages, data loss, or issues that may
        arise from the use of neurons.me or this.me. It's the user's
        responsibility to determine the suitability of this project for their
        needs.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        5. No Responsibility for User Actions
      </Typography>
      <Typography variant="body1" sx={{ marginBottom: 2 }}>
        Users are solely responsible for any actions they take based on the
        usage or implementation of this project. We hold no liability for any
        consequences or repercussions faced by users due to their actions or
        decisions related to the project.
      </Typography>

      <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
        6. Changes to This Privacy
Policy </Typography> <Typography variant="body1" sx={{ marginBottom: 2 }}> While our stance on user privacy is not expected to change, we may update this policy from time to time to clarify our position or to reflect new project features. Any changes will be posted on this page. </Typography>

php
Copy code
  <Typography variant="h6" sx={{ fontWeight: 600, marginTop: 3 }}>
    7. Contact
  </Typography>
  <Typography variant="body1" sx={{ marginBottom: 2 }}>
    Given the open-source nature of our project, we encourage community
    discussion and feedback. For questions about this privacy policy or the
    project in general, please refer to our contact section on the project's
    repository page or raise an issue in the project's issue tracker.
  </Typography>
</Box>
); };

export default TermsAndConditions;