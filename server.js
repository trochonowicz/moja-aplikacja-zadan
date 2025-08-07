// server.js - Wersja z bazą danych PostgreSQL
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { Pool } = require('pg');
const { URLSearchParams } = require('url');

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

// --- MIDDLEWARE ---
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
    // POPRAWIONY: Zmieniono na pełny adres URL
    callbackURL: "https://moja-aplikacja-zadan.onrender.com/auth/google/callback",
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const userId = profile.id;

        let result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

        if (result.rowCount === 0) {
            const initialUserData = {
                lists: [{ id: Date.now(), name: "Moje Zadania", tasks: [], sortMode: "manual" }],
                activeListId: "today"
            };
            const userDataString = JSON.stringify(initialUserData);

            await pool.query('INSERT INTO users (id, data, access_token, refresh_token) VALUES ($1, $2, $3, $4)', 
                [userId, userDataString, accessToken, refreshToken]);
        } else {
            if (refreshToken) {
                await pool.query('UPDATE users SET access_token = $1, refresh_token = $2 WHERE id = $3', 
                    [accessToken, refreshToken, userId]);
            } else {
                await pool.query('UPDATE users SET access_token = $1 WHERE id = $2', 
                    [accessToken, userId]);
            }
        }
        
        const user = {
            id: userId,
            profile: profile,
            accessToken: accessToken,
            refreshToken: refreshToken
        };
        return done(null, user);

    } catch (error) {
        console.error("[Auth] Krytyczny błąd podczas operacji na bazie danych:", error);
        return done(error, null);
    }
}));

// --- ENDPOINTY ---
app.get('/auth/google', (req, res, next) => {
    passport.authenticate('google', {
        scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events']
    })(req, res, next);
});

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

// Użycie app.use() na górze pliku, aby poprawnie serwować pliki statyczne
app.use(express.static('public'));

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
        const result = await pool.query('SELECT data FROM users WHERE id = $1', [userId]);
        if (result.rowCount > 0) {
            res.json(result.rows[0].data);
        } else {
            res.status(404).json({ message: 'Dane użytkownika nie znalezione' });
        }
    } catch (error) {
        console.error('Błąd odczytu danych z bazy:', error);
        res.status(500).json({ message: 'Błąd serwera' });
    }
});

app.post('/api/data', isLoggedIn, async (req, res) => {
    try {
        const userId = req.user.id;
        const newUserData = req.body;
        await pool.query('UPDATE users SET data = $1 WHERE id = $2', [JSON.stringify(newUserData), userId]);
        res.status(200).json({ message: 'Dane zapisane pomyślnie' });
    } catch (error) {
        console.error('Błąd zapisu danych do bazy:', error);
        res.status(500).json({ message: 'Błąd serwera' });
    }
});

app.post('/api/sync', isLoggedIn, async (req, res) => {
    const { task } = req.body;
    const { accessToken, refreshToken } = req.user;
    if (!accessToken) {
        return res.status(401).json({ message: 'Brak tokena dostępu do API Google.' });
    }
    const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    // ... reszta kodu z oryginalnej funkcji app.post('/api/sync') pozostaje bez zmian
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

async function runPeriodicSync() {
    console.log("[Sync] Uruchamiam okresową synchronizację...");
    try {
        const dbResult = await pool.query('SELECT id, data, access_token, refresh_token, sync_token FROM users');
        const users = dbResult.rows;
        let wasAnythingUpdated = false;

        for (const user of users) {
            if (!user.refresh_token) {
                console.log(`[Sync] Pomijam użytkownika ${user.id}: brak refreshToken w bazie.`);
                continue;
            }

            console.log(`[Sync] Rozpoczynam synchronizację dla użytkownika: ${user.id}`);
            
            const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
            oauth2Client.setCredentials({
                access_token: user.access_token,
                refresh_token: user.refresh_token
            });
            
            oauth2Client.on('tokens', async (tokens) => {
                if (tokens.access_token) {
                    console.log(`[Sync] Odświeżono accessToken dla użytkownika ${user.id}.`);
                    await pool.query('UPDATE users SET access_token = $1 WHERE id = $2', [tokens.access_token, user.id]);
                }
            });

            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            
            let params;
            if (user.sync_token) {
                params = { calendarId: 'primary', syncToken: user.sync_token };
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

            try {
                const response = await calendar.events.list(params);
                const googleEvents = response.data.items;
                const userData = user.data;
                let wasUserUpdated = false;
                
                if (response.data.nextSyncToken) {
                    await pool.query('UPDATE users SET sync_token = $1 WHERE id = $2', [response.data.nextSyncToken, user.id]);
                    wasUserUpdated = true;
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

                    if (taskToUpdate) {
                        if (event.status === 'cancelled') {
                            console.log(`[Sync] Zadanie "${taskToUpdate.text}" usunięto z kalendarza.`);
                            taskToUpdate.googleCalendarEventId = null;
                            wasUserUpdated = true;
                        } else {
                            const newDueDateISO = event.start.dateTime || `${event.start.date}T00:00:00.000Z`;
                            const oldDateValue = taskToUpdate.dueDate ? new Date(taskToUpdate.dueDate).getTime() : null;
                            const newDateValue = new Date(newDueDateISO).getTime();

                            if (oldDateValue !== newDateValue || taskToUpdate.text !== event.summary) {
                                console.log(`[Sync] Aktualizuję zadanie "${taskToUpdate.text}". Nowa data: ${newDueDateISO}`);
                                taskToUpdate.dueDate = newDueDateISO;
                                taskToUpdate.text = event.summary || taskToUpdate.text;
                                wasUserUpdated = true;
                            }
                        }
                    }
                }
                
                if (wasUserUpdated) {
                    await pool.query('UPDATE users SET data = $1 WHERE id = $2', [JSON.stringify(userData), user.id]);
                    wasAnythingUpdated = true;
                    console.log(`[Sync] Wykryto zmiany dla użytkownika ${user.id}. Zmiany zostaną zapisane.`);
                }

            } catch (error) {
                if (error.code === 410) {
                    console.log(`[Sync] SyncToken dla użytkownika ${user.id} wygasł. Rozpoczynam pełną synchronizację.`);
                    await pool.query('UPDATE users SET sync_token = NULL WHERE id = $1', [user.id]);
                    // Możesz tu zaimplementować pełną resynchronizację lub zignorować i poczekać na kolejny cykl.
                }
                if (error.response && error.response.data && error.response.data.error === 'invalid_grant') {
                    console.error(`[Sync] Błąd autoryzacji dla ${user.id}. Token odświeżający jest nieprawidłowy.`);
                    await pool.query('UPDATE users SET refresh_token = NULL, access_token = NULL, sync_token = NULL WHERE id = $1', [user.id]);
                } else {
                    console.error(`[Sync] Błąd API Kalendarza dla użytkownika ${user.id}:`, error.message);
                }
            }
        }
        
        if (wasAnythingUpdated) {
            console.log("[Sync] Zmiany zostały zapisane w bazie danych.");
        } else {
            console.log("[Sync] Brak zmian do zapisania.");
        }
    } catch (error) {
        console.error('[Sync] Wystąpił błąd podczas cyklicznej synchronizacji:', error);
    }
}

// --- URUCHOMIENIE SERWERA ---
app.listen(PORT, async () => {
    console.log(`Serwer działa na http://localhost:${PORT}`);
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                data JSONB NOT NULL,
                access_token VARCHAR(255),
                refresh_token VARCHAR(255),
                sync_token VARCHAR(255)
            );
        `);
        console.log("Tabela 'users' sprawdzona/utworzona pomyślnie.");
    } catch (err) {
        console.error("Błąd podczas tworzenia tabeli 'users':", err);
    }
    const SYNC_INTERVAL_MS = 60 * 1000; // 1 minuta
    setTimeout(runPeriodicSync, 5000);
    setInterval(runPeriodicSync, SYNC_INTERVAL_MS);
});
