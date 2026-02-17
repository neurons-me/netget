import { useState, useEffect } from "react";
import {
  Grid,
  Card,
  CardContent,
  Typography,
  Avatar,
  Box,
  CardActions,
  Button,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from "@mui/material";
import { useNavigate } from "react-router-dom";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";

const NetworkGrid = () => {
  const navigate = useNavigate();
  const [networks, setNetworks] = useState({});
  const [open, setOpen] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const storedNetworks = JSON.parse(localStorage.getItem("networks")) || { networks: {} };
    setNetworks(storedNetworks.networks);
  }, []);

  const handleClickOpen = (network) => {
    setSelectedNetwork(network);
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setUsername("");
    setPassword("");
  };

  // Check if the server is online
  const checkServerStatus = async (ip) => {
    try {
      const response = await fetch(`http://${ip}/healthcheck`, { method: "GET" });
      return response.ok;
    } catch (error) {
      console.error("Error checking server:", error);
      return false;
    }
  };

  // Function to authenticate with the server
  const authenticateUser = async (ip, username, password) => {
    try {
      const response = await fetch(`http://${ip}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) throw new Error("Incorrect credentials.");

      const data = await response.json();
      localStorage.setItem("token", data.token);
      return true;
    } catch (error) {
      console.error("Authentication error:", error);
      return false;
    }
  };

  // Login function with validation and authentication
  const handleLogin = async () => {
    const isOnline = await checkServerStatus(selectedNetwork.ip);
    if (!isOnline) {
      alert(`Server ${selectedNetwork.ip} is not online.`);
      handleClose();
      return;
    }

    const isAuthenticated = await authenticateUser(selectedNetwork.ip, username, password);
    if (!isAuthenticated) {
      alert("Authentication failed. Please check your credentials.");
      handleClose();
      return;
    }

    // Redirect after successful authentication
    navigate(`/networks/${encodeURIComponent(selectedNetwork.name)}/home`);
    handleClose();
  };

  return (
    <Box sx={{ px: 2, py: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography
          variant="h4"
          sx={{
            textAlign: "center",
            fontWeight: "bold",
            marginBottom: 3,
            color: "white",
          }}
        >
          NetGet Servers
        </Typography>
        <Box>
          <IconButton
            color="primary"
            onClick={() => navigate("/add-network")}
            sx={{ marginBottom: 3 }}
          >
            <AddIcon />
          </IconButton>
          {Object.keys(networks).length > 0 && (
            <IconButton
              color="secondary"
              onClick={() => navigate("/delete-network")}
              sx={{ marginBottom: 3, marginLeft: 1 }}
            >
              <DeleteIcon />
            </IconButton>
          )}
        </Box>
      </Box>
      <Grid container spacing={1.5} justifyContent="center">
        {Object.entries(networks).map(([key, value]) => (
          <Grid item xs={6} sm={4} md={3} lg={2.5} key={key}>
            <Card
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                p: 1.5,
                textAlign: "center",
                boxShadow: 2,
                borderRadius: 2,
                transition: "transform 0.3s ease, box-shadow 0.3s ease",
                "&:hover": {
                  transform: "scale(1.05)",
                  boxShadow: 6,
                },
              }}
            >
              <Avatar alt={`${key} Profile`} sx={{ width: 60, height: 60, mb: 1 }} />
              <CardContent sx={{ p: 0 }}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    fontWeight: "bold",
                    fontSize: "0.9rem",
                    textOverflow: "ellipsis",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {key}
                </Typography>
                <Typography variant="body2" sx={{ color: "gray", fontSize: "0.8rem" }}>
                  {value.ip}
                </Typography>
                <Typography variant="body2" sx={{ color: "gray", fontSize: "0.8rem" }}>
                  {value.owner}
                </Typography>
              </CardContent>
              <CardActions sx={{ justifyContent: "center", mt: 1 }}>
                <Button
                  variant="outlined"
                  color="primary"
                  size="small"
                  onClick={() => handleClickOpen(value)}
                >
                  Login
                </Button>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Dialog open={open} onClose={handleClose}>
        <DialogTitle>Login</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Username"
            type="text"
            fullWidth
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            margin="dense"
            label="Password"
            type="password"
            fullWidth
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="secondary">
            Cancel
          </Button>
          <Button onClick={handleLogin} color="primary">
            Login
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default NetworkGrid;
