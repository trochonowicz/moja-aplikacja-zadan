// server.js - Wersja z bazą danych PostgreSQL i rozszerzoną synchronizacją Google Calendar
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
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const app = express();
const PORT = process.env.PORT || 3000;

// Konfiguracja puli połączeń do bazy danych
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ZMIENNA Z ID KALENDARZA
const CALENDAR_ID = 'primary'; // Używamy kalendarza głównego zalogowanego użytkownika

// --- MIDDLEWARE ---
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dni
}));
app.use(passport.initialize());
app.use(passport.session());

// --- UWIERZYTELNIANIE PASSPORT.JS ---
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google/callback",
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
    accessType: 'offline',
    prompt: 'consent'
}, async (accessToken, refreshToken, profile, done) => {
    console.log("--- Logowanie z GoogleStrategy ---");
    console.log("Profile ID:", profile.id);

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
            console.log(`[Auth] Nowy użytkownik ${userId} zapisany.`);
        } else {
            let query = 'UPDATE users SET access_token = $1, email = $3 WHERE id = $2';
            let values = [accessToken, userId, userEmail];
            if (refreshToken) {
                query = 'UPDATE users SET access_token = $1, refresh_token = $2, email = $4 WHERE id = $3';
                values = [accessToken, refreshToken, userId, userEmail];
                console.log(`[Auth] Zaktualizowano tokeny (w tym refresh) dla użytkownika ${userId}.`);
            } else {
                console.log(`[Auth] Zaktualizowano access token dla użytkownika ${userId}.`);
            }
            await pool.query(query, values);
        }

        const user = { id: userId, email: userEmail, profile, accessToken, refreshToken };
        return done(null, user);

    } catch (error) {
        console.error("[Auth] Błąd podczas operacji na bazie danych:", error);
        return done(error, null);
    }
}));

// --- ENDPOINTY APLIKACJI ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/');
}

// Trasy autoryzacji
app.get('/auth/google', passport.authenticate('google'));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/auth/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// API do sprawdzania statusu logowania
app.get('/api/auth/status', (req, res) => {
    if (req.isAuthenticated() && req.user && req.user.profile) {
        res.json({
            loggedIn: true,
            user: {
                id: req.user.id,
                displayName: req.user.profile.displayName,
                email: req.user.email
            }
        });
    } else {
        res.json({ loggedIn: false });
    }
});

// API do danych użytkownika
app.get('/api/data', isLoggedIn, async (req, res) => {
    try {
        const result = await pool.query('SELECT data FROM users WHERE id = $1', [req.user.id]);
        if (result.rowCount > 0) res.json(result.rows[0].data);
        else res.status(404).json({ message: 'Dane użytkownika nie znalezione' });
    } catch (error) {
        console.error('Błąd odczytu danych:', error);
        res.status(500).json({ message: 'Błąd serwera' });
    }
});

app.post('/api/data', isLoggedIn, async (req, res) => {
    try {
        await pool.query('UPDATE users SET data = $1 WHERE id = $2', [JSON.stringify(req.body), req.user.id]);
        res.status(200).json({ message: 'Dane zapisane pomyślnie' });
    } catch (error) {
        console.error('Błąd zapisu danych:', error);
        res.status(500).json({ message: 'Błąd serwera' });
    }
});

// API do synchronizacji z Google Calendar
app.post('/api/sync', isLoggedIn, async (req, res) => {
    const { task } = req.body;
    const { id: userId, accessToken, refreshToken } = req.user;

    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
        if (task.googleCalendarEventId && !task.dueDate) {
            await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: task.googleCalendarEventId, sendUpdates: 'all' });
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
            syncResult = await calendar.events.update({ calendarId: CALENDAR_ID, eventId: task.googleCalendarEventId, resource: eventData, sendUpdates: 'all', conferenceDataVersion: 1 });
        } else {
            syncResult = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: eventData, sendUpdates: 'all', conferenceDataVersion: 1 });
        }
        
        res.json({ status: 'success', data: { ...syncResult.data, action: task.googleCalendarEventId ? 'updated' : 'created' } });
    } catch (error) {
        console.error('Błąd API Kalendarza Google:', error.response ? error.response.data.error : error.message);
        res.status(500).json({ message: 'Błąd API Kalendarza Google' });
    }
});


// Główna trasa - serwuje plik index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- URUCHOMIENIE SERWERA ---
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
        console.error("Błąd podczas tworzenia tabeli 'users':", err);
    }
});