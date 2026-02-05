import { useState, useRef, useEffect } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Box,
  Button // Add Button import
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import { useNavigate } from "react-router-dom";

const NetGetAppBar = () => {
  const [anchorEl, setAnchorEl] = useState(null);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef();
  const navigate = useNavigate();

  // Handle Profile Menu Actions
  const handleProfileMenuOpen = (event) => {
    setAnchorEl(event.currentTarget);
    setShowProfileMenu(true);
  };

  const handleProfileMenuClose = async () => {
    setAnchorEl(null);
    setShowProfileMenu(false);

    try {
      await fetch("https://api.netget.site/logout", {
        method: "POST",
        credentials: "include" // Ensures the cookie is included in the request
      })
        .then(response => response.json())
        .then(data => {
          console.log(data.message);
          navigate("/"); // Navigate to home page
        })
        .catch(error => console.error("Error:", error));
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

      const handleLogout = () => {
        alert("Logging out...");
        handleProfileMenuClose();
      };

      useEffect(() => {
        if (!showProfileMenu) return;
        const handleClickOutside = (event) => {
          if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
            setShowProfileMenu(false);
          }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
          document.removeEventListener("mousedown", handleClickOutside);
        };
      }, [showProfileMenu]);

      return (
        <AppBar
          position="fixed"
          sx={{
            backgroundColor: "#333", // Dark gray
            boxShadow: "none",
            borderBottom: "1px solid #444", // Slightly lighter gray
            height: "64px",
            zIndex: 1201,
          }}
        >
          <Toolbar sx={{ display: "flex", justifyContent: "space-between", padding: "0 16px" }}>
            {/* Left Side - Menu Icon */}
            <IconButton edge="start" aria-label="menu" sx={{ color: "#ddd" }}>
              <MenuIcon />
            </IconButton>

            {/* Center - App Title */}
            <Typography variant="h6" sx={{ fontWeight: "bold", color: "#ddd" }}>
              Local NetGet
            </Typography>

            {/* Right Side - Profile Avatar and Networks Button */}
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Button
                color="inherit"
                onClick={() => navigate("/networks")}
                sx={{ marginRight: "16px" }}
              >
                Networks
              </Button>
              <IconButton onClick={handleProfileMenuOpen} color="inherit">
                <Avatar sx={{ bgcolor: "#444" }}>
                  <AccountCircleIcon />
                </Avatar>
              </IconButton>
            </Box>
          </Toolbar>

          {/* Profile Menu */}
          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleProfileMenuClose}>
            <MenuItem onClick={handleProfileMenuClose}>Profile</MenuItem>
            <MenuItem onClick={handleLogout}>Logout</MenuItem>
          </Menu>
        </AppBar>
      );
    };

    export default NetGetAppBar;
