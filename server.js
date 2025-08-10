require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSessionFactory = require('connect-pg-simple');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ====== DB ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ====== Sessions (Postgres store) ======
const PgSession = pgSessionFactory(session);
const sessionStore = new PgSession({
  pool,
  tableName: 'user_sessions',
  createTableIfMissing: true
});

app.set('trust proxy', 1);
app.use(express.json());

const cookieOptions = {
  secure: IS_PROD,
  httpOnly: true,
  sameSite: 'lax',     // top-level redirect z Google działa przy LAX
  maxAge: 30 * 24 * 60 * 60 * 1000,
  path: '/'
};

app.use(session({
  name: 'sid',
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'change-me',
  resave: false,
  saveUninitialized: false,
  cookie: cookieOptions
}));

app.use(passport.initialize());
app.use(passport.session());

// debug (po passport) — teraz pokaże true/false
app.use((req, res, next) => {
  console.log('[REQ]', req.method, req.url, 'sid=', req.sessionID, 'auth=', req.isAuthenticated());
  next();
});

// Statics
app.use(express.static(path.join(__dirname)));

// ====== Passport Google ======
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const userId = profile.id;
    const userEmail = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

    if (result.rowCount === 0) {
      const defaultListId = Date.now();
      const initialData = {
        lists: [{ id: defaultListId, name: "Moje Zadania", tasks: [], sortMode: "manual" }],
        activeListId: defaultListId
      };
      await pool.query(
        'INSERT INTO users (id, email, data, access_token, refresh_token) VALUES ($1, $2, $3, $4, $5)',
        [userId, userEmail, JSON.stringify(initialData), accessToken, refreshToken]
      );
    } else {
      await pool.query(
        'UPDATE users SET access_token = $1, refresh_token = $2 WHERE id = $3',
        [accessToken, refreshToken || result.rows[0].refresh_token, userId]
      );
    }
    done(null, { id: userId, email: userEmail, profile, accessToken, refreshToken });
  } catch (err) {
    done(err, null);
  }
}));

function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).send('Not authenticated');
}

app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
  accessType: 'offline',
  prompt: 'consent'
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => {
    req.session.save(() => res.redirect('/'));
  }
);

app.get('/auth/logout', (req, res, next) => {
  req.logout(err => err ? next(err) : res.redirect('/'));
});

// Debug endpoint
app.get('/debug/session', (req, res) => {
  res.json({
    sessionID: req.sessionID,
    isAuthenticated: req.isAuthenticated(),
    user: req.user || null,
    cookie: req.headers.cookie || null
  });
});

// ====== API ======
app.get('/api/auth/status', (req, res) => {
  res.json(req.isAuthenticated()
    ? { loggedIn: true, user: { id: req.user.id, displayName: req.user.profile.displayName, email: req.user.email } }
    : { loggedIn: false });
});

app.get('/api/data', isLoggedIn, async (req, res) => {
  try {
    const result = await pool.query('SELECT data FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length) res.json(result.rows[0].data);
    else res.status(404).json({ message: 'User data not found' });
  } catch (err) {
    res.status(500).json({ message: 'Błąd serwera przy pobieraniu danych' });
  }
});

app.post('/api/data', isLoggedIn, async (req, res) => {
  try {
    await pool.query('UPDATE users SET data = $1 WHERE id = $2', [JSON.stringify(req.body), req.user.id]);
    res.json({ message: 'Dane zapisane' });
  } catch (err) {
    res.status(500).json({ message: 'Błąd serwera przy zapisie danych' });
  }
});

app.post('/api/sync', isLoggedIn, async (req, res) => {
  const { task } = req.body;
  const { accessToken, refreshToken } = req.user;
  const oauth2 = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const calendar = google.calendar({ version: 'v3', auth: oauth2 });

  try {
    if (task.googleCalendarEventId && !task.dueDate) {
      await calendar.events.delete({ calendarId: 'primary', eventId: task.googleCalendarEventId, sendUpdates: 'all' });
      return res.json({ status: 'success', data: { action: 'deleted' } });
    }
    if (!task.dueDate) return res.json({ status: 'success', data: { action: 'none' } });

    const start = new Date(task.dueDate);
    const end = new Date(start.getTime() + ((task.duration || 30) * 60 * 1000));
    const event = {
      summary: task.text,
      description: task.notes || '',
      start: { dateTime: start.toISOString(), timeZone: 'Europe/Warsaw' },
      end:   { dateTime: end.toISOString(),   timeZone: 'Europe/Warsaw' },
      attendees: (task.attendees || []).map(email => ({ email })),
      conferenceData: task.createMeetLink ? { createRequest: { requestId: require('uuid').v4() } } : undefined
    };

    let result;
    if (task.googleCalendarEventId) {
      result = await calendar.events.update({
        calendarId: 'primary',
        eventId: task.googleCalendarEventId,
        resource: event,
        sendUpdates: 'all',
        conferenceDataVersion: 1
      });
    } else {
      result = await calendar.events.insert({
        calendarId: 'primary',
        resource: event,
        sendUpdates: 'all',
        conferenceDataVersion: 1
      });
    }
    res.json({ status: 'success', data: { ...result.data, action: task.googleCalendarEventId ? 'updated' : 'created' } });
  } catch (err) {
    res.status(500).json({ message: 'Błąd API Kalendarza Google' });
  }
});

// SPA catch-all
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, async () => {
  console.log(`Serwer działa na porcie ${PORT}`);
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255),
        data JSONB,
        access_token TEXT,
        refresh_token TEXT
      );
    `);
    console.log("Tabela 'users' gotowa.");
  } catch (err) {
    console.error("Błąd przy inicjalizacji bazy:", err);
  }
});
