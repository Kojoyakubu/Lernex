import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  CssBaseline,
  useTheme,
  Avatar,
  Divider,
  Tooltip,
  Menu,
  MenuItem,
  Badge,
  alpha,
} from '@mui/material';
import { styled } from '@mui/material/styles';

import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import SchoolIcon from '@mui/icons-material/School';
import GroupIcon from '@mui/icons-material/Group';
import QuizIcon from '@mui/icons-material/Quiz';
import BookIcon from '@mui/icons-material/Book';
import PersonIcon from '@mui/icons-material/Person';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsIcon from '@mui/icons-material/Notifications';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ArticleIcon from '@mui/icons-material/Article';
import FolderIcon from '@mui/icons-material/Folder';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import SettingsIcon from '@mui/icons-material/Settings';

// ═══════════════════════════════════════════════════════════
// 🎨 DESIGN CONSTANTS
// ═══════════════════════════════════════════════════════════

const DRAWER_WIDTH_EXPANDED = 240;
const DRAWER_WIDTH_COLLAPSED = 72;

// Outfit-inspired shell palette
const TOPBAR_BG = '#2E3A44';
const SIDEBAR_BG = '#2E3A44';
const ACCENT_COLOR = '#6F889D';
const CONTENT_BG = '#F4F1EA';

// ═══════════════════════════════════════════════════════════
// 🎨 STYLED COMPONENTS - NO ROUNDED CORNERS
// ═══════════════════════════════════════════════════════════

const StyledAppBar = styled(AppBar)(({ theme }) => ({
  background: TOPBAR_BG,
  boxShadow: 'none',
  borderBottom: `1px solid ${alpha('#ffffff', 0.08)}`,
  zIndex: theme.zIndex.drawer - 1, // ← FIXED: Below drawer, not above
}));

const StyledDrawerContent = styled(Box)(({ theme }) => ({
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: SIDEBAR_BG,
}));

const StyledNavItem = styled(ListItemButton)(({ theme, active }) => ({
  marginBottom: 6,
  marginLeft: 10,
  marginRight: 10,
  borderRadius: 0,
  minHeight: 48,
  paddingLeft: 12,
  paddingRight: 12,
  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
  color: active ? '#FFFFFF' : alpha('#FFFFFF', 0.85), // ← FIXED: Brighter (was 0.65)
  background: active 
    ? alpha(ACCENT_COLOR, 0.25)
    : 'transparent',
  borderLeft: active ? `4px solid ${ACCENT_COLOR}` : '4px solid transparent',
  
  '&:hover': {
    background: active 
      ? alpha(ACCENT_COLOR, 0.35)
      : alpha(ACCENT_COLOR, 0.15),
    transform: 'translateX(3px)',
    color: '#FFFFFF', // ← Always white on hover
    borderLeft: `4px solid ${alpha(ACCENT_COLOR, 0.7)}`, // ← FIXED: More visible (was 0.5)
  },
  
  '& .MuiListItemIcon-root': {
    color: 'inherit',
    minWidth: 40,
  },
  
  '& .MuiListItemText-primary': {
    fontWeight: active ? 700 : 500,
    fontSize: '0.9rem',
    letterSpacing: '0.01em',
    color: 'inherit', // ← FIXED: Inherit brighter color
  },
}));

// ═══════════════════════════════════════════════════════════
// 🎨 MAIN LAYOUT COMPONENT
// ═══════════════════════════════════════════════════════════

const Layout = ({ onLogout }) => {
  const theme = useTheme();
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);
  const openMenu = Boolean(anchorEl);

  const handleMenuOpen = (event) => setAnchorEl(event.currentTarget);
  const handleMenuClose = () => setAnchorEl(null);
  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleCollapse = () => setCollapsed(!collapsed);

  // ═══════════════════════════════════════════════════════════
  // 🎯 ROLE-BASED NAVIGATION
  // ═══════════════════════════════════════════════════════════

  const getMenuItems = () => {
    const role = user?.role?.toLowerCase();

    switch (role) {
      case 'admin':
        return [
          { text: 'Overview', icon: <DashboardIcon />, path: '/admin' },
          { text: 'Users', icon: <GroupIcon />, path: '/admin/users' }, // ← Real route now!
          { text: 'Schools', icon: <SchoolIcon />, path: '/admin/schools' }, // ← Real route now!
          { text: 'Curriculum', icon: <BookIcon />, path: '/admin/curriculum' }, // ← Real route now!
          { text: 'Analytics', icon: <AssessmentIcon />, path: '/admin/analytics' }, // ← Real route now!
        ];

      case 'teacher':
        return [
          { text: 'Home', icon: <DashboardIcon />, path: '/teacher/dashboard' },
          { text: 'Create New', icon: <ArticleIcon />, path: '/teacher/dashboard?tab=0' },
          { text: 'My Notes', icon: <BookIcon />, path: '/teacher/dashboard?tab=1' },
          { text: 'Drafts', icon: <FolderIcon />, path: '/teacher/dashboard?tab=2' },
          { text: 'Bundles', icon: <AssessmentIcon />, path: '/teacher/dashboard?tab=3' },
          { text: 'My Schemes', icon: <FolderIcon />, path: '/teacher/schemes' },
        ];

      case 'student':
      default:
        return [
          { text: 'Home', icon: <DashboardIcon />, path: '/dashboard' },
          { text: 'My Subjects', icon: <BookIcon />, path: '/dashboard' },
          { text: 'Resources', icon: <QuizIcon />, path: '/dashboard' },
          { text: 'Progress', icon: <AssessmentIcon />, path: '/dashboard' },
        ];
    }
  };

  const menuItems = getMenuItems();

  const getPageTitle = () => {
    const role = user?.role?.toLowerCase();
    const currentItem = menuItems.find(item => item.path === location.pathname);

    if (location.pathname === '/account/profile') return 'Profile';
    if (location.pathname === '/account/settings') return 'Settings';
    
    if (currentItem?.text) return currentItem.text;
    
    switch (role) {
      case 'admin': return 'Admin Dashboard';
      case 'teacher': return 'Teacher Dashboard';
      case 'student': return 'Student Dashboard';
      default: return 'Dashboard';
    }
  };

  const handleNavClick = (path) => {
    navigate(path);
    setMobileOpen(false);
  };

  // ═══════════════════════════════════════════════════════════
  // 🎨 DRAWER CONTENT
  // ═══════════════════════════════════════════════════════════

  const drawer = (
    <StyledDrawerContent>
      {/* Logo Section */}
      <Box
        sx={{
          px: collapsed ? 1.5 : 2.5,
          py: 3,
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-start',
          minHeight: 64,
          borderBottom: `1px solid ${alpha('#ffffff', 0.08)}`,
        }}
      >
        {!collapsed ? (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              px: 1.2,
              py: 0.8,
              borderRadius: 2,
              background: '#ffffff',
              border: `1px solid ${alpha('#ffffff', 0.3)}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
            }}
          >
            <Box
              component="img"
              src="/lernex1.png"
              alt="Lernex"
              sx={{
                width: 150,
                height: 'auto',
                display: 'block',
              }}
            />
          </Box>
        ) : (
          <Tooltip title="Lernex" placement="right">
            <Box
              sx={{
                width: 46,
                height: 46,
                borderRadius: 2,
                background: '#ffffff',
                border: `1px solid ${alpha('#ffffff', 0.3)}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Box
                component="img"
                src="/lernex2.png"
                alt="Lernex"
                sx={{
                  width: 36,
                  height: 36,
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </Box>
          </Tooltip>
        )}
      </Box>

      {/* Navigation Items */}
      <Box sx={{ flex: 1, overflowY: 'auto', py: 2.5 }}>
        <List component="nav">
          {menuItems.map((item, index) => {
            // Handle both exact paths and hash-based paths
            const itemPathBase = item.path.split('#')[0]; // Get path without hash
            const isActive = location.pathname === item.path || 
                           location.pathname === itemPathBase ||
                           (item.path !== '/dashboard' && 
                            item.path !== '/admin' && 
                            !item.path.includes('#') && 
                            location.pathname.startsWith(item.path));
            
            return (
              <StyledNavItem
                key={index}
                active={isActive ? 1 : 0}
                onClick={() => handleNavClick(item.path)}
              >
                <ListItemIcon>{item.icon}</ListItemIcon>
                <ListItemText 
                  primary={item.text}
                  sx={{ 
                    display: collapsed ? 'none' : 'block' // ← FIXED: Show/hide based on collapsed state
                  }}
                />
              </StyledNavItem>
            );
          })}
        </List>
      </Box>

      {/* Footer: User Info + Collapse Toggle */}
      <Box
        sx={{
          borderTop: `1px solid ${alpha('#ffffff', 0.08)}`,
          p: 1.5,
        }}
      >
        {/* User Section (when expanded) */}
        {!collapsed && (
          <Box
            sx={{
              p: 1.5,
              mb: 1.5,
              borderRadius: 0, // ← FIXED: No rounded corners
              background: alpha('#ffffff', 0.04),
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
            }}
          >
            <Avatar
              alt={user?.fullName || user?.name}
              src={user?.avatar}
              sx={{
                width: 36,
                height: 36,
                border: `2px solid ${alpha(ACCENT_COLOR, 0.5)}`,
              }}
            >
              {(user?.fullName || user?.name || 'U')[0].toUpperCase()}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography 
                variant="body2" 
                sx={{ 
                  fontWeight: 700, 
                  color: 'white',
                  fontSize: '0.85rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user?.fullName || user?.name}
              </Typography>
              <Typography 
                variant="caption" 
                sx={{ 
                  color: alpha('#ffffff', 0.5),
                  fontSize: '0.7rem',
                }}
              >
                {user?.role}
              </Typography>
            </Box>
          </Box>
        )}

        {/* Collapse Toggle - Desktop Only */}
        <Box sx={{ display: { xs: 'none', sm: 'block' } }}>
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="right">
            <IconButton
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={handleCollapse}
              sx={{
                width: '100%',
                borderRadius: 0, // ← FIXED: No rounded corners
                color: alpha('#ffffff', 0.7),
                background: alpha('#ffffff', 0.04),
                '&:hover': {
                  background: alpha('#ffffff', 0.08),
                  color: '#ffffff',
                },
              }}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </StyledDrawerContent>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />

      {/* ═══════════════════════════════════════════════════════════
          🎨 SIDEBAR - HIGHER Z-INDEX
          ═══════════════════════════════════════════════════════════*/}
      
      <Box
        component="nav"
        sx={{
          width: { sm: collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED },
          flexShrink: { sm: 0 },
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {/* Mobile Drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true,
          }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: 280,
              border: 'none',
            },
          }}
        >
          {drawer}
        </Drawer>

        {/* Desktop Drawer - PERMANENT */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': {
              boxSizing: 'border-box',
              width: collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED,
              border: 'none',
              transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>

      {/* ═══════════════════════════════════════════════════════════
          🎨 TOP BAR - LOWER Z-INDEX (behind sidebar)
          ═══════════════════════════════════════════════════════════*/}
      
      <StyledAppBar position="fixed">
        <Toolbar sx={{ minHeight: { xs: 56, sm: 64 } }}>
          {/* Mobile Menu Icon */}
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ 
              mr: 2, 
              display: { sm: 'none' },
              color: 'white',
            }}
          >
            <MenuIcon />
          </IconButton>

          {/* Page Title */}
          <Typography 
            variant="h6" 
            noWrap 
            component="div"
            sx={{ 
              flexGrow: 1,
              fontWeight: 800,
              fontSize: { xs: '1.1rem', sm: '1.3rem' },
              color: 'white',
              letterSpacing: '-0.02em',
              ml: { sm: `${collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED}px` }, // ← FIXED: Push right to avoid sidebar
              transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {getPageTitle()}
          </Typography>

          {/* Right Side Actions */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {/* Notifications */}
            <Tooltip title="Notifications">
              <IconButton
                aria-label="Open notifications"
                sx={{
                  color: 'white',
                  '&:hover': {
                    background: alpha('#ffffff', 0.1),
                  },
                }}
              >
                <Badge 
                  badgeContent={3} 
                  color="error"
                  sx={{
                    '& .MuiBadge-badge': {
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }
                  }}
                >
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            </Tooltip>

            {/* User Avatar & Menu */}
            <Tooltip title="Account settings">
              <IconButton aria-label="Open account menu" onClick={handleMenuOpen} sx={{ ml: 0.5 }}>
                <Avatar
                  alt={user?.fullName || user?.name}
                  src={user?.avatar}
                  sx={{
                    width: 38,
                    height: 38,
                    border: `2.5px solid ${ACCENT_COLOR}`,
                    boxShadow: `0 0 0 3px ${alpha(ACCENT_COLOR, 0.2)}`,
                  }}
                >
                  {(user?.fullName || user?.name || 'U')[0].toUpperCase()}
                </Avatar>
              </IconButton>
            </Tooltip>

            {/* Account Menu */}
            <Menu
              anchorEl={anchorEl}
              open={openMenu}
              onClose={handleMenuClose}
              PaperProps={{
                elevation: 0,
                sx: {
                  mt: 1.5,
                  borderRadius: 0, // ← FIXED: No rounded corners
                  minWidth: 220,
                  border: '1px solid #E5E7EB',
                  boxShadow: '0 10px 40px rgba(0,0,0,0.12)',
                },
              }}
              transformOrigin={{ horizontal: 'right', vertical: 'top' }}
              anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
            >
              <Box sx={{ px: 2.5, py: 2, borderBottom: '1px solid #F3F4F6' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.25 }}>
                  {user?.fullName || user?.name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.8rem' }}>
                  {user?.email}
                </Typography>
              </Box>
              
              <MenuItem
                onClick={() => {
                  handleMenuClose();
                  navigate('/account/profile');
                }}
                sx={{
                  borderRadius: 0, // ← FIXED: No rounded corners
                  mx: 0,
                  my: 0,
                  py: 1.25,
                  '&:hover': {
                    background: alpha(ACCENT_COLOR, 0.08),
                  },
                }}
              >
                <PersonIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} /> 
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Profile</Typography>
              </MenuItem>
              
              <MenuItem
                onClick={() => {
                  handleMenuClose();
                  navigate('/account/settings');
                }}
                sx={{
                  borderRadius: 0, // ← FIXED: No rounded corners
                  mx: 0,
                  my: 0,
                  py: 1.25,
                  '&:hover': {
                    background: alpha(ACCENT_COLOR, 0.08),
                  },
                }}
              >
                <SettingsIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} /> 
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Settings</Typography>
              </MenuItem>
              
              <Divider sx={{ my: 0 }} />
              
              <MenuItem
                onClick={() => {
                  handleMenuClose();
                  onLogout();
                }}
                sx={{
                  borderRadius: 0, // ← FIXED: No rounded corners
                  mx: 0,
                  my: 0,
                  py: 1.25,
                  color: theme.palette.error.main,
                  '&:hover': {
                    background: alpha(theme.palette.error.main, 0.08),
                  },
                }}
              >
                <LogoutIcon fontSize="small" sx={{ mr: 1.5 }} /> 
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Logout</Typography>
              </MenuItem>
            </Menu>
          </Box>
        </Toolbar>
      </StyledAppBar>

      {/* ═══════════════════════════════════════════════════════════
          🎨 MAIN CONTENT
          ═══════════════════════════════════════════════════════════*/}
      
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          p: { xs: 2, sm: 3 },
          width: {
            sm: `calc(100% - ${collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH_EXPANDED}px)`,
          },
          minHeight: '100vh',
          background: CONTENT_BG,
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          ml: { sm: 0 }, // No extra margin needed
        }}
      >
        {/* Toolbar Spacer */}
        <Toolbar sx={{ minHeight: { xs: 56, sm: 64 } }} />

        {/* Page Content */}
        <Box sx={{ mt: 2 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export default Layout;