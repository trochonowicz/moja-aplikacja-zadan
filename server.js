require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// -- Baza danych
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// -- Ustawienia middleware
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());

// -- Serwowanie plików statycznych z katalogu 'public'
app.use(express.static(path.join(__dirname, 'public')));

// -- Konfiguracja Passport + Google OAuth2
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL,
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events']
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const userId = profile.id;
    const userEmail = profile.emails[0].value;
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

    if (result.rowCount === 0) {
      const initialData = {
        lists: [{ id: Date.now(), name: "Moje Zadania", tasks: [], sortMode: "manual" }],
        activeListId: "today"
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

    const user = { id: userId, email: userEmail, profile, accessToken, refreshToken };
    done(null, user);
  } catch (err) {
    done(err, null);
  }
}));

// -- Pomocnik autoryzacji
function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).send('Not authenticated');
}

// -- Auth routes
app.get('/auth/google', passport.authenticate('google', {
  scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
  accessType: 'offline', prompt: 'consent'
}));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => {
  res.redirect('/');
});
app.get('/auth/logout', (req, res, next) => req.logout(err => err ? next(err) : res.redirect('/')));

// -- API: status
app.get('/api/auth/status', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      loggedIn: true,
      user: { id: req.user.id, displayName: req.user.profile.displayName, email: req.user.email }
    });
  } else {
    res.json({ loggedIn: false });
  }
});

// -- API: pobieranie i zapis danych użytkownika
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

// -- API: synchronizacja z Google Calendar
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
      conferenceData: task.createMeetLink ? { createRequest: { requestId: uuidv4() } } : undefined
    };

    let result;
    if (task.googleCalendarEventId) {
      result = await calendar.events.update({ calendarId: 'primary', eventId: task.googleCalendarEventId, resource: event, sendUpdates: 'all', conferenceDataVersion: 1 });
    } else {
      result = await calendar.events.insert({ calendarId: 'primary', resource: event, sendUpdates: 'all', conferenceDataVersion: 1 });
    }

    res.json({ status: 'success', data: { ...result.data, action: task.googleCalendarEventId ? 'updated' : 'created' } });
  } catch (err) {
    console.error('Błąd API Kalendarza:', err);
    res.status(500).json({ message: 'Błąd API Kalendarza Google' });
  }
});

// -- Catch-all dla SPA (wysyłamy index.html z katalogu 'public')
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -- Uruchomienie serwera i inicjalizacja tabeli
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
    console.error("Błąd przy tworzeniu tabeli 'users':", err);
  }
});
