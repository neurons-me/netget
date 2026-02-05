import { useParams } from "react-router-dom";
import {
  Box,
  Typography,
  Avatar,
  Link,
  Grid,
  Card,
  List,
  ListItem,
} from "@mui/material";
import mediaData from "../../assets/media.json";

const MediaProfile = () => {
  const { name } = useParams();
  const media = mediaData.medias[name];

  if (!media) {
    return (
      <Box sx={{ px: 2, py: 2 }}>
        <Typography variant="h4" color="error" textAlign="center">
          Media profile not found.
        </Typography>
      </Box>
    );
  }

  // Dynamically fetch the profile picture from Facebook
  const facebookLink = media.Facebook
    ? Array.isArray(media.Facebook)
      ? media.Facebook[0]
      : media.Facebook
    : null;

  let profilePic = "/default-profile.png"; // Default image
  if (facebookLink && facebookLink.includes("facebook.com")) {
    const userId = facebookLink.split("/").slice(-2, -1)[0];
    profilePic = `https://graph.facebook.com/${userId}/picture?type=large`;
  }

  return (
    <Box sx={{ px: 2, py: 4, bgcolor: "background.default", minHeight: "100vh" }}>
      <Grid container spacing={4} sx={{ maxWidth: 1200, mx: "auto" }}>
        {/* Left: Profile Information */}
        <Grid item xs={12} md={4}>
          <Card
            elevation={0}
            sx={{
              p: 2,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              bgcolor: "transparent",
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                mb: 3,
              }}
            >
              <Avatar
                src={profilePic}
                alt={name}
                sx={{
                  width: 100,
                  height: 100,
                  mb: 2,
                  border: "2px solid",
                  borderColor: "divider",
                }}
              />
              <Typography
                variant="h5"
                sx={{ fontWeight: "bold", textAlign: "center", mb: 1 }}
              >
                {name}
              </Typography>
            </Box>

            <Typography
              variant="h6"
              sx={{
                fontWeight: "bold",
                textAlign: "left",
                mb: 2,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              Information
            </Typography>

            <List disablePadding>
              {Object.entries(media).map(([key, value]) => {
                if (!value) return null;

                const isArray = Array.isArray(value);
                const displayValue = isArray ? value : [value];

                return (
                  <ListItem
                    key={key}
                    sx={{
                      display: "block",
                      mb: 1,
                      "&:last-child": { mb: 0 },
                    }}
                  >
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: "bold", color: "text.secondary" }}
                    >
                      {key}
                    </Typography>
                    {displayValue.map((link, index) => (
                      <Link
                        key={index}
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        underline="none"
                        sx={{
                          display: "block",
                          color: "primary.main",
                          fontSize: "0.9rem",
                          textOverflow: "ellipsis",
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                          "&:hover": { textDecoration: "underline" },
                        }}
                      >
                        {link}
                      </Link>
                    ))}
                  </ListItem>
                );
              })}
            </List>
          </Card>
        </Grid>

        {/* Right: Posts Section */}
        <Grid item xs={12} md={8}>
          <Card
            elevation={0}
            sx={{
              p: 2,
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 2,
              bgcolor: "transparent",
            }}
          >
            <Typography
              variant="h6"
              sx={{
                fontWeight: "bold",
                textAlign: "left",
                mb: 2,
                borderBottom: "1px solid",
                borderColor: "divider",
              }}
            >
              Posts
            </Typography>

            <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {Array(5)
                .fill("")
                .map((_, index) => (
                  <Card
                    key={index}
                    elevation={0}
                    sx={{
                      p: 2,
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      bgcolor: "transparent",
                      "&:hover": { boxShadow: 6 },
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{ fontWeight: "bold", mb: 1 }}
                    >
                      Post Title {index + 1}
                    </Typography>
                    <Typography variant="body2">
                      This is the content for post {index + 1}. You can customize this area with images, text, or any other content.
                    </Typography>
                  </Card>
                ))}
            </Box>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default MediaProfile;