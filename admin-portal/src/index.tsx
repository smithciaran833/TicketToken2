import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Polyfill for Buffer (needed for Solana web3.js in browser)
import { Buffer } from 'buffer';
window.Buffer = Buffer;

// Create root element
const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

// Render app
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
