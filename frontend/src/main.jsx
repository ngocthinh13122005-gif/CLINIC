import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { CssBaseline, ThemeProvider } from '@mui/material';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { store } from './store';
import { theme } from './theme';
import './styles/public.css';
import './styles/dashboard.css';
import './styles/booking.css';
import './styles/base.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline/>
        <BrowserRouter><AuthProvider><App/></AuthProvider></BrowserRouter>
      </ThemeProvider>
    </Provider>
  </React.StrictMode>
);
