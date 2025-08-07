document.addEventListener('DOMContentLoaded', () => {
    // Referencje do wszystkich elementów UI
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-container');
    const userDisplayNameEl = document.getElementById('user-display-name');
    const dropdownContainer = document.getElementById('custom-dropdown-container');
    const currentListTrigger = document.getElementById('current-list-trigger');
    const currentListName = document.getElementById('current-list-name');
    const smartListOptions = document.getElementById('smart-list-options');
    const userListOptions = document.getElementById('user-list-options');
    const taskListEl = document.getElementById('task-list');
    const modal = document.getElementById('edit-modal-backdrop');
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
        renderLists(state.data);
        renderTasks(state.data);
        renderCalendar(state.data);
    };

    const renderLists = (data) => {
        // Ta funkcja renderuje dropdown z listami zadań (kod z poprzednich wersji)
    };

    const renderTasks = (data) => {
        // Ta funkcja renderuje listę zadań (kod z poprzednich wersji)
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
            timeLabelsContainer.innerHTML += `<div class="time-label"><span>${hour}:00</span></div>`;
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
                // openEditModal(task.id);
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
        evt.item.remove();
        await updateTask(taskId, { dueDate: newTimeISO });
    };

    const updateTask = async (taskId, props) => {
        let taskToUpdate;
        for (const list of state.data.lists) {
            const task = list.tasks.find(t => t.id === taskId);
            if (task) {
                taskToUpdate = task;
                Object.assign(taskToUpdate, props);
                break;
            }
        }
        if (taskToUpdate) {
            renderAll(); // Optimistic update
            await api.saveData(state.data);
            await api.syncTask(taskToUpdate);
            // Optionally, refresh data from server after sync
            state.data = await api.getData();
            renderAll();
        }
    };
    
    // Główna funkcja inicjalizująca aplikację
    const init = async () => {
        try {
            const authStatus = await api.getStatus();
            if (authStatus.loggedIn) {
                loginContainer.style.display = 'none';
                appContainer.style.display = 'flex';
                // userDisplayNameEl.textContent = authStatus.user.displayName;
                state.data = await api.getData();
                
                listSortable = new Sortable(taskListEl, { 
                    group: 'tasks',
                    // onEnd: handleTaskDropInList
                });
                
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
    
    // Dodanie event listenerów do nawigacji
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
    
    // Uruchomienie aplikacji
    init();
});