// server.js - Wersja z poprawną obsługą plików statycznych
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

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: 'auto', maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());

// =================================================================
// KROK 1: Serwowanie plików statycznych (CSS, JS) z folderu 'public'
// =================================================================
app.use(express.static(path.join(__dirname, 'public')));


// --- UWIERZYTELNIANIE (bez zmian) ---
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
            await pool.query('UPDATE users SET access_token = $1, refresh_token = $2 WHERE id = $3', [accessToken, refreshToken, userId]);
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

// --- ENDPOINTY APLIKACJI (bez zmian) ---
app.get('/auth/google', passport.authenticate('google'));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/error.html' }), (req, res) => res.redirect('/'));
// ... (wszystkie endpointy /api/auth/status, /api/data, /api/sync pozostają takie same) ...

// =================================================================
// KROK 2: Serwowanie pliku index.html dla głównego adresu URL
// =================================================================
app.get('/', (req, res) => {
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