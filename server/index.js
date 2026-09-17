// /server/index.js
const path = require('path');
const express = require('express');
const dotenv = require('dotenv');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const colors = require('colors');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

// -----------------------------------------------------------------------------
// 🧠 Load environment + connect DB
// -----------------------------------------------------------------------------
dotenv.config();
connectDB();

const app = express();
app.set('trust proxy', 1); // Required for Render rate limits

// -----------------------------------------------------------------------------
// 🧱 Middleware
// -----------------------------------------------------------------------------
app.use(helmet());
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true }));

// -----------------------------------------------------------------------------
// ✅ FIXED CORS CONFIGURATION
// -----------------------------------------------------------------------------
const allowedOrigins = [
  'https://lernex.onrender.com', // deployed frontend
  'http://localhost:5173',                       // local dev (vite)
  'http://127.0.0.1:5173',                       // local alternative
  'http://localhost',                            // Capacitor Android/iOS webview
  'https://localhost',                           // Capacitor secure localhost webview
  'capacitor://localhost',                       // Capacitor custom scheme
  'ionic://localhost',                           // Ionic/Capacitor compatibility
];

const envAllowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const originAllowList = new Set([...allowedOrigins, ...envAllowedOrigins]);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow Postman or curl requests (no origin)
      if (!origin) return callback(null, true);
      if (originAllowList.has(origin)) {
        return callback(null, true);
      } else {
        console.log(`❌ CORS blocked: ${origin}`);
        return callback(new Error('CORS not allowed'), false);
      }
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  })
);

// -----------------------------------------------------------------------------
// 🗂 Static uploads
// -----------------------------------------------------------------------------
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// -----------------------------------------------------------------------------
// ⏳ Rate limiting
// -----------------------------------------------------------------------------
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  message: 'Too many requests, please try again later.',
});
app.use('/api', apiLimiter);

// Specific rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes for auth endpoints
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/users/login', authLimiter);
app.use('/api/users/register', authLimiter);
app.use('/api/users/forgot-password', authLimiter);

// -----------------------------------------------------------------------------
// 📦 Routes
// -----------------------------------------------------------------------------
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/teacher', require('./routes/teacherRoutes'));
app.use('/api/student', require('./routes/studentRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/school', require('./routes/schoolRoutes'));
app.use('/api/curriculum', require('./routes/curriculumRoutes'));
app.use('/api/schemes', require('./routes/schemeRoutes'));
app.use('/api/quizzes', require('./routes/quizRoutes'));
app.use('/api/ai', require('./routes/aiRoutes')); // ✅ AI routes

// -----------------------------------------------------------------------------
// 🩺 Health Check
// -----------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.status(200).json({
    message: `✅ Lernex API is live in ${process.env.NODE_ENV} mode.`,
    time: new Date().toISOString(),
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ ok: true, time: new Date().toISOString() });
});

// -----------------------------------------------------------------------------
// 🧩 Error Handling
// -----------------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

// -----------------------------------------------------------------------------
// 🚀 Start Server
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `✅ Server running in ${process.env.NODE_ENV} mode on port ${PORT}`.yellow.bold
  );
});

// -----------------------------------------------------------------------------
// 🧯 Handle Unhandled Rejections
// -----------------------------------------------------------------------------
process.on('unhandledRejection', (err) => {
  console.error(`❌ Unhandled Rejection: ${err.message}`.red.bold);
  server.close(() => process.exit(1));
});
