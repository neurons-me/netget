// src/themes/theme.js
import { createTheme } from '@mui/material/styles';

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#0c343d',
    },
    secondary: {
      main: '#f50057',
    },
    icon: {
      main: '#6d6d6d', // Color sutil para los íconos en modo claro
    },
    background: {
      default: '#f4f6f8',
      paper: '#ffffff',
      nav: '#ffffff'
    },
  },
  typography: {
    fontFamily: 'Roboto, sans-serif',
    pxToRem: (size) => `${size / 16}rem`,
  },
});

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#90caf9',
    },
    secondary: {
      main: '#f48fb1',
    },
    icon: {
      main: '#b0b0b0', // Color más claro para los íconos en modo oscuro
    },
    background: {
      default: '#121212',
      paper: '#1d1d1d',
      nav: 'black',
    },
  },
  typography: {
    fontFamily: 'Roboto, sans-serif',
    pxToRem: (size) => `${size / 16}rem`,
  },
});