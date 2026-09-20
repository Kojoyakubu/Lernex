const asyncHandler = require('express-async-handler');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const axios = require('axios');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/userModel');
const Subscription = require('../models/subscriptionModel');
const {
  sendEmailVerification,
  sendPasswordReset,
  sendAccountLocked,
  generateSecureToken
} = require('../services/emailService');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const resolveJwtSecret = (primaryEnvKey, fallbackEnvKey) => {
  const primary = process.env[primaryEnvKey];
  if (primary) return primary;

  if (fallbackEnvKey && process.env[fallbackEnvKey]) {
    console.warn(`Missing ${primaryEnvKey}. Falling back to ${fallbackEnvKey}.`);
    return process.env[fallbackEnvKey];
  }

  throw new Error(`Server auth configuration error: missing ${primaryEnvKey}`);
};

// Utility: Generate Access Token (short-lived)
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      school: user.school,
      name: user.fullName,
      status: user.status,
    },
    resolveJwtSecret('JWT_SECRET'),
    { expiresIn: '1d' } // Access token valid for 1 day
  );
};

// Utility: Generate Refresh Token (long-lived)
const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      type: 'refresh'
    },
    resolveJwtSecret('JWT_REFRESH_SECRET', 'JWT_SECRET'),
    { expiresIn: '7d' } // Long-lived refresh token
  );
};

const normalizeRole = (role) => {
  return ['student', 'teacher', 'school_admin'].includes(role) ? role : 'student';
};

const findOrCreateSocialUser = async ({ email, fullName, role, emailVerified = false }) => {
  let user = await User.findOne({ email });

  if (!user) {
    const hashedPassword = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
    const userRole = normalizeRole(role);
    const userStatus = userRole === 'student' ? 'approved' : 'pending';

    user = await User.create({
      fullName,
      email,
      password: hashedPassword,
      role: userRole,
      status: userStatus,
      emailVerified,
    });
  }

  return user;
};

const issueSocialAuthResponse = async ({ user, res, mode = 'login', providerLabel = 'Social account' }) => {
  if (mode === 'register' && user.status === 'pending') {
    res.status(201).json({
      message: `Registration successful with ${providerLabel}. Your account is pending admin approval.`,
      needsApproval: true,
      user: {
        id: user._id,
        name: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
      },
    });
    return;
  }

  if (user.status === 'pending') {
    res.status(403).json({
      message: 'Your account is pending admin approval. Please wait for approval before logging in.',
      status: 'pending',
      needsApproval: true,
    });
    return;
  }

  if (user.status === 'suspended') {
    res.status(403).json({
      message: 'Your account has been suspended. Please contact an administrator.',
      status: 'suspended',
    });
    return;
  }

  if (user.isLocked) {
    res.status(423).json({
      message: 'Account is temporarily locked due to multiple failed login attempts. Please try again later.',
      locked: true,
      lockUntil: user.lockUntil,
    });
    return;
  }

  await user.resetLoginAttempts();

  if (user.twoFactorEnabled) {
    const tempToken = jwt.sign(
      { id: user._id, type: '2fa_temp' },
      process.env.JWT_2FA_SECRET || process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    res.json({
      message: `${providerLabel} verified. Please provide 2FA code.`,
      requires2FA: true,
      tempToken,
      user: {
        id: user._id,
        name: user.fullName,
        email: user.email,
        role: user.role,
      },
    });
    return;
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);
  user.refreshToken = refreshToken;
  await user.save();

  const subscription = await Subscription.findOne({ user: user._id, status: 'active' });

  res.status(200).json({
    message:
      user.createdAt && Date.now() - new Date(user.createdAt).getTime() < 10000
        ? `Registration successful with ${providerLabel}`
        : 'Login successful',
    user: {
      id: user._id,
      name: user.fullName,
      email: user.email,
      role: user.role,
      school: user.school,
      status: user.status,
      emailVerified: user.emailVerified,
      isSubscribed: !!subscription,
    },
    accessToken,
    refreshToken,
  });
};

const verifyGoogleToken = async (credential) => {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();

  const email = (payload?.email || '').toLowerCase();
  if (!email) {
    throw new Error('Google account did not provide an email');
  }

  return {
    email,
    fullName: payload?.name || 'Google User',
    emailVerified: !!payload?.email_verified,
    providerLabel: 'Google',
  };
};

const verifyFacebookToken = async (accessToken) => {
  const { data } = await axios.get('https://graph.facebook.com/me', {
    params: {
      fields: 'id,name,email',
      access_token: accessToken,
    },
  });

  const email = (data?.email || '').toLowerCase();
  if (!email) {
    throw new Error('Facebook account did not provide an email. Ensure email permission is granted.');
  }

  return {
    email,
    fullName: data?.name || 'Facebook User',
    emailVerified: true,
    providerLabel: 'Facebook',
  };
};

const verifyGithubToken = async (accessToken) => {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const { data: profile } = await axios.get('https://api.github.com/user', { headers });
  const { data: emails } = await axios.get('https://api.github.com/user/emails', { headers });

  const primary = Array.isArray(emails)
    ? emails.find((entry) => entry.primary && entry.verified) || emails.find((entry) => entry.verified)
    : null;
  const email = (primary?.email || profile?.email || '').toLowerCase();

  if (!email) {
    throw new Error('GitHub account did not provide a verified email.');
  }

  return {
    email,
    fullName: profile?.name || profile?.login || 'GitHub User',
    emailVerified: !!primary?.verified,
    providerLabel: 'GitHub',
  };
};

const verifyLinkedInToken = async (accessToken) => {
  const { data } = await axios.get('https://api.linkedin.com/v2/userinfo', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const email = (data?.email || '').toLowerCase();
  if (!email) {
    throw new Error('LinkedIn account did not provide an email.');
  }

  const fullName =
    data?.name ||
    `${data?.given_name || ''} ${data?.family_name || ''}`.trim() ||
    'LinkedIn User';

  return {
    email,
    fullName,
    emailVerified: true,
    providerLabel: 'LinkedIn',
  };
};

const verifyTiktokToken = async (accessToken, fallbackEmail) => {
  const { data } = await axios.get('https://open.tiktokapis.com/v2/user/info/', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      fields: 'open_id,display_name,username',
    },
  });

  const userInfo = data?.data?.user || {};
  const synthesizedEmail = userInfo.open_id ? `${userInfo.open_id}@tiktok.local` : '';
  const email = (fallbackEmail || synthesizedEmail || '').toLowerCase();

  if (!email) {
    throw new Error('Unable to derive TikTok email identity.');
  }

  return {
    email,
    fullName: userInfo.display_name || userInfo.username || 'TikTok User',
    emailVerified: false,
    providerLabel: 'TikTok',
  };
};

const verifyXToken = async (accessToken, fallbackEmail) => {
  const { data } = await axios.get('https://api.x.com/2/users/me', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    params: {
      'user.fields': 'name,username',
    },
  });

  const userData = data?.data || {};
  const synthesizedEmail = userData.id ? `${userData.id}@x.local` : '';
  const email = (fallbackEmail || synthesizedEmail || '').toLowerCase();

  if (!email) {
    throw new Error('Unable to derive X email identity.');
  }

  return {
    email,
    fullName: userData.name || userData.username || 'X User',
    emailVerified: false,
    providerLabel: 'X',
  };
};

const exchangeSocialCodeForAccessToken = async ({ provider, code, redirectUri, codeVerifier }) => {
  switch (provider) {
    case 'google': {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('Google OAuth is not configured on server');
      }

      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });

      if (codeVerifier) {
        body.append('code_verifier', codeVerifier);
      }

      const { data } = await axios.post('https://oauth2.googleapis.com/token', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      return data?.id_token;
    }
    case 'facebook': {
      const clientId = process.env.FACEBOOK_CLIENT_ID;
      const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('Facebook OAuth is not configured on server');
      }

      const { data } = await axios.get('https://graph.facebook.com/v19.0/oauth/access_token', {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          code,
        },
      });
      return data?.access_token;
    }
    case 'github': {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('GitHub OAuth is not configured on server');
      }

      const { data } = await axios.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        },
        { headers: { Accept: 'application/json' } }
      );
      return data?.access_token;
    }
    case 'linkedin': {
      const clientId = process.env.LINKEDIN_CLIENT_ID;
      const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('LinkedIn OAuth is not configured on server');
      }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      const { data } = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return data?.access_token;
    }
    case 'tiktok': {
      const clientId = process.env.TIKTOK_CLIENT_KEY;
      const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        throw new Error('TikTok OAuth is not configured on server');
      }

      const body = new URLSearchParams({
        client_key: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });

      const { data } = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      return data?.access_token;
    }
    case 'x': {
      const clientId = process.env.X_CLIENT_ID;
      if (!clientId) {
        throw new Error('X OAuth is not configured on server');
      }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
      });

      if (codeVerifier) {
        body.append('code_verifier', codeVerifier);
      }

      const { data } = await axios.post('https://api.x.com/2/oauth2/token', body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      return data?.access_token;
    }
    default:
      throw new Error(`Unsupported provider for code exchange: ${provider}`);
  }
};

// @desc    Register a new user
// @route   POST /api/users/register
// @access  Public
const registerUser = asyncHandler(async (req, res) => {
  const { fullName, email, password, role, school } = req.body;

  console.log('📥 Registration request:', { fullName, email, role });

  // Check if user already exists
  const userExists = await User.findOne({ email });
  if (userExists) {
    res.status(400).json({ message: 'User already exists' });
    return;
  }

  // Hash password with higher salt rounds
  const hashedPassword = await bcrypt.hash(password, 12);

  // Generate email verification token
  const emailVerificationToken = generateSecureToken();
  const emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  // Determine status based on role
  const userRole = role || 'student';
  const userStatus = userRole === 'student' ? 'approved' : 'pending';

  const user = await User.create({
    fullName,
    email,
    password: hashedPassword,
    role: userRole,
    school: school || null,
    status: userStatus,
    emailVerificationToken,
    emailVerificationExpires,
  });

  if (user) {
    console.log('✅ User created:', user._id, 'Status:', user.status);

    // Send email verification
    try {
      await sendEmailVerification(email, emailVerificationToken);
      console.log('📧 Verification email sent to:', email);
    } catch (emailError) {
      console.error('❌ Failed to send verification email:', emailError);
      // Don't fail registration if email fails, but log it
    }

    // Different responses based on status
    if (user.status === 'pending') {
      res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account. Your account is also pending admin approval.',
        needsApproval: true,
        needsVerification: true,
        user: {
          id: user._id,
          name: user.fullName,
          email: user.email,
          role: user.role,
          status: user.status,
          emailVerified: false,
        },
      });
    } else {
      // Student - auto-approved
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken(user);

      // Save refresh token
      user.refreshToken = refreshToken;
      await user.save();

      res.status(201).json({
        message: 'Registration successful. Please check your email to verify your account.',
        needsVerification: true,
        user: {
          id: user._id,
          name: user.fullName,
          email: user.email,
          role: user.role,
          status: user.status,
          emailVerified: false,
        },
        accessToken,
        refreshToken,
      });
    }
  } else {
    res.status(400).json({ message: 'Invalid user data' });
  }
});

// @desc    Verify email
// @route   POST /api/users/verify-email
// @access  Public
const verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.body;

  if (!token) {
    res.status(400).json({ message: 'Verification token is required' });
    return;
  }

  const user = await User.findOne({
    emailVerificationToken: token,
    emailVerificationExpires: { $gt: Date.now() }
  });

  if (!user) {
    res.status(400).json({ message: 'Invalid or expired verification token' });
    return;
  }

  // Update user
  user.emailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();

  res.json({ message: 'Email verified successfully' });
});

// @desc    Login user
// @route   POST /api/users/login
// @access  Public
const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (user && (await bcrypt.compare(password, user.password))) {

    // Check if account is locked
    if (user.isLocked) {
      res.status(423).json({
        message: 'Account is temporarily locked due to multiple failed login attempts. Please try again later.',
        locked: true,
        lockUntil: user.lockUntil
      });
      return;
    }

    // Check status
    if (user.status === 'pending') {
      res.status(403).json({
        message: 'Your account is pending admin approval. Please wait for approval before logging in.',
        status: 'pending',
        needsApproval: true,
      });
      return;
    }

    if (user.status === 'suspended') {
      res.status(403).json({
        message: 'Your account has been suspended. Please contact an administrator.',
        status: 'suspended',
      });
      return;
    }

    // Reset login attempts on successful login
    await user.resetLoginAttempts();

    // Check if 2FA is enabled
    if (user.twoFactorEnabled) {
      // Generate temporary token for 2FA verification
      const tempToken = jwt.sign(
        { id: user._id, type: '2fa_temp' },
        process.env.JWT_2FA_SECRET || process.env.JWT_SECRET,
        { expiresIn: '5m' } // 5 minutes to complete 2FA
      );

      res.json({
        message: 'Password verified. Please provide 2FA code.',
        requires2FA: true,
        tempToken,
        user: {
          id: user._id,
          name: user.fullName,
          email: user.email,
          role: user.role,
        },
      });
      return;
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    // Save refresh token
    user.refreshToken = refreshToken;
    await user.save();

    const subscription = await Subscription.findOne({ user: user._id, status: 'active' });

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.fullName,
        email: user.email,
        role: user.role,
        school: user.school,
        status: user.status,
        emailVerified: user.emailVerified,
        isSubscribed: !!subscription,
      },
      accessToken,
      refreshToken,
    });
  } else {
    // Handle failed login attempt
    if (user) {
      await user.incLoginAttempts();

      // Check if account just got locked
      const updatedUser = await User.findById(user._id);
      if (updatedUser.isLocked) {
        try {
          await sendAccountLocked(email);
        } catch (emailError) {
          console.error('Failed to send lockout email:', emailError);
        }
        res.status(423).json({
          message: 'Account locked due to multiple failed login attempts. Please try again in 2 hours.',
          locked: true
        });
        return;
      }
    }

    res.status(401).json({ message: 'Invalid email or password' });
  }
});

// @desc    Authenticate user with Google
// @route   POST /api/users/google-auth
// @access  Public
const googleAuth = asyncHandler(async (req, res) => {
  const { credential, role = 'student', mode = 'login' } = req.body;

  if (!credential) {
    res.status(400).json({ message: 'Google credential is required' });
    return;
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    res.status(500).json({ message: 'Google authentication is not configured' });
    return;
  }

  try {
    const socialProfile = await verifyGoogleToken(credential);
    const user = await findOrCreateSocialUser({
      email: socialProfile.email,
      fullName: socialProfile.fullName,
      role,
      emailVerified: socialProfile.emailVerified,
    });

    await issueSocialAuthResponse({
      user,
      res,
      mode,
      providerLabel: socialProfile.providerLabel,
    });
  } catch (error) {
    res.status(401).json({ message: error.message || 'Invalid Google token' });
    return;
  }
});

// @desc    Authenticate user with supported social providers
// @route   POST /api/users/social-auth
// @access  Public
const socialAuth = asyncHandler(async (req, res) => {
  const {
    provider,
    accessToken,
    credential,
    idToken,
    email,
    role = 'student',
    mode = 'login',
  } = req.body;

  if (!provider) {
    res.status(400).json({ message: 'Provider is required' });
    return;
  }

  const normalizedProvider = String(provider).toLowerCase();
  const supportedProviders = ['google', 'facebook', 'github', 'linkedin', 'tiktok', 'x'];
  if (!supportedProviders.includes(normalizedProvider)) {
    res.status(400).json({ message: `Unsupported provider: ${provider}` });
    return;
  }

  try {
    let socialProfile;

    switch (normalizedProvider) {
      case 'google': {
        const token = credential || idToken;
        if (!token) {
          res.status(400).json({ message: 'Google credential is required' });
          return;
        }

        if (!process.env.GOOGLE_CLIENT_ID) {
          res.status(500).json({ message: 'Google authentication is not configured' });
          return;
        }

        socialProfile = await verifyGoogleToken(token);
        break;
      }
      case 'facebook': {
        if (!accessToken) {
          res.status(400).json({ message: 'Facebook access token is required' });
          return;
        }
        socialProfile = await verifyFacebookToken(accessToken);
        break;
      }
      case 'github': {
        if (!accessToken) {
          res.status(400).json({ message: 'GitHub access token is required' });
          return;
        }
        socialProfile = await verifyGithubToken(accessToken);
        break;
      }
      case 'linkedin': {
        if (!accessToken) {
          res.status(400).json({ message: 'LinkedIn access token is required' });
          return;
        }
        socialProfile = await verifyLinkedInToken(accessToken);
        break;
      }
      case 'tiktok': {
        if (!accessToken) {
          res.status(400).json({ message: 'TikTok access token is required' });
          return;
        }
        socialProfile = await verifyTiktokToken(accessToken, email);
        break;
      }
      case 'x': {
        if (!accessToken) {
          res.status(400).json({ message: 'X access token is required' });
          return;
        }
        socialProfile = await verifyXToken(accessToken, email);
        break;
      }
      default:
        res.status(400).json({ message: 'Unsupported provider' });
        return;
    }

    const user = await findOrCreateSocialUser({
      email: socialProfile.email,
      fullName: socialProfile.fullName,
      role,
      emailVerified: socialProfile.emailVerified,
    });

    await issueSocialAuthResponse({
      user,
      res,
      mode,
      providerLabel: socialProfile.providerLabel,
    });
  } catch (error) {
    const statusCode = error.response?.status === 401 ? 401 : 400;
    const providerLabel = String(provider || 'social').toLowerCase();
    res.status(statusCode).json({
      message:
        error.response?.data?.error?.message ||
        error.message ||
        `Invalid ${providerLabel} token`,
    });
  }
});

// @desc    Exchange OAuth code and authenticate/register user
// @route   POST /api/users/social-auth/exchange
// @access  Public
const socialAuthExchange = asyncHandler(async (req, res) => {
  const {
    provider,
    code,
    redirectUri,
    codeVerifier,
    role = 'student',
    mode = 'login',
    email,
  } = req.body;

  if (!provider || !code || !redirectUri) {
    res.status(400).json({ message: 'provider, code, and redirectUri are required' });
    return;
  }

  const normalizedProvider = String(provider).toLowerCase();
  const supportedProviders = ['google', 'facebook', 'github', 'linkedin', 'tiktok', 'x'];
  if (!supportedProviders.includes(normalizedProvider)) {
    res.status(400).json({ message: `Unsupported provider for exchange: ${provider}` });
    return;
  }

  try {
    const exchangedAccessToken = await exchangeSocialCodeForAccessToken({
      provider: normalizedProvider,
      code,
      redirectUri,
      codeVerifier,
    });

    if (!exchangedAccessToken) {
      res.status(400).json({ message: `Failed to exchange ${provider} authorization code` });
      return;
    }

    let socialProfile;
    switch (normalizedProvider) {
      case 'google':
        socialProfile = await verifyGoogleToken(exchangedAccessToken);
        break;
      case 'facebook':
        socialProfile = await verifyFacebookToken(exchangedAccessToken);
        break;
      case 'github':
        socialProfile = await verifyGithubToken(exchangedAccessToken);
        break;
      case 'linkedin':
        socialProfile = await verifyLinkedInToken(exchangedAccessToken);
        break;
      case 'tiktok':
        socialProfile = await verifyTiktokToken(exchangedAccessToken, email);
        break;
      case 'x':
        socialProfile = await verifyXToken(exchangedAccessToken, email);
        break;
      default:
        res.status(400).json({ message: 'Unsupported provider' });
        return;
    }

    const user = await findOrCreateSocialUser({
      email: socialProfile.email,
      fullName: socialProfile.fullName,
      role,
      emailVerified: socialProfile.emailVerified,
    });

    await issueSocialAuthResponse({
      user,
      res,
      mode,
      providerLabel: socialProfile.providerLabel,
    });
  } catch (error) {
    res.status(400).json({
      message:
        error.response?.data?.error_description ||
        error.response?.data?.error?.message ||
        error.message ||
        `Failed to complete ${provider} authentication`,
    });
  }
});

// @desc    Refresh access token
// @route   POST /api/users/refresh-token
// @access  Public
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    res.status(401).json({ message: 'Refresh token is required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, resolveJwtSecret('JWT_REFRESH_SECRET', 'JWT_SECRET'));

    const user = await User.findById(decoded.id);

    if (!user || user.refreshToken !== token) {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    // Generate new access token
    const accessToken = generateAccessToken(user);

    res.json({ accessToken });
  } catch (error) {
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// @desc    Request password reset
// @route   POST /api/users/forgot-password
// @access  Public
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  const user = await User.findOne({ email });

  if (!user) {
    // Don't reveal if email exists or not for security
    res.json({ message: 'If an account with that email exists, a password reset link has been sent.' });
    return;
  }

  // Generate reset token
  const resetToken = generateSecureToken();
  user.passwordResetToken = resetToken;
  user.passwordResetExpires = Date.now() + 60 * 60 * 1000; // 1 hour
  await user.save();

  try {
    await sendPasswordReset(email, resetToken);
    res.json({ message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    res.status(500).json({ message: 'Failed to send password reset email' });
  }
});

// @desc    Reset password
// @route   POST /api/users/reset-password
// @access  Public
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;

  const user = await User.findOne({
    passwordResetToken: token,
    passwordResetExpires: { $gt: Date.now() }
  });

  if (!user) {
    res.status(400).json({ message: 'Invalid or expired reset token' });
    return;
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Update user
  user.password = hashedPassword;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.resetLoginAttempts(); // Reset any failed attempts
  await user.save();

  res.json({ message: 'Password reset successfully' });
});

// @desc    Logout user (invalidate refresh token)
// @route   POST /api/users/logout
// @access  Private
const logoutUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (user) {
    user.refreshToken = undefined;
    await user.save();
  }

  res.json({ message: 'Logged out successfully' });
});

// @desc    Enable 2FA for user
// @route   POST /api/users/enable-2fa
// @access  Private
const enable2FA = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  if (user.twoFactorEnabled) {
    res.status(400).json({ message: '2FA is already enabled' });
    return;
  }

  const secret = speakeasy.generateSecret({
    name: `Lernex (${user.email})`,
    issuer: 'Lernex'
  });

  user.twoFactorSecret = secret.base32;
  await user.save();

  const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

  res.json({
    message: '2FA setup initiated',
    secret: secret.base32,
    qrCode: qrCodeUrl,
    otpauth_url: secret.otpauth_url
  });
});

// @desc    Verify and enable 2FA
// @route   POST /api/users/verify-2fa
// @access  Private
const verify2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await User.findById(req.user.id);

  if (!user || !user.twoFactorSecret) {
    res.status(400).json({ message: '2FA setup not initiated' });
    return;
  }

  if (user.twoFactorEnabled) {
    res.status(400).json({ message: '2FA is already enabled' });
    return;
  }

  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token,
    window: 2
  });

  if (!verified) {
    res.status(400).json({ message: 'Invalid 2FA token' });
    return;
  }

  user.twoFactorEnabled = true;
  await user.save();

  res.json({ message: '2FA enabled successfully' });
});

// @desc    Disable 2FA
// @route   POST /api/users/disable-2fa
// @access  Private
const disable2FA = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const user = await User.findById(req.user.id);

  if (!user || !user.twoFactorEnabled) {
    res.status(400).json({ message: '2FA is not enabled' });
    return;
  }

  const verified = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: 'base32',
    token,
    window: 2
  });

  if (!verified) {
    res.status(400).json({ message: 'Invalid 2FA token' });
    return;
  }

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  await user.save();

  res.json({ message: '2FA disabled successfully' });
});

// @desc    Verify 2FA token during login
// @route   POST /api/users/verify-2fa-login
// @access  Public (requires tempToken from login)
const verify2FALogin = asyncHandler(async (req, res) => {
  const { token, tempToken } = req.body;

  if (!token || !tempToken) {
    res.status(400).json({ message: '2FA token and temporary token are required' });
    return;
  }

  try {
    const decoded = jwt.verify(tempToken, process.env.JWT_2FA_SECRET || process.env.JWT_SECRET);

    if (decoded.type !== '2fa_temp') {
      res.status(401).json({ message: 'Invalid temporary token' });
      return;
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      res.status(400).json({ message: '2FA is not enabled for this account' });
      return;
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 2,
    });

    if (!verified) {
      res.status(400).json({ message: 'Invalid 2FA token' });
      return;
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    user.refreshToken = refreshToken;
    await user.save();

    const subscription = await Subscription.findOne({ user: user._id, status: 'active' });

    res.json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.fullName,
        email: user.email,
        role: user.role,
        school: user.school,
        status: user.status,
        emailVerified: user.emailVerified,
        isSubscribed: !!subscription,
      },
      accessToken,
      refreshToken,
    });
  } catch (error) {
    res.status(401).json({ message: 'Invalid or expired temporary token' });
  }
});

// @desc    Get all users (Admin only)
const getAllUsers = asyncHandler(async (req, res) => {
  const users = await User.find().select('-password').sort({ createdAt: -1 });
  res.json(
    users.map((user) => ({
      id: user._id,
      name: user.fullName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      school: user.school,
      status: user.status,
      createdAt: user.createdAt,
    }))
  );
});

// @desc    Get pending users (need approval) - Admin only
// @route   GET /api/users/pending
// @access  Private/Admin
const getPendingUsers = asyncHandler(async (req, res) => {
  const pendingUsers = await User.find({ 
    status: 'pending',
  }).select('-password').sort({ createdAt: -1 });

  res.json({
    count: pendingUsers.length,
    users: pendingUsers.map(user => ({
      id: user._id,
      fullName: user.fullName,
      name: user.fullName,
      email: user.email,
      role: user.role,
      school: user.school,
      status: user.status,
      createdAt: user.createdAt,
    })),
  });
});

// @desc    Approve a user - Admin only
// @route   PATCH /api/users/approve/:id
// @access  Private/Admin
const approveUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  if (user.status === 'approved') {
    res.status(400).json({ message: 'User is already approved' });
    return;
  }

  user.status = 'approved';
  await user.save();

  console.log('✅ User approved:', user._id, 'by admin:', req.user.id);

  // TODO: Send email notification to user

  res.json({
    message: `User ${user.fullName} approved successfully`,
    user: {
      id: user._id,
      fullName: user.fullName,
      name: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  });
});

// @desc    Suspend a user - Admin only
// @route   PATCH /api/users/suspend/:id
// @access  Private/Admin
const suspendUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  user.status = 'suspended';
  await user.save();

  console.log('⚠️ User suspended:', user._id, 'by admin:', req.user.id);

  res.json({
    message: `User ${user.fullName} suspended successfully`,
    user: {
      id: user._id,
      fullName: user.fullName,
      name: user.fullName,
      email: user.email,
      role: user.role,
      status: user.status,
    },
  });
});

// @desc    Reject a user (delete) - Admin only
// @route   DELETE /api/users/reject/:id
// @access  Private/Admin
const rejectUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  if (user.status === 'approved') {
    res.status(400).json({ message: 'Cannot reject an approved user. Suspend them instead.' });
    return;
  }

  const userName = user.fullName;
  await user.deleteOne();

  console.log('❌ User rejected and deleted:', req.params.id);

  // TODO: Send email notification to user

  res.json({ message: `User ${userName} rejected and removed` });
});

// @desc    Get logged-in user profile
// @route   GET /api/users/profile
// @access  Private
const getUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id).select('-password');
  
  if (user) {
    const subscription = await Subscription.findOne({ user: user._id, status: 'active' });
    res.json({
      id: user._id,
      name: user.fullName,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      school: user.school,
      status: user.status,
      aiOnboarded: user.aiOnboarded,
      isSubscribed: !!subscription,
    });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

// @desc    Update logged-in user profile
// @route   PUT /api/users/profile
// @access  Private
const updateUserProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  // Update allowed fields
  if (req.body.fullName) user.fullName = req.body.fullName;
  if (req.body.email) user.email = req.body.email;
  if (req.body.aiOnboarded !== undefined) user.aiOnboarded = req.body.aiOnboarded;
  if (req.body.aiLastPromptUsed) user.aiLastPromptUsed = req.body.aiLastPromptUsed;
  
  if (req.body.password) {
    user.password = await bcrypt.hash(req.body.password, 12);
  }

  const updatedUser = await user.save();

  res.json({
    message: 'Profile updated successfully',
    user: {
      id: updatedUser._id,
      name: updatedUser.fullName,
      fullName: updatedUser.fullName,
      email: updatedUser.email,
      role: updatedUser.role,
      school: updatedUser.school,
      status: updatedUser.status,
      aiOnboarded: updatedUser.aiOnboarded,
      accessToken: generateAccessToken(updatedUser),
    },
  });
});

// @desc    Delete a user (Admin only)
// @route   DELETE /api/users/:id
// @access  Private/Admin
const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);

  if (!user) {
    res.status(404).json({ message: 'User not found' });
    return;
  }

  await user.deleteOne();
  res.json({ message: 'User deleted successfully' });
});

module.exports = {
  registerUser,
  googleAuth,
  socialAuth,
  socialAuthExchange,
  verifyEmail,
  loginUser,
  refreshToken,
  forgotPassword,
  resetPassword,
  logoutUser,
  enable2FA,
  verify2FA,
  disable2FA,
  verify2FALogin,
  getAllUsers,
  getPendingUsers,
  approveUser,
  suspendUser,
  rejectUser,
  getUserProfile,
  updateUserProfile,
  deleteUser,
};