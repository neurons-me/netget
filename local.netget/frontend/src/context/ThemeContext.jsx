import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { lightTheme, darkTheme } from '../themes/theme';

const ThemeToggleContext = createContext();
export function useThemeToggle() {
  return useContext(ThemeToggleContext);
}

export function CustomThemeProvider({ children }) {
  // Set dark mode as default if localStorage is empty
  const storedTheme = localStorage.getItem('theme') || 'dark';
  const [isDarkMode, setIsDarkMode] = useState(storedTheme === 'dark');

  // Toggle theme and save the new preference to localStorage
  const toggleTheme = () => {
    setIsDarkMode((prev) => {
      const newTheme = !prev;
      localStorage.setItem('theme', newTheme ? 'dark' : 'light');
      return newTheme;
    });
  };

  const theme = useMemo(() => (isDarkMode ? darkTheme : lightTheme), [isDarkMode]);

  return (
    <ThemeToggleContext.Provider value={toggleTheme}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeToggleContext.Provider>
  );
}