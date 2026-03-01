import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import Home from './pages/Home';
import Login from './pages/Login';
import Signup from './pages/Signup'; 
import LiveVision from './pages/LiveVision';
import BeforeLogin from './pages/BeforeLogin';
import Profile from './pages/Profile';
import SavedLocations from './pages/SavedLocations';
import Navigation from './pages/Navigation'; // <-- 1. IMPORT ADDED HERE

// --- Helper Component to Protect Routes ---
// This checks if 'user' exists in localStorage. If not, it kicks them to login.
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const user = localStorage.getItem("user");
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path='/' element={<BeforeLogin/>}/>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />

        {/* Protected Routes (User must be logged in to see these) */}
        <Route path="/vision" element={<LiveVision />} />
        <Route path='/home' element={
          <ProtectedRoute><Home /></ProtectedRoute>
        } />
        <Route path='/profile' element={
          <ProtectedRoute><Profile /></ProtectedRoute>
        } />
        
        {/* ⚠️ NOTE: Your path is '/location' (singular) */}
        <Route path='/location' element={
          <ProtectedRoute><SavedLocations/></ProtectedRoute>
        }/>
        
        {/* 2. NEW NAVIGATION ROUTE ADDED HERE */}
        <Route path='/navigation' element={
          <ProtectedRoute><Navigation/></ProtectedRoute>
        }/>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);