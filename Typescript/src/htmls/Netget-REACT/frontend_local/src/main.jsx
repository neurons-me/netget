import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomThemeProvider } from './context/ThemeContext.jsx';
import { Theme } from 'this.gui';
import 'this.gui/style.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Theme>
      <CustomThemeProvider>
        <App />
      </CustomThemeProvider>
    </Theme>
  </StrictMode>
);