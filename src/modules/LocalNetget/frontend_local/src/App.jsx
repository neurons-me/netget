// frontend/src/App.jsx
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import MediaPage from './pages/Media/MediaPage.jsx'; // Layout for most pages
import WelcomeNetget from './pages/WelcomeMedia/WelcomeNetget.jsx'; // Hero Section Page
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx'; // Terms
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx'; // Privacy
import NetworkGrid from './components/Network/NetworkGrid.jsx'; // Network Grid
import Home from './pages/Home.jsx'; // Home Page
import AddNetwork from './components/Network/AddNetwork.jsx'; // Add Network Component
import DeleteNetwork from './components/Network/DeleteNetwork.jsx'; // Delete Network Component

const App = () => {

  return (
      <Router>
      <Routes>
        {/* WelcomeMedia as a standalone page */}
        <Route path="/" element={<WelcomeNetget />} />
        <Route 
          path="/home"
          element={
              <Home />
          }
        />

        <Route
          path="/networks"
          element={
              <MediaPage>
                <NetworkGrid />
              </MediaPage>
          }
        />

        <Route
          path="/add-network"
          element={
              <MediaPage>
                <AddNetwork />
              </MediaPage>
          }
        />

        <Route
          path="/delete-network"
          element={
              <MediaPage>
                <DeleteNetwork />
              </MediaPage>
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