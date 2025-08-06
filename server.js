// server.js - Kompletna, ostateczna i działająca wersja
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');

// --- KONFIGURACJA ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'database.json');

// --- MIDDLEWARE ---
app.use(express.static('public'));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());

// --- UWIERZYTELNIANIE ---
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback",
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events']
}, async (accessToken, refreshToken, profile, done) => {
    // TA LINIJKA JEST NOWA:
    console.log('--- DIAGNOSTYKA TOKENÓW ---', { accessToken: !!accessToken, refreshToken: refreshToken });
    console.log("SUKCES! Otrzymano profil od Google:", profile.displayName);

    try {
        let db;
        // Krok 1: Spróbuj odczytać plik bazy danych.
        try {
            const dbRaw = await fs.readFile(DB_PATH, 'utf-8');
            db = JSON.parse(dbRaw);
        } catch (error) {
            // Krok 2: Jeśli plik nie istnieje (błąd ENOENT), stwórz nową, pustą strukturę bazy w pamięci.
            if (error.code === 'ENOENT') {
                console.log('[Auth] Plik database.json nie istnieje. Tworzę nową bazę danych.');
                db = { users: {} };
            } else {
                // Jeśli wystąpił inny, nieoczekiwany błąd odczytu, przerwij operację.
                throw error;
            }
        }

        // Krok 3: Kontynuuj standardową logikę, którą już mieliśmy.
        // Znajdź lub stwórz użytkownika w obiekcie 'db'.
        if (!db.users[profile.id]) {
            db.users[profile.id] = {
                lists: [{ id: Date.now(), name: "Moje Zadania", tasks: [], sortMode: "manual" }],
                activeListId: "today"
            };
        }

        // Zapisz/zaktualizuj tokeny.
        db.users[profile.id].accessToken = accessToken;
        if (refreshToken) {
            db.users[profile.id].refreshToken = refreshToken;
            console.log(`[Auth] Otrzymano i zapisano refreshToken dla użytkownika ${profile.id}`);
        }

        // Krok 4: Zapisz zmiany do pliku (lub stwórz nowy plik, jeśli go nie było).
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
        console.log(`[Auth] Dane użytkownika ${profile.id} zostały zapisane w bazie.`);

        const user = {
            id: profile.id,
            profile: profile,
            accessToken: accessToken
        };
        return done(null, user);

    } catch (error) {
        console.error("[Auth] Krytyczny błąd podczas operacji na bazie danych:", error);
        return done(error, null);
    }
}));

// --- ENDPOINTY ---
app.get('/auth/google', passport.authenticate('google', {
    access_type: 'offline',
    prompt: 'consent'
}));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/');
    }
);

app.get('/auth/logout', (req, res) => {
    req.logout(() => { res.redirect('/'); });
});

function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ message: 'Brak autoryzacji' });
}

app.get('/api/auth/status', (req, res) => {
    if (req.isAuthenticated() && req.user && req.user.profile) {
        const email = (req.user.profile.emails && req.user.profile.emails[0])
            ? req.user.profile.emails[0].value
            : 'Brak e-maila';
        res.json({
            loggedIn: true,
            user: {
                displayName: req.user.profile.displayName || 'Brak nazwy',
                email: email
            }
        });
    } else {
        res.json({ loggedIn: false });
    }
});

app.get('/api/data', isLoggedIn, async (req, res) => {
    try {
        const userId = req.user.id;
        const dbRaw = await fs.readFile(DB_PATH, 'utf-8');
        const db = JSON.parse(dbRaw);
        let userData = db.users[userId];
        if (!userData) {
            userData = {
                lists: [{ id: Date.now(), name: "Moje Zadania", tasks: [], sortMode: "manual" }],
                activeListId: "today"
            };
            db.users[userId] = userData;
            await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
        }
        res.json(userData);
    } catch (error) {
        console.error('Błąd odczytu bazy danych:', error);
        res.status(500).json({ message: 'Błąd serwera' });
    }
});

app.post('/api/data', isLoggedIn, async (req, res) => {
    try {
        const userId = req.user.id;
        const newUserData = req.body;
        const dbRaw = await fs.readFile(DB_PATH, 'utf-8');
        const db = JSON.parse(dbRaw);
        db.users[userId] = newUserData;
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
        res.status(200).json({ message: 'Dane zapisane pomyślnie' });
    } catch (error) {
        console.error('Błąd zapisu do bazy danych:', error);
        res.status(500).json({ message: 'Błąd serwera' });
    }
});

app.post('/api/sync', isLoggedIn, async (req, res) => {
    const { task } = req.body;
    const { accessToken } = req.user;
    if (!accessToken) {
        return res.status(401).json({ message: 'Brak tokena dostępu do API Google.' });
    }
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    try {
        if (task.googleCalendarEventId && !task.dueDate) {
            await calendar.events.delete({ calendarId: 'primary', eventId: task.googleCalendarEventId });
            return res.json({ status: 'success', data: { action: 'deleted' } });
        }
        if (!task.dueDate) {
            return res.json({ status: 'success', data: { action: 'none' } });
        }
        let start, end;
        const startDate = new Date(task.dueDate);
        const eventTimeZone = 'Europe/Warsaw';
        if (startDate.getUTCHours() === 0 && startDate.getUTCMinutes() === 0 && startDate.getUTCSeconds() === 0) {
            start = { date: startDate.toISOString().split('T')[0] };
            end = { date: new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] };
        } else {
            start = { dateTime: startDate.toISOString(), timeZone: eventTimeZone };
            end = { dateTime: new Date(startDate.getTime() + 60 * 60 * 1000).toISOString(), timeZone: eventTimeZone };
        }
        const eventData = { summary: task.text, description: task.notes || '', start, end };
        if (task.googleCalendarEventId) {
            const updatedEvent = await calendar.events.update({ calendarId: 'primary', eventId: task.googleCalendarEventId, resource: eventData });
            res.json({ status: 'success', data: { ...updatedEvent.data, action: 'updated' } });
        } else {
            const newEvent = await calendar.events.insert({ calendarId: 'primary', resource: eventData });
            res.json({ status: 'success', data: { ...newEvent.data, action: 'created' } });
        }
    } catch (error) {
        console.error('Błąd API Kalendarza Google:', error.message);
        res.status(500).json({ message: `Błąd API Kalendarza Google: ${error.message}` });
    }
});

// --- LOGIKA SYNCHRONIZACJI ZWROTNEJ ---
async function syncGoogleCalendarForUser(userId, db) {
    const userData = db.users[userId];
    
    if (!userData || !userData.refreshToken) {
        console.log(`[Sync] Pomijam użytkownika ${userId}: brak refreshToken w bazie.`);
        return false;
    }

    console.log(`[Sync] Rozpoczynam synchronizację dla użytkownika: ${userId}`);
    
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({
        access_token: userData.accessToken,
        refresh_token: userData.refreshToken
    });
    
    oauth2Client.on('tokens', (tokens) => {
        if (tokens.access_token) {
            console.log(`[Sync] Odświeżono accessToken dla użytkownika ${userId}.`);
            db.users[userId].accessToken = tokens.access_token;
        }
    });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    let wasAnyTaskUpdated = false;

    try {
        let params;
        if (userData.syncToken) {
            params = { calendarId: 'primary', syncToken: userData.syncToken };
        } else {
            const timeMin = new Date();
            timeMin.setDate(timeMin.getDate() - 30);
            params = {
                calendarId: 'primary',
                timeMin: timeMin.toISOString(),
                showDeleted: true,
                singleEvents: true
            };
        }

        const response = await calendar.events.list(params);
        const googleEvents = response.data.items;
        
        if (response.data.nextSyncToken) {
            db.users[userId].syncToken = response.data.nextSyncToken;
            wasAnyTaskUpdated = true;
        }

        for (const event of googleEvents) {
            const eventId = event.id;
            let taskToUpdate = null;
            for (const list of userData.lists) {
                const foundTask = list.tasks.find(t => t.googleCalendarEventId === eventId);
                if (foundTask) {
                    taskToUpdate = foundTask;
                    break;
                }
            }
            if (!taskToUpdate) continue;

            if (event.status === 'cancelled') {
                console.log(`[Sync] Zadanie "${taskToUpdate.text}" usunięto z kalendarza.`);
                taskToUpdate.googleCalendarEventId = null;
                wasAnyTaskUpdated = true;
            } else {
                const newDueDateISO = event.start.dateTime || `${event.start.date}T00:00:00.000Z`;
                const oldDateValue = taskToUpdate.dueDate ? new Date(taskToUpdate.dueDate).getTime() : null;
                const newDateValue = new Date(newDueDateISO).getTime();

                if (oldDateValue !== newDateValue || taskToUpdate.text !== event.summary) {
                    console.log(`[Sync] Aktualizuję zadanie "${taskToUpdate.text}". Nowa data: ${newDueDateISO}`);
                    taskToUpdate.dueDate = newDueDateISO;
                    taskToUpdate.text = event.summary || taskToUpdate.text;
                    wasAnyTaskUpdated = true;
                }
            }
        }
        
        if (wasAnyTaskUpdated) {
            console.log(`[Sync] Wykryto zmiany dla użytkownika ${userId}. Zmiany zostaną zapisane.`);
        }
        return wasAnyTaskUpdated;

    } catch (error) {
        if (error.code === 410) {
            console.log(`[Sync] SyncToken dla użytkownika ${userId} wygasł. Rozpoczynam pełną synchronizację.`);
            delete db.users[userId].syncToken;
            return syncGoogleCalendarForUser(userId, db);
        }
        if (error.response && error.response.data && error.response.data.error === 'invalid_grant') {
             console.error(`[Sync] Błąd autoryzacji dla ${userId}. Token odświeżający jest nieprawidłowy.`);
             delete db.users[userId].refreshToken;
             delete db.users[userId].accessToken;
             delete db.users[userId].syncToken;
             return true;
        }
        console.error(`[Sync] Błąd API Kalendarza dla użytkownika ${userId}:`, error.message);
        return false;
    }
}

// *** DODANA BRAKUJĄCA FUNKCJA ***
async function runPeriodicSync() {
    console.log("[Sync] Uruchamiam okresową synchronizację...");
    try {
        const dbRaw = await fs.readFile(DB_PATH, 'utf-8');
        const db = JSON.parse(dbRaw);
        let wasAnythingUpdated = false;
        
        for (const userId in db.users) {
            if (db.users.hasOwnProperty(userId)) {
                const userUpdated = await syncGoogleCalendarForUser(userId, db);
                if (userUpdated) {
                    wasAnythingUpdated = true;
                }
            }
        }

        if (wasAnythingUpdated) {
            console.log("[Sync] Zapisuję zmiany w bazie danych...");
            await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
        } else {
            console.log("[Sync] Brak zmian do zapisania.");
        }
    } catch (error) {
        console.error('[Sync] Wystąpił błąd podczas cyklicznej synchronizacji:', error);
    }
}

// --- URUCHOMIENIE SERWERA ---
app.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
  const SYNC_INTERVAL_MS = 60 * 1000; // 1 minuta
  setTimeout(runPeriodicSync, 5000); 
  setInterval(runPeriodicSync, SYNC_INTERVAL_MS);
});