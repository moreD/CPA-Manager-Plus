import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/global.scss';
import App from './App.tsx';
import { PublicUsagePage } from '@/features/client-usage/PublicUsagePage';

const isPublicUsage = window.location.pathname === '/usage.html';

document.title = isPublicUsage ? '用量查询' : 'CPA Manager Plus';
document.documentElement.setAttribute('translate', 'no');
document.documentElement.classList.add('notranslate');

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isPublicUsage ? <PublicUsagePage /> : <App />}</StrictMode>
);
