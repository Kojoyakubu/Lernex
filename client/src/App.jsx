// /client/src/App.jsx - UPDATED WITH ADMIN ROUTES
// ✅ LandingPage at root "/"
// ✅ Multiple auth options: /login, /register, /auth
// ✅ Layout wrapper for protected routes (sidebars work)
// ✅ QuizSeparated component for separated question types
// ✅ SelectClass route for student class selection
// ✅ NEW: All admin routes (Users, Schools, Curriculum, Analytics)

import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { logout } from './features/auth/authSlice';

// Layout Component (provides sidebar for protected routes)
import Layout from './components/Layout';

// Pages
import LandingPage from './pages/LandingPage';     // Marketing homepage
import AuthPortal from './pages/AuthPortal';        // Combined login/register
import Login from './pages/Login';                  // Separate login
import Register from './pages/Register';            // Separate register
import SocialAuthCallback from './pages/SocialAuthCallback';
import Dashboard from './pages/Dashboard';
import TeacherDashboard from './pages/TeacherDashboard';
import TeacherSchemes from './pages/TeacherSchemes';
import TeacherLessonAgent from './pages/TeacherLessonAgent';
import AdminDashboard from './pages/AdminDashboard';
import AdminUsers from './pages/AdminUsers';
import AdminSchools from './pages/AdminSchools';
import AdminCurriculum from './pages/AdminCurriculum';
import AdminAnalytics from './pages/AdminAnalytics';
import LessonNoteView from './pages/LessonNoteView';
import SelectClass from './pages/SelectClass';
import AccountProfile from './pages/AccountProfile';
import AccountSettings from './pages/AccountSettings';
import PricingPage from './pages/PricingPage';
import PaymentSuccess from './pages/PaymentSuccess';
import PaymentFailed from './pages/PaymentFailed';
import MyBadges from './pages/MyBadges';
import SchoolDashboard from './pages/SchoolDashboard';
import NotFound from './pages/NotFound';

import QuizSeparated from './components/QuizSeparated';

// Routes
import PrivateRoute from './components/PrivateRoute';
import RoleRoute from './components/RoleRoute';

const AppRoutes = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    const handleUnauthorized = () => {
      dispatch(logout()).finally(() => {
        navigate('/login', {
          replace: true,
          state: { sessionExpired: true },
        });
      });
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [dispatch, navigate]);

  // Logout handler for Layout component
  const handleLogout = () => {
    dispatch(logout()).finally(() => {
      navigate('/', { replace: true });
    });
  };

  return (
    <Routes>
        {/* ==========================================
            PUBLIC ROUTES (No Layout/Sidebar)
        ========================================== */}
        
        {/* Landing Page - Beautiful marketing homepage */}
        <Route path="/" element={<LandingPage />} />
        
        {/* Authentication Routes */}
        <Route path="/auth" element={<AuthPortal />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/auth/social/callback" element={<SocialAuthCallback />} />
        <Route path="/pricing" element={<PricingPage />} />

        {/* ==========================================
            PROTECTED ROUTES (With Layout/Sidebar)
        ========================================== */}
        <Route element={<Layout onLogout={handleLogout} />}>
          <Route element={<PrivateRoute />}>
            <Route path="/account/profile" element={<AccountProfile />} />
            <Route path="/account/settings" element={<AccountSettings />} />
              <Route path="/payment/success" element={<PaymentSuccess />} />
              <Route path="/payment/failed" element={<PaymentFailed />} />
            {/* Teacher Routes */}
            <Route element={<RoleRoute allowedRoles={['teacher']} />}>
              <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
              <Route path="/teacher/schemes" element={<TeacherSchemes />} />
              <Route path="/teacher/agent" element={<TeacherLessonAgent />} />
              <Route path="/teacher/notes/:id" element={<LessonNoteView />} />
            </Route>

            {/* School Admin Routes */}
            <Route element={<RoleRoute allowedRoles={['school_admin']} />}>
              <Route path="/school/dashboard" element={<SchoolDashboard />} />
            </Route>

            {/* ==========================================
                ADMIN ROUTES - ✅ ALL WORKING NOW!
            ========================================== */}
            <Route element={<RoleRoute allowedRoles={['admin']} />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/schools" element={<AdminSchools />} />
              <Route path="/admin/curriculum" element={<AdminCurriculum />} />
              <Route path="/admin/analytics" element={<AdminAnalytics />} />
            </Route>

            {/* Student Routes */}
            <Route element={<RoleRoute allowedRoles={['student']} />}>
              <Route path="/student/select-class" element={<SelectClass />} />
              <Route path="/student/dashboard" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/quiz/:id" element={<QuizSeparated />} />
              <Route path="/student/badges" element={<MyBadges />} />
            </Route>

          </Route>
        </Route>

        {/* 404 - catch all */}
        <Route path="*" element={<NotFound />} />
      </Routes>
  );
};

const App = () => (
  <Router>
    <AppRoutes />
  </Router>
);

export default App;