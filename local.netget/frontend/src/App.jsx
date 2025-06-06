// frontend/src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import MediaPage from './pages/Media/MediaPage'; // Layout for most pages
import WelcomeNetget from './pages/WelcomeMedia/WelcomeNetget'; // Hero Section Page
import Login from './components/MediaGrid/Login'; // Media Grid
import TermsAndConditions from './components/Neurons/TermsAndConditions'; // Terms
import PrivacyPolicy from './components/Neurons/PrivacyPolicy'; // Privacy
import NetworkGrid from './components/Network/NetworkGrid'; // Network Grid
import Home from './pages/Home'; // Home Page
import AddNetwork from './components/Network/AddNetwork'; // Add Network Component
import ProtectedRoute from './components/ProtectedRoutes'; // Protected Route Component
import DeleteNetwork from './components/Network/DeleteNetwork'; // Delete Network Component

const App = () => {

  return (
      <Router>
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
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />

        <Route
          path="/networks"
          element={
            <ProtectedRoute>
              <MediaPage>
                <NetworkGrid />
              </MediaPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/add-network"
          element={
            <ProtectedRoute>
              <MediaPage>
                <AddNetwork />
              </MediaPage>
            </ProtectedRoute>
          }
        />

        <Route
          path="/delete-network"
          element={
            <ProtectedRoute>
              <MediaPage>
                <DeleteNetwork />
              </MediaPage>
            </ProtectedRoute>
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
    </Router>
  );
};

export default App;