// frontend/src/App.jsx

import { useState } from 'react';
import { Box } from '@mui/material';
import NetGetAppBar from './components/AppBar/NetGetAppBar.jsx';
import StaticServerMenu from './components/StaticServerMenu.jsx';
import { BrowserRouter as Router, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import MediaPage from './pages/Media/MediaPage.jsx'; // Layout for most pages
import WelcomeNetget from './pages/WelcomeMedia/WelcomeNetget.jsx'; // Hero Section Page
import Login from './components/MediaGrid/Login.jsx'; // Media Grid
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx'; // Terms
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx'; // Privacy
import NetworkGrid from './components/Network/NetworkGrid.jsx'; // Network Grid
import Home from './pages/Home.jsx'; // Home Page
import AddNetwork from './components/Network/AddNetwork.jsx'; // Add Network Component
import ProtectedRoute from './components/ProtectedRoutes.jsx'; // Protected Route Component
import DeleteNetwork from './components/Network/DeleteNetwork.jsx'; // Delete Network Component
import ServersConf from './pages/ServersConf.jsx'; // Servers Configuration Page

const AppContent = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState(1);
  const drawerWidth = "25vw";
  const location = useLocation();
  
  // Hide menu on root path
  const showMenu = location.pathname !== '/';

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', background: '#181818' }}>
      {showMenu && (
        <StaticServerMenu
          open={menuOpen}
          setOpen={setMenuOpen}
          selectedServerId={selectedServerId}
          onSelectServer={setSelectedServerId}
        />
      )}
      <Box 
        sx={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          minWidth: 0,
          marginLeft: (menuOpen && showMenu) ? drawerWidth : 0,
          width: (menuOpen && showMenu) ? `calc(100% - ${drawerWidth})` : '100%',
          transition: 'margin 0.3s ease, width 0.3s ease',
        }}
      >
        {showMenu && <NetGetAppBar onMenuClick={() => setMenuOpen(!menuOpen)} />}
        <Box sx={{ flex: 1, p: 0, overflow: 'auto' }}>
          <Routes>
            {/* WelcomeMedia as a standalone page */}
            <Route path="/" element={<WelcomeNetget />} />
            {/* Media Grid wrapped with MediaPage */}
            <Route
              path="/login"
              element={
                <MediaPage>
                  <Login />
                </MediaPage>
              }
            />
            <Route 
              path="/home"
              element={
                // <ProtectedRoute>
                  <Home />
                // </ProtectedRoute>
              }
            />
            <Route
              path="/networks"
              element={
                // <ProtectedRoute>
                  <MediaPage>
                    <NetworkGrid />
                  </MediaPage>
                // </ProtectedRoute>
              }
            />
            <Route
              path="/add-network"
              element={
                // <ProtectedRoute>
                  <MediaPage>
                    <AddNetwork />
                  </MediaPage>
                // </ProtectedRoute>
              }
            />
            <Route
              path="/delete-network"
              element={
                // <ProtectedRoute>
                  <MediaPage>
                    <DeleteNetwork />
                  </MediaPage>
                // </ProtectedRoute>
              }
            />
            <Route
              path="/servers-config"
              element={
                // <ProtectedRoute>
                  <ServersConf />
                // </ProtectedRoute>
              }
            />
            {/* Terms and Conditions wrapped with MediaPage */}
            <Route
              path="/terms-and-conditions"
              element={
                <MediaPage>
                  <TermsAndConditions />
                </MediaPage>
              }
            />
            {/* Privacy Policy wrapped with MediaPage */}
            <Route
              path="/privacy-policy"
              element={
                <MediaPage>
                  <PrivacyPolicy />
                </MediaPage>
              }
            />
            {/* Redirect example */}
            <Route
              path="/docs"
              element={<Navigate to="https://docs.neurons.me" replace />}
            />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
};

const App = () => {
  return (
    <Router>
      <AppContent />
    </Router>
  );
};

export default App;