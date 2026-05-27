import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import WelcomeNetget from './pages/WelcomeMedia/WelcomeNetget.jsx';
import Home from './pages/Home.jsx';
import Logs from './pages/Logs.jsx';
import MediaPage from './pages/Media/MediaPage.jsx';
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx';
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx';

const App = () => (
  <Router>
    <Routes>
      <Route path="/"     element={<WelcomeNetget />} />
      <Route path="/home" element={<Home />} />
      <Route path="/logs" element={<Logs />} />
      <Route path="/terms-and-conditions" element={<MediaPage><TermsAndConditions /></MediaPage>} />
      <Route path="/privacy-policy"       element={<MediaPage><PrivacyPolicy /></MediaPage>} />
    </Routes>
  </Router>
);

export default App;
