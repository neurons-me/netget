import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-dom';
import { Layout, ThemeLauncher } from 'this.gui';
import WelcomeNetget from './pages/WelcomeMedia/WelcomeNetget.jsx';
import Home from './pages/Home.jsx';
import Logs from './pages/Logs.jsx';
import Domains from './pages/Domains.jsx';
import MediaPage from './pages/Media/MediaPage.jsx';
import TermsAndConditions from './components/Neurons/TermsAndConditions.jsx';
import PrivacyPolicy from './components/Neurons/PrivacyPolicy.jsx';

const navItems = [
  { label: 'Dashboard', icon: 'dashboard', to: '/home' },
  { label: 'Domains', icon: 'language', to: '/domains' },
  { label: 'Logs', icon: 'article', to: '/logs' },
];

function NetGetShell() {
  const { pathname } = useLocation();

  return (
    <Layout
      TopBar={false}
      LeftBar={{
        initialView: 'rail',
        header: { title: 'NetGet', icon: 'hub' },
        elements: navItems.map((item) => ({
          type: 'link',
          props: {
            ...item,
            active: pathname === item.to,
          },
        })),
        footerElements: [
          {
            type: 'action',
            props: {
              label: 'Theme',
              element: <ThemeLauncher />,
            },
          },
        ],
      }}
    >
      <Routes>
        <Route path="/home" element={<Home />} />
        <Route path="/domains" element={<Domains />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/terms-and-conditions" element={<MediaPage><TermsAndConditions /></MediaPage>} />
        <Route path="/privacy-policy" element={<MediaPage><PrivacyPolicy /></MediaPage>} />
      </Routes>
    </Layout>
  );
}

const App = () => (
  <Router>
    <Routes>
      <Route path="/" element={<WelcomeNetget />} />
      <Route path="/*" element={<NetGetShell />} />
    </Routes>
  </Router>
);

export default App;
