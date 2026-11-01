// src/app/App.tsx
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from '../pages/LandingPage';
import DashboardPage from '../pages/DashboardPage';
import CreateSessionPage from '../pages/CreateSessionPage';
import JoinSessionPage from '../pages/JoinSessionPage';
import SessionOverviewPage from '../pages/SessionOverviewPage';
import NetworkPage from '../pages/NetworkPage';
import PlaygroundPage from '../pages/PlaygroundPage';
import HistoryPage from '../pages/HistoryPage';
import SettingsPage from '../pages/SettingsPage';

import Layout from '../components/Layout';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout><LandingPage /></Layout>} />
      <Route path="/dashboard" element={<Layout><DashboardPage /></Layout>} />
      <Route path="/sessions/create" element={<Layout><CreateSessionPage /></Layout>} />
      <Route path="/sessions/join" element={<Layout><JoinSessionPage /></Layout>} />
      <Route path="/sessions/:sessionId" element={<Layout><SessionOverviewPage /></Layout>} />
      <Route path="/network" element={<Layout><NetworkPage /></Layout>} />
      <Route path="/playground" element={<Layout><PlaygroundPage /></Layout>} />
      <Route path="/history" element={<Layout><HistoryPage /></Layout>} />
      <Route path="/history/:sessionId" element={<Layout><HistoryPage /></Layout>} />
      <Route path="/settings" element={<Layout><SettingsPage /></Layout>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
