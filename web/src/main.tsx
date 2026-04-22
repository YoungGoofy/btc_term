import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import TrainingDashboard from './TrainingDashboard';
import './index.css';

function Router() {
  if (window.location.hash === '#training') {
    return <TrainingDashboard />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>
);