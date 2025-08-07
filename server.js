// server.js - Wersja z bazą danych PostgreSQL i rozszerzoną synchronizacją Google Calendar
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid'); // Do generowania unikalnych ID dla żądań konferencji

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
const CALENDAR_ID = 'primary'; // Używamy kalendarza głównego użytkownika

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
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "https://moja-aplikacja-zadan.onrender.com/auth/google/callback",
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
    accessType: 'offline',
    prompt: 'consent'
}, async (accessToken, refreshToken, profile, done) => {
    console.log("--- Logowanie z GoogleStrategy ---");
    console.log("Profile ID:", profile.id);
    console.log("Access Token:", accessToken ? "Otrzymano" : "Brak");
    console.log("Refresh Token:", refreshToken ? "Otrzymano" : "Brak");
    console.log("---------------------------------");

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
            console.log(`[Auth] Nowy użytkownik ${userId} zapisany.`);
        } else {
            if (refreshToken) {
                await pool.query('UPDATE users SET access_token = $1, refresh_token = $2 WHERE id = $3',
                    [accessToken, refreshToken, userId]);
                console.log(`[Auth] Zaktualizowano tokeny dla użytkownika ${userId}. Zapisano refreshToken.`);
            } else {
                await pool.query('UPDATE users SET access_token = $1 WHERE id = $2',
                    [accessToken, userId]);
                console.log(`[Auth] Zaktualizowano accessToken dla użytkownika ${userId}.`);
            }
        }

        const user = {
            id: userId,
            email: profile.emails[0].value,
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
app.get('/auth/google',
    passport.authenticate('google', {
        scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar.events'],
        accessType: 'offline',
        prompt: 'consent'
    }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/' }),
    (req, res) => {
        res.redirect('/');
    }
);

app.get('/auth/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        res.redirect('/');
    });
});


function isLoggedIn(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ message: 'Brak autoryzacji' });
}

app.use(express.static(path.join(__dirname, 'public')));


app.get('/api/auth/status', (req, res) => {
    if (req.isAuthenticated() && req.user && req.user.profile) {
        const email = (req.user.profile.emails && req.user.profile.emails[0])
            ? req.user.profile.emails[0].value
            : 'Brak e-maila';
        res.json({
            loggedIn: true,
            user: {
                id: req.user.id,
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

// ZMODYFIKOWANY ENDPOINT /api/sync
app.post('/api/sync', isLoggedIn, async (req, res) => {
    const { task } = req.body;
    const userId = req.user.id;
    const userEmail = req.user.email;

    try {
        const dbResult = await pool.query('SELECT access_token, refresh_token FROM users WHERE id = $1', [userId]);
        if (dbResult.rowCount === 0) {
            return res.status(401).json({ message: 'Brak użytkownika w bazie.' });
        }
        const { access_token, refresh_token } = dbResult.rows[0];

        if (!access_token) {
            return res.status(401).json({ message: 'Brak tokena dostępu do API Google.' });
        }

        const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({ access_token, refresh_token });
        
        oauth2Client.on('tokens', async (tokens) => {
            if (tokens.access_token) {
                console.log(`[Sync] Odświeżono accessToken dla użytkownika ${userId}.`);
                await pool.query('UPDATE users SET access_token = $1 WHERE id = $2', [tokens.access_token, userId]);
            }
        });

        const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

        // Usunięcie wydarzenia
        if (task.googleCalendarEventId && !task.dueDate) {
            await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: task.googleCalendarEventId, sendUpdates: 'all' });
            return res.json({ status: 'success', data: { action: 'deleted' } });
        }

        // Brak daty = brak akcji
        if (!task.dueDate) {
            return res.json({ status: 'success', data: { action: 'none' } });
        }

        // Przygotowanie danych wydarzenia
        const eventTimeZone = 'Europe/Warsaw';
        const startDate = new Date(task.dueDate);
        const isAllDay = startDate.getUTCHours() === 0 && startDate.getUTCMinutes() === 0 && startDate.getUTCSeconds() === 0;

        let start, end;
        if (isAllDay) {
            start = { date: startDate.toISOString().split('T')[0] };
            end = { date: new Date(startDate.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] };
        } else {
            const duration = task.duration || 60; // Domyślny czas trwania: 60 min
            const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
            start = { dateTime: startDate.toISOString(), timeZone: eventTimeZone };
            end = { dateTime: endDate.toISOString(), timeZone: eventTimeZone };
        }

        const eventData = {
            summary: task.text,
            description: task.notes || '',
            start,
            end,
            attendees: (task.attendees || []).map(email => ({ email })),
            conferenceData: task.createMeetLink ? {
                createRequest: {
                    requestId: uuidv4(),
                    conferenceSolutionKey: { type: 'hangoutsMeet' }
                }
            } : null,
        };

        let syncResult;
        if (task.googleCalendarEventId) {
            syncResult = await calendar.events.update({
                calendarId: CALENDAR_ID,
                eventId: task.googleCalendarEventId,
                resource: eventData,
                sendUpdates: 'all'
            });
            console.log(`[Sync-Out] Zaktualizowano zadanie '${task.text}' w Google Calendar. EventId: ${task.googleCalendarEventId}`);
        } else {
            syncResult = await calendar.events.insert({
                calendarId: CALENDAR_ID,
                resource: eventData,
                conferenceDataVersion: 1,
                sendUpdates: 'all'
            });
            console.log(`[Sync-Out] Utworzono nowe zadanie '${task.text}' w Google Calendar. EventId: ${syncResult.data.id}`);
        }
        
        const updatedTaskData = {
            googleCalendarEventId: syncResult.data.id,
            meetLink: syncResult.data.hangoutLink || null
        };

        const userDataResult = await pool.query('SELECT data FROM users WHERE id = $1', [userId]);
        if (userDataResult.rowCount > 0) {
            const userData = userDataResult.rows[0].data;
            for (const list of userData.lists) {
                const taskToUpdate = list.tasks.find(t => t.id === task.id);
                if (taskToUpdate) {
                    taskToUpdate.googleCalendarEventId = updatedTaskData.googleCalendarEventId;
                    taskToUpdate.meetLink = updatedTaskData.meetLink;
                    break;
                }
            }
            await pool.query('UPDATE users SET data = $1 WHERE id = $2', [JSON.stringify(userData), userId]);
            console.log(`[Sync-Out] Zaktualizowano dane zadania '${task.text}' w bazie.`);
        }
        
        res.json({ 
            status: 'success', 
            data: { 
                ...syncResult.data, 
                action: task.googleCalendarEventId ? 'updated' : 'created' 
            }
        });

    } catch (error) {
        console.error('Błąd API Kalendarza Google:', error.response ? error.response.data : error.message);
        res.status(500).json({ message: `Błąd API Kalendarza Google: ${error.message}` });
    }
});


// ZMODYFIKOWANA FUNKCJA runPeriodicSync
async function runPeriodicSync() {
    console.log("[Sync] Uruchamiam okresową synchronizację...");
    try {
        const dbResult = await pool.query('SELECT id, data, access_token, refresh_token FROM users');
        const users = dbResult.rows;

        for (const user of users) {
            if (!user.refresh_token) {
                console.log(`[Sync] Pomijam użytkownika ${user.id}: brak refreshToken w bazie.`);
                continue;
            }

            console.log(`[Sync] Rozpoczynam synchronizację dla użytkownika: ${user.id}`);
            const oauth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
            oauth2Client.setCredentials({ access_token: user.access_token, refresh_token: user.refresh_token });

            oauth2Client.on('tokens', async (tokens) => {
                if (tokens.access_token) {
                    console.log(`[Sync] Odświeżono accessToken dla użytkownika ${user.id}.`);
                    await pool.query('UPDATE users SET access_token = $1 WHERE id = $2', [tokens.access_token, user.id]);
                }
            });

            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            const timeMin = new Date();
            timeMin.setDate(timeMin.getDate() - 30); 
            const params = { calendarId: CALENDAR_ID, timeMin: timeMin.toISOString(), showDeleted: true, singleEvents: true };

            try {
                const response = await calendar.events.list(params);
                const googleEvents = response.data.items;
                const userData = user.data;
                let wasUserUpdated = false;

                const allTasks = userData.lists.flatMap(list => list.tasks);

                for (const event of googleEvents) {
                    const eventId = event.id;
                    const taskToUpdate = allTasks.find(t => t.googleCalendarEventId === eventId);

                    if (taskToUpdate) {
                        let isChanged = false;
                        if (event.status === 'cancelled') {
                            console.log(`[Sync-In] Zadanie "${taskToUpdate.text}" usunięto z kalendarza.`);
                            taskToUpdate.googleCalendarEventId = null;
                            taskToUpdate.meetLink = null;
                            isChanged = true;
                        } else {
                            const newDueDateISO = event.start.dateTime || `${event.start.date}T00:00:00.000Z`;
                            const newAttendees = (event.attendees || []).map(a => a.email);
                            
                            if (new Date(taskToUpdate.dueDate).getTime() !== new Date(newDueDateISO).getTime()) {
                                taskToUpdate.dueDate = newDueDateISO; isChanged = true;
                            }
                            if (taskToUpdate.text !== (event.summary || taskToUpdate.text)) {
                                taskToUpdate.text = event.summary; isChanged = true;
                            }
                            if (taskToUpdate.meetLink !== (event.hangoutLink || null)) {
                                taskToUpdate.meetLink = event.hangoutLink || null; isChanged = true;
                            }
                            if (JSON.stringify(taskToUpdate.attendees || []) !== JSON.stringify(newAttendees)) {
                                taskToUpdate.attendees = newAttendees; isChanged = true;
                            }
                        }
                        if (isChanged) wasUserUpdated = true;
                    }
                }

                if (wasUserUpdated) {
                    await pool.query('UPDATE users SET data = $1 WHERE id = $2', [JSON.stringify(userData), user.id]);
                    console.log(`[Sync] Wykryto zmiany dla użytkownika ${user.id}. Zmiany zostały zapisane.`);
                } else {
                    console.log(`[Sync] Brak zmian do zapisania dla użytkownika ${user.id}.`);
                }

            } catch (error) {
                if (error.response && error.response.data && error.response.data.error === 'invalid_grant') {
                    console.error(`[Sync] Błąd autoryzacji dla ${user.id}. Token odświeżający jest nieprawidłowy.`);
                    await pool.query('UPDATE users SET refresh_token = NULL, access_token = NULL WHERE id = $1', [user.id]);
                } else {
                    console.error(`[Sync] Błąd API Kalendarza dla użytkownika ${user.id}:`, error.message);
                }
            }
        }
        console.log("[Sync] Synchronizacja zakończona.");
    } catch (error) {
        console.error('[Sync] Wystąpił błąd podczas cyklicznej synchronizacji:', error);
    }
}


// --- URUCHOMIENIE SERWERA ---
app.listen(PORT, async () => {
    console.log(`Serwer działa na porcie ${PORT}`);
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                data JSONB NOT NULL,
                access_token TEXT,
                refresh_token TEXT
            );
        `);
        console.log("Tabela 'users' sprawdzona/utworzona pomyślnie.");
    } catch (err) {
        console.error("Błąd podczas tworzenia tabeli 'users':", err);
    }
    const SYNC_INTERVAL_MS = 2 * 60 * 1000; // 2 minuty
    setTimeout(runPeriodicSync, 5000);
    setInterval(runPeriodicSync, SYNC_INTERVAL_MS);
});
