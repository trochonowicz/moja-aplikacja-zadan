// server.js - Wersja finalna dla serwera Render
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

// --- KONFIGURACJA ---
const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Informujemy Express, aby ufał proxy serwisu Render (kluczowe dla sesji)
app.set('trust proxy', 1);

// --- MIDDLEWARE ---
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: 'auto', maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dni
}));
app.use(passport.initialize());
app.use(passport.session());

// Serwowanie plików statycznych (CSS, JS, itp.) z folderu 'public'
app.use(express.static(path.join(__dirname, 'public')));


// --- UWIERZYTELNIANIE PASSPORT.JS ---
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
            const initialUserData = {
                lists: [{ id: Date.now(), name: "Moje Zadania", tasks: [], sortMode: "manual" }],
                activeListId: "today"
            };
            await pool.query('INSERT INTO users (id, email, data, access_token, refresh_token) VALUES ($1, $2, $3, $4, $5)', 
                [userId, userEmail, JSON.stringify(initialUserData), accessToken, refreshToken]);
        } else {
            // Zawsze aktualizuj tokeny, zwłaszcza refreshToken, jeśli zostanie odświeżony
            await pool.query('UPDATE users SET access_token = $1, refresh_token = $2 WHERE id = $3', [accessToken, refreshToken || result.rows[0].refresh_token, userId]);
        }
        const user = { id: userId, email: userEmail, profile, accessToken, refreshToken };
        return done(null, user);
    } catch (error) {
        return done(error, null);
    }
}));

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).send('Not authenticated');
}

// --- ENDPOINTY APLIKACJI ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'], accessType: 'offline', prompt: 'consent' }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/auth/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

app.get('/api/auth/status', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            loggedIn: true,
            user: { id: req.user.id, displayName: req.user.profile.displayName, email: req.user.email }
        });
    } else { res.json({ loggedIn: false }); }
});

app.get('/api/data', isLoggedIn, async (req, res) => {
    try {
        const result = await pool.query('SELECT data FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length > 0) {
            res.json(result.rows[0].data);
        } else {
            res.status(404).json({ message: "User data not found" });
        }
    } catch (error) { res.status(500).json({ message: 'Błąd serwera przy pobieraniu danych' }); }
});

app.post('/api/data', isLoggedIn, async (req, res) => {
    try {
        await pool.query('UPDATE users SET data = $1 WHERE id = $2', [JSON.stringify(req.body), req.user.id]);
        res.status(200).json({ message: 'Dane zapisane' });
    } catch (error) { res.status(500).json({ message: 'Błąd serwera przy zapisie danych' }); }
});

app.post('/api/sync', isLoggedIn, async (req, res) => {
    const { task } = req.body;
    const { accessToken, refreshToken } = req.user;
    const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
        if (task.googleCalendarEventId && !task.dueDate) {
            await calendar.events.delete({ calendarId: 'primary', eventId: task.googleCalendarEventId, sendUpdates: 'all' });
            return res.json({ status: 'success', data: { action: 'deleted' } });
        }
        if (!task.dueDate) return res.json({ status: 'success', data: { action: 'none' } });
        
        const startDate = new Date(task.dueDate);
        const duration = task.duration || 60;
        const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
        const eventData = {
            summary: task.text,
            description: task.notes || '',
            start: { dateTime: startDate.toISOString(), timeZone: 'Europe/Warsaw' },
            end: { dateTime: endDate.toISOString(), timeZone: 'Europe/Warsaw' },
            attendees: (task.attendees || []).map(email => ({ email })),
            conferenceData: task.createMeetLink ? { createRequest: { requestId: uuidv4() } } : null,
        };
        let syncResult;
        if (task.googleCalendarEventId) {
            syncResult = await calendar.events.update({ calendarId: 'primary', eventId: task.googleCalendarEventId, resource: eventData, sendUpdates: 'all', conferenceDataVersion: 1 });
        } else {
            syncResult = await calendar.events.insert({ calendarId: 'primary', resource: eventData, sendUpdates: 'all', conferenceDataVersion: 1 });
        }
        res.json({ status: 'success', data: { ...syncResult.data, action: task.googleCalendarEventId ? 'updated' : 'created' } });
    } catch (error) {
        console.error("Błąd API Kalendarza:", error);
        res.status(500).json({ message: 'Błąd API Kalendarza Google' });
    }
});

// Serwowanie pliku index.html dla wszystkich pozostałych zapytań
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- URUCHOMIENIE SERWERA ---
app.listen(PORT, async () => {
    console.log(`Serwer działa na porcie ${PORT}`);
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id VARCHAR(255) PRIMARY KEY, email VARCHAR(255), data JSONB, access_token TEXT, refresh_token TEXT);`);
        console.log("Tabela 'users' gotowa.");
    } catch (err) {
        console.error("Błąd podczas tworzenia tabeli 'users':", err);
    }
});