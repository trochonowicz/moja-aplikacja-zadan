document.addEventListener('DOMContentLoaded', () => {
    // Referencje do elementów UI
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-container');
    const userDisplayNameEl = document.getElementById('user-display-name');
    const dropdownContainer = document.getElementById('custom-dropdown-container');
    const taskListEl = document.getElementById('task-list');
    const modal = document.getElementById('edit-modal-backdrop');
    // ... i wszystkie inne referencje

    const calendarHeaderEl = document.getElementById('calendar-header');
    const calendarGridEl = document.getElementById('calendar-grid');
    const calendarDateHeaderEl = document.getElementById('calendar-date-header');
    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');
    const todayBtn = document.getElementById('today-btn');

    // Zmienne globalne
    let state = { data: null, showCompleted: false, currentWeekStart: getStartOfWeek(new Date()) };
    
    // Funkcje pomocnicze dla dat
    function getStartOfWeek(date) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        d.setHours(0, 0, 0, 0);
        return new Date(d.setDate(diff));
    }

    function addDays(date, days) {
        const result = new Date(date);
        result.setDate(result.getDate() + days);
        return result;
    }

    const api = {
        // ... (funkcje API bez zmian)
    };
    
    const renderAll = () => {
        if (!state.data) return;
        // renderLists(state.data);
        // renderTasks(state.data);
        renderCalendar(state.data);
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

        data.lists.flatMap(l => l.tasks).forEach(task => {
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
                // openEditModal(task.id)
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
            if (newHeight > 15) {
                eventEl.style.height = `${newHeight}px`;
            }
        };

        const stopDrag = async () => {
            document.removeEventListener('mousemove', doDrag);
            document.removeEventListener('mouseup', stopDrag);
            
            const finalHeight = parseInt(eventEl.style.height);
            const newDuration = Math.max(15, Math.round(finalHeight / 5) * 5);
            eventEl.style.height = `${newDuration}px`;

            // updateTask(task.id, { duration: newDuration });
        };

        document.addEventListener('mousemove', doDrag);
        document.addEventListener('mouseup', stopDrag);
    };

    const handleTaskDropOnCalendar = async (evt) => {
        const taskId = Number(evt.item.dataset.taskId);
        const newTimeISO = evt.to.dataset.time;
        evt.item.remove();
        // updateTask(taskId, { dueDate: newTimeISO });
    };

    const init = async () => {
        // ... (funkcja init bez większych zmian, ale upewnij się, że wywołuje renderAll)
        // new Sortable(taskListEl, { group: 'tasks' }); // Inicjalizacja listy zadań jako przeciągalnej
    };

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
    
    // init(); // Wywołaj inicjalizację
});