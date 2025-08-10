
document.addEventListener('DOMContentLoaded', () => {
    // Referencje do wszystkich elementów UI
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-container');
    const userDisplayNameEl = document.getElementById('user-display-name');
    const dropdownContainer = document.getElementById('custom-dropdown-container');
    const currentListTrigger = document.getElementById('current-list-trigger');
    const currentListName = document.getElementById('current-list-name');
    const taskListEl = document.getElementById('task-list');
    const newTaskInput = document.getElementById('new-task-input');
    const logoutLink = document.getElementById('logout-link');

    const calendarHeaderEl = document.getElementById('calendar-header');
    const calendarGridEl = document.getElementById('calendar-grid');
    const calendarDateHeaderEl = document.getElementById('calendar-date-header');
    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');
    const todayBtn = document.getElementById('today-btn');

    // Globalny stan aplikacji
    let state = { data: null, showCompleted: false, currentWeekStart: getStartOfWeek(new Date()) };
    let listSortable = null;

    // Funkcje pomocnicze dla dat
    function getStartOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1); // poniedziałek jako pierwszy dzień
        d.setHours(0, 0, 0, 0);
        return new Date(d.setDate(diff));
    }

    function addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }
    
    // Komunikacja z API
    const api = {
        getStatus: () => fetch('/api/auth/status').then(res => res.json()),
        getData: () => fetch('/api/data').then(res => res.json()),
        saveData: (data) => fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
        syncTask: (task) => fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) }).then(res => res.json())
    };

    // Główna funkcja renderująca
    const renderAll = () => {
        if (!state.data) return;
        ensureActiveList();
        renderLists(state.data);
        renderTasks(state.data);
        renderCalendar(state.data);
    };

    const ensureActiveList = () => {
        if (!state.data.lists || state.data.lists.length === 0) {
            state.data.lists = [{ id: Date.now(), name: 'Moje Zadania', sortMode: 'manual', tasks: [] }];
            state.data.activeListId = state.data.lists[0].id;
        }
        if (!state.data.activeListId) {
            state.data.activeListId = state.data.lists[0].id;
        }
    };

    const getActiveList = () => {
        return state.data.lists.find(l => l.id === state.data.activeListId) || state.data.lists[0];
    };

    const renderLists = (data) => {
        const list = getActiveList();
        currentListName.textContent = list ? list.name : 'Moje Zadania';
        // (Tu można rozwinąć rozwijane menu z listami)
    };

    const renderTasks = (data) => {
        const list = getActiveList();
        taskListEl.innerHTML = '';
        (list.tasks || []).forEach(task => {
            const li = document.createElement('li');
            li.className = 'task-item';
            li.textContent = task.text;
            li.dataset.taskId = task.id;
            taskListEl.appendChild(li);
        });

        // Inicjalizacja Sortable na liście zadań (źródło drag&drop)
        if (listSortable) listSortable.destroy();
        listSortable = new Sortable(taskListEl, { 
            group: { name: 'tasks', pull: 'clone', put: true },
            animation: 150
        });
    };
    
    const renderCalendar = (data) => {
        calendarGridEl.innerHTML = '';
        calendarHeaderEl.innerHTML = '<div class="time-label-header"></div>';
        
        const weekStart = state.currentWeekStart;
        const weekEnd = addDays(weekStart, 6);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        calendarDateHeaderEl.textContent = `${weekStart.toLocaleDateString('pl-PL', {day: 'numeric', month: 'long'})} - ${weekEnd.toLocaleDateString('pl-PL', {day: 'numeric', month: 'long', year: 'numeric'})}`;

        for (let i = 0; i < 7; i++) {
            const day = addDays(weekStart, i);
            const dayHeader = document.createElement('div');
            dayHeader.className = 'day-header';
            if (day.getTime() === today.getTime()) {
                dayHeader.classList.add('is-today');
            }
            dayHeader.innerHTML = `${day.toLocaleDateString('pl-PL', {weekday: 'short'})} <span class="day-number">${day.getDate()}</span>`;
            calendarHeaderEl.appendChild(dayHeader);
        }

        const timeLabelsContainer = document.createElement('div');
        timeLabelsContainer.className = 'time-labels';
        for (let hour = 0; hour < 24; hour++) {
            timeLabelsContainer.innerHTML += `<div class="time-label"><span>${hour.toString().padStart(2,'0')}:00</span></div>`;
        }
        calendarGridEl.appendChild(timeLabelsContainer);

        for (let i = 0; i < 7; i++) {
            const day = addDays(weekStart, i);
            const dayColumn = document.createElement('div');
            dayColumn.className = 'day-column';
            
            for (let hour = 0; hour < 24; hour++) {
                for (let minute = 0; minute < 2; minute++) {
                    const slot = document.createElement('div');
                    slot.className = 'time-slot';
                    const slotTime = new Date(day);
                    slotTime.setHours(hour, minute * 30, 0, 0);
                    slot.dataset.time = slotTime.toISOString();
                    dayColumn.appendChild(slot);
                    new Sortable(slot, { group: 'tasks', onAdd: (evt) => handleTaskDropOnCalendar(evt) });
                }
            }
            calendarGridEl.appendChild(dayColumn);
        }

        (data.lists || []).flatMap(l => l.tasks).forEach(task => {
            if (task.dueDate) {
                const taskDate = new Date(task.dueDate);
                if (taskDate >= weekStart && taskDate < addDays(weekEnd, 1)) {
                    const dayIndex = (taskDate.getDay() + 6) % 7;
                    const dayColumn = calendarGridEl.querySelectorAll('.day-column')[dayIndex];
                    if (dayColumn) {
                        const eventEl = createCalendarEventElement(task, taskDate);
                        dayColumn.appendChild(eventEl);
                    }
                }
            }
        });
    };

    const createCalendarEventElement = (task, taskDate) => {
        const el = document.createElement('div');
        el.className = 'calendar-event';
        el.dataset.taskId = task.id;
        
        const startMinutes = taskDate.getHours() * 60 + taskDate.getMinutes();
        el.style.top = `${startMinutes}px`;
        el.style.height = `${task.duration || 30}px`;
        
        el.innerHTML = `<div class="event-title">${task.text}</div>`;
        
        const resizer = document.createElement('div');
        resizer.className = 'event-resizer';
        el.appendChild(resizer);

        resizer.addEventListener('mousedown', (e) => initResize(e, el, task));
        el.addEventListener('click', (e) => {
            if (e.target !== resizer) {
                // Tu można otworzyć modal edycji
            }
        });
        return el;
    };
    
    const initResize = (e, eventEl, task) => {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startHeight = parseInt(eventEl.style.height);
        const doDrag = (moveEvent) => {
            const newHeight = startHeight + moveEvent.clientY - startY;
            if (newHeight > 15) eventEl.style.height = `${newHeight}px`;
        };
        const stopDrag = async () => {
            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
            const finalHeight = parseInt(eventEl.style.height);
            const newDuration = Math.max(15, Math.round(finalHeight / 5) * 5);
            eventEl.style.height = `${newDuration}px`;
            await updateTask(task.id, { duration: newDuration });
        };
        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    };

    const handleTaskDropOnCalendar = async (evt) => {
        const taskId = Number(evt.item.dataset.taskId);
        const newTimeISO = evt.to.dataset.time;
        evt.item.remove(); // usuwamy przeniesiony element (bo render doda event)
        await updateTask(taskId, { dueDate: newTimeISO });
    };

    const updateTask = async (taskId, props) => {
        let taskToUpdate;
        for (const list of state.data.lists) {
            const task = list.tasks.find(t => String(t.id) === String(taskId));
            if (task) {
                taskToUpdate = task;
                Object.assign(taskToUpdate, props);
                break;
            }
        }
        if (taskToUpdate) {
            renderAll(); // Optimistic update
            await api.saveData(state.data);
            try { await api.syncTask(taskToUpdate); } catch (_) {}
            // Odświeżenie danych z serwera (opcjonalne)
            state.data = await api.getData();
            renderAll();
        }
    };

    const addTask = async (text) => {
        if (!text || !text.trim()) return;
        ensureActiveList();
        const list = getActiveList();
        const newTask = {
            id: Date.now(),
            text: text.trim(),
            duration: 30,
            dueDate: null,
            notes: ""
        };
        list.tasks.push(newTask);
        await api.saveData(state.data);
        renderAll();
    };
    
    // Główna funkcja inicjalizująca aplikację
    const init = async () => {
        try {
            const authStatus = await api.getStatus();
            if (authStatus.loggedIn) {
                loginContainer.style.display = 'none';
                appContainer.style.display = 'flex';
                if (userDisplayNameEl) userDisplayNameEl.textContent = authStatus.user.displayName || '';
                if (logoutLink) logoutLink.style.display = 'inline-block';
                state.data = await api.getData();
                
                renderAll();
            } else {
                loginContainer.style.display = 'flex';
                appContainer.style.display = 'none';
            }
        } catch (error) {
            console.error("Błąd inicjalizacji:", error);
            loginContainer.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    };
    
    // Dodanie event listenerów
    prevWeekBtn.addEventListener('click', () => {
        state.currentWeekStart.setDate(state.currentWeekStart.getDate() - 7);
        renderAll();
    });
    nextWeekBtn.addEventListener('click', () => {
        state.currentWeekStart.setDate(state.currentWeekStart.getDate() + 7);
        renderAll();
    });
    todayBtn.addEventListener('click', () => {
        state.currentWeekStart = getStartOfWeek(new Date());
        renderAll();
    });
    if (newTaskInput) {
        newTaskInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                await addTask(newTaskInput.value);
                newTaskInput.value = '';
            }
        });
    }
    
    // Uruchomienie aplikacji
    init();
});
