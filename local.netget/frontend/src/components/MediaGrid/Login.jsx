import React, { useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
} from "@mui/material";
import { useNavigate } from "react-router-dom";

let route = "https://api.netget.site";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const navigate = useNavigate();
  
  const handleLogin = async () => {
    try {
        const response = await fetch(`${route}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ username, password }),
        });

        if (response.ok) {
          navigate("/networks");
        } else {
            setMessage("Server error: Empty response");
            
        }
    } catch (error) {
        setMessage("Error connecting to the server");
        console.error("Fetch request error", error);
    }
};

  return (
    <Box sx={{ px: 2, py: 2, display: "flex", justifyContent: "center" }}>
      <Card
        sx={{
          width: 300,
          p: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          boxShadow: 2,
          borderRadius: 2,
        }}
      >
        <Typography
          variant="h5"
          sx={{
            textAlign: "center",
            fontWeight: "bold",
            marginBottom: 3,
            color: "white",
          }}
        >
          Login
        </Typography>
        <CardContent sx={{ width: "100%" }}>
          <TextField
            type = "text"
            label="Username"
            variant="outlined"
            fullWidth
            margin="normal"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            variant="outlined"
            fullWidth
            margin="normal"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </CardContent>
        <Button
          variant="contained"
          color="primary"
          onClick={handleLogin}
          sx={{ mt: 2 }}
        >
          Login
        </Button>
        <Typography variant="body1" sx={{ mt: 2, color: "red" }}>
          {message}  
        </Typography>
      </Card>
    </Box>
  );
};

export default Login;