import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomThemeProvider } from './context/ThemeContext.jsx';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <CustomThemeProvider>
      <App />
    </CustomThemeProvider>
  </StrictMode>
);