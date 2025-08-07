document.addEventListener('DOMContentLoaded', () => {
    // ... (istniejące referencje do elementów UI) ...
    const editTaskAttendees = document.getElementById('edit-task-attendees');
    const editTaskMeetLink = document.getElementById('edit-task-meet-link');
    const calendarGridEl = document.getElementById('calendar-grid');
    const calendarDateHeaderEl = document.getElementById('calendar-date-header');
    const prevDayBtn = document.getElementById('prev-day-btn');
    const nextDayBtn = document.getElementById('next-day-btn');
    const userDisplayNameEl = document.getElementById('user-display-name');

    // ... (istniejące zmienne globalne) ...
    let currentCalendarDate = new Date();
    let calendarSortableInstances = [];

    // ... (istniejąca funkcja `initialize`) ...
    
    // NOWA FUNKCJA - renderowanie kalendarza
    const renderCalendar = (data) => {
        calendarGridEl.innerHTML = ''; // Wyczyść stary widok
        calendarSortableInstances.forEach(sortable => sortable.destroy());
        calendarSortableInstances = [];

        const timeLabelsContainer = document.createElement('div');
        timeLabelsContainer.className = 'time-labels';
        const timeSlotsContainer = document.createElement('div');
        timeSlotsContainer.className = 'time-slots';

        // Generuj etykiety czasu i sloty
        for (let hour = 0; hour < 24; hour++) {
            const timeLabel = document.createElement('div');
            timeLabel.className = 'time-label';
            const timeSpan = document.createElement('span');
            timeSpan.textContent = `${hour}:00`;
            timeLabel.appendChild(timeSpan);
            timeLabelsContainer.appendChild(timeLabel);

            for (let minute = 0; minute < 60; minute += 30) {
                const slot = document.createElement('div');
                slot.className = 'time-slot';
                const slotTime = new Date(currentCalendarDate);
                slotTime.setHours(hour, minute, 0, 0);
                slot.dataset.time = slotTime.toISOString();
                timeSlotsContainer.appendChild(slot);
                
                // Utwórz instancję Sortable dla każdego slotu
                const sortable = new Sortable(slot, {
                    group: 'tasks',
                    animation: 150,
                    onAdd: handleTaskDropOnCalendar,
                });
                calendarSortableInstances.push(sortable);
            }
        }
        
        // Renderuj wydarzenia na siatce
        const allTasks = data.lists.flatMap(list => list.tasks);
        const startOfDay = new Date(currentCalendarDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        allTasks.forEach(task => {
            if (task.dueDate) {
                const taskDate = new Date(task.dueDate);
                if (taskDate >= startOfDay && taskDate < endOfDay) {
                    const eventEl = createCalendarEventElement(task);
                    timeSlotsContainer.appendChild(eventEl);
                }
            }
        });
        
        calendarGridEl.appendChild(timeLabelsContainer);
        calendarGridEl.appendChild(timeSlotsContainer);

        // Ustaw datę w nagłówku
        calendarDateHeaderEl.textContent = currentCalendarDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    };
    
    // NOWA FUNKCJA - tworzenie elementu wydarzenia w kalendarzu
    const createCalendarEventElement = (task) => {
        const eventEl = document.createElement('div');
        eventEl.className = 'calendar-event';
        eventEl.dataset.taskId = task.id;

        const taskDate = new Date(task.dueDate);
        const startMinutes = taskDate.getHours() * 60 + taskDate.getMinutes();
        const duration = task.duration || 60; // Domyślnie 60 minut
        
        eventEl.style.top = `${startMinutes * (60 / 60)}px`; // 1px na minutę
        eventEl.style.height = `${duration}px`;

        const title = document.createElement('div');
        title.className = 'event-title';
        title.textContent = task.text;
        
        const time = document.createElement('div');
        time.className = 'event-time';
        time.textContent = taskDate.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

        eventEl.appendChild(title);
        eventEl.appendChild(time);
        eventEl.addEventListener('click', () => openEditModal(task));
        
        return eventEl;
    };
    
    // NOWA FUNKCJA - obsługa upuszczenia zadania na kalendarz
    const handleTaskDropOnCalendar = async (evt) => {
        const taskId = evt.item.dataset.taskId;
        const newTimeISO = evt.to.dataset.time;
        
        // Znajdź zadanie i zaktualizuj jego dane
        const data = await getStorage();
        let taskToUpdate = null;
        for(const list of data.lists) {
            const found = list.tasks.find(t => t.id == taskId);
            if(found) {
                taskToUpdate = found;
                break;
            }
        }

        if (taskToUpdate) {
            taskToUpdate.dueDate = newTimeISO;
            await quickUpdateTask(taskToUpdate.id, { dueDate: newTimeISO });
        }
        
        // Usuń element z listy (Sortable.js go sklonował)
        evt.item.remove();
    };

    // ZMODYFIKOWANA FUNKCJA `render`
    const render = (data) => {
        // ... (istniejący kod renderowania listy zadań) ...
        
        // Dodaj renderowanie kalendarza
        renderCalendar(data);
    };

    // ... (istniejąca funkcja `initialize`) ...
    const initialize = async () => {
        let data = await getStorage();
        if (!data.lists || data.lists.length === 0) {
            const defaultListId = Date.now();
            data = { lists: [{ id: defaultListId, name: "Moje Zadania", tasks: [], sortMode: 'manual' }], activeListId: 'today' };
            await saveStorage(data);
        }
        
        sortableInstance = new Sortable(taskListEl, {
            group: 'tasks', // Ta sama grupa co kalendarz
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: handleTaskDrop,
        });
        
        render(data);
        
        setInterval(async () => {
            const latestData = await getStorage();
            render(latestData);
        }, 30000); // 30 sekund
    };

    // ZMODYFIKOWANA FUNKCJA `openEditModal`
    const openEditModal = (task) => {
        modal.dataset.editingTaskId = task.id;
        editTaskText.value = task.text;
        editTaskNotes.value = task.notes || '';
        editTaskPriority.value = task.priority || 'medium';
        editTaskAttendees.value = (task.attendees || []).join(', ');
        editTaskMeetLink.checked = !!task.createMeetLink || !!task.meetLink;
        
        if (task.dueDate) {
            const date = new Date(task.dueDate);
            editTaskDueDate.value = formatDateForInput(date);
            editTaskDueTime.value = date.toTimeString().split(' ')[0].substring(0, 5);
        } else {
            editTaskDueDate.value = '';
            editTaskDueTime.value = '';
        }
        modal.style.display = 'flex';
    };

    // ZMODYFIKOWANA FUNKCJA `handleSaveEdit`
    const handleSaveEdit = async (event) => {
        event.preventDefault();
        const taskId = parseInt(modal.dataset.editingTaskId, 10);
        const data = await getStorage();
        let taskFound = null;
        for (const list of data.lists) {
            const task = list.tasks.find(t => t.id === taskId);
            if (task) {
                task.text = editTaskText.value;
                task.notes = editTaskNotes.value;
                task.priority = editTaskPriority.value;
                
                // Nowe pola
                task.attendees = editTaskAttendees.value.split(',').map(e => e.trim()).filter(Boolean);
                task.createMeetLink = editTaskMeetLink.checked;

                if (editTaskDueDate.value) {
                    const date = editTaskDueDate.value;
                    const time = editTaskDueTime.value || '00:00';
                    task.dueDate = new Date(`${date}T${time}`).toISOString();
                } else {
                    task.dueDate = null;
                }
                taskFound = task;
                break;
            }
        }
        if (taskFound) {
            await saveStorage(data);
            syncTaskWithCalendar(taskFound);
            closeEditModal();
            render(data);
        }
    };

    // ZMODYFIKOWANA FUNKCJA `createTaskElement`
    const createTaskElement = (task) => {
        // ... (istniejący kod na początku funkcji) ...
        if (task.meetLink) {
            const meetDetail = document.createElement('div');
            meetDetail.className = 'task-detail-item';
            meetDetail.innerHTML = `<svg class="meet-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"/><path d="M12 21a9 9 0 0 0 9-9V7.5a2.5 2.5 0 0 0-2.5-2.5h-13A2.5 2.5 0 0 0 3 7.5V12a9 9 0 0 0 9 9Z"/><path d="m15 11-3 3-3-3"/><path d="M12 7.5V14"/></svg>`;
            meetDetail.title = "Dołącz do spotkania Google Meet";
            meetDetail.onclick = (e) => { e.stopPropagation(); window.open(task.meetLink, '_blank'); };
            details.appendChild(meetDetail);
        }
        if (task.attendees && task.attendees.length > 0) {
            const attendeesDetail = document.createElement('div');
            attendeesDetail.className = 'task-detail-item';
            attendeesDetail.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
            attendeesDetail.title = `Goście: ${task.attendees.join(', ')}`;
            details.appendChild(attendeesDetail);
        }
        // ... (reszta istniejącego kodu) ...
        return li;
    };
    
    // NOWA OBSŁUGA ZDARZEŃ DLA NAWIGACJI KALENDARZA
    prevDayBtn.addEventListener('click', async () => {
        currentCalendarDate.setDate(currentCalendarDate.getDate() - 1);
        render(await getStorage());
    });
    nextDayBtn.addEventListener('click', async () => {
        currentCalendarDate.setDate(currentCalendarDate.getDate() + 1);
        render(await getStorage());
    });
    
    // ... (pozostałe nasłuchiwania zdarzeń)
});
