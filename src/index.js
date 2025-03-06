// index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import AppWrapper from './App.js';
import * as serviceWorkerRegistration from './serviceWorkerRegistration';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<AppWrapper />);

// 注册 service worker 以启用 PWA 功能
serviceWorkerRegistration.register();