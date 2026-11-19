import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { RoomProvider } from './context/RoomContext.jsx';
import { LandingPage } from './pages/LandingPage.jsx';
import { HostDashboard } from './pages/HostDashboard.jsx';
import { RoomView } from './pages/RoomView.jsx';

export default function App() {
  return (
    <RoomProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/host" element={<HostDashboard />} />
          <Route path="/room/:roomCode" element={<RoomView />} />
        </Routes>
      </BrowserRouter>
    </RoomProvider>
  );
}
