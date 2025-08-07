document.addEventListener('DOMContentLoaded', () => {
    // Referencje do elementów UI
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-container');
    const userDisplayNameEl = document.getElementById('user-display-name');
    const dropdownContainer = document.getElementById('custom-dropdown-container');
    const currentListTrigger = document.getElementById('current-list-trigger');
    const currentListName = document.getElementById('current-list-name');
    const smartListOptions = document.getElementById('smart-list-options');
    const userListOptions = document.getElementById('user-list-options');
    const newListInput = document.getElementById('new-list-input');
    const addListBtn = document.getElementById('add-list-btn');
    const toggleCompletedBtn = document.getElementById('toggle-completed-btn');
    const taskInput = document.getElementById('task-input');
    const addTaskBtn = document.getElementById('add-task-btn');
    const taskListEl = document.getElementById('task-list');
    const completedTasksSection = document.getElementById('completed-tasks-section');
    const completedTasksToggle = document.getElementById('completed-tasks-toggle');
    const completedTaskList = document.getElementById('completed-task-list');
    const modal = document.getElementById('edit-modal-backdrop');
    const editForm = document.getElementById('edit-form');
    const editTaskText = document.getElementById('edit-task-text');
    const editTaskDueDate = document.getElementById('edit-task-duedate');
    const editTaskDueTime = document.getElementById('edit-task-duetime');
    const editTaskAttendees = document.getElementById('edit-task-attendees');
    const editTaskMeetLink = document.getElementById('edit-task-meet-link');
    const editTaskNotes = document.getElementById('edit-task-notes');
    const editTaskPriority = document.getElementById('edit-task-priority');
    const cancelEditBtn = document.getElementById('cancel-edit-btn');
    const clearDateBtn = document.getElementById('clear-date-btn');
    const clearTimeBtn = document.getElementById('clear-time-btn');
    const addTaskWrapper = document.getElementById('add-task-wrapper');
    const newTaskDateInput = document.getElementById('new-task-date');
    const newTaskPrioritySelect = document.getElementById('new-task-priority');
    const newTaskTimeInput = document.getElementById('new-task-time');
    const toast = document.getElementById('toast-notification');
    const toastMessage = document.getElementById('toast-message');
    const toastActionBtn = document.getElementById('toast-action-btn');
    const sortDropdownContainer = document.getElementById('sort-dropdown-container');
    const sortTriggerBtn = document.getElementById('sort-trigger-btn');
    const sortOptionsList = document.getElementById('sort-options-list');
    const calendarGridEl = document.getElementById('calendar-grid');
    const calendarDateHeaderEl = document.getElementById('calendar-date-header');
    const prevDayBtn = document.getElementById('prev-day-btn');
    const nextDayBtn = document.getElementById('next-day-btn');

    // Zmienne globalne
    let state = { data: null, showCompleted: false, currentCalendarDate: new Date() };
    let toastTimeout;
    let listSortable = null;
    let calendarSortables = [];
    
    // Ikony i listy
    const ICONS = {
        manual: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3zM8 8h8v8H8z"/></svg>`,
        date: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M16 14h-6"/><path d="M13 18H8"/></svg>`,
        priority: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`
    };
    const SMART_LISTS = { 'today': 'Dzisiaj', 'tomorrow': 'Jutro', 'this-week': 'Ten tydzień' };

    // Funkcje pomocnicze
    const formatDate = (date) => date.toISOString().split('T')[0];

    // Komunikacja z API
    const api = {
        getStatus: () => fetch('/api/auth/status').then(res => res.json()),
        getData: () => fetch('/api/data').then(res => res.json()),
        saveData: (data) => fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
        syncTask: (task) => fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task }) }).then(res => res.json())
    };

    const showToast = (message, actionText, callback) => {
        clearTimeout(toastTimeout);
        toastMessage.textContent = message;
        toastActionBtn.style.display = actionText ? 'block' : 'none';
        if(actionText) toastActionBtn.textContent = actionText;
        toastActionBtn.onclick = () => { callback(); toast.classList.remove('show'); };
        toast.classList.add('show');
        toastTimeout = setTimeout(() => toast.classList.remove('show'), 5000);
    };

    const renderAll = () => {
        if (!state.data) return;
        renderLists(state.data);
        renderTasks(state.data);
        renderCalendar(state.data);
    };

    const renderLists = (data) => {
        const { lists, activeListId } = data;
        let activeListIsSmart = !!SMART_LISTS[activeListId];
        currentListName.textContent = activeListIsSmart ? SMART_LISTS[activeListId] : lists.find(l => l.id == activeListId)?.name || 'Wybierz listę';
        
        smartListOptions.innerHTML = Object.entries(SMART_LISTS).map(([id, name]) =>
            `<li class="list-option ${id === activeListId ? 'active' : ''}" data-list-id="${id}">${name}</li>`
        ).join('');
        
        userListOptions.innerHTML = lists.map(list =>
            `<li class="list-option ${list.id === activeListId ? 'active' : ''}" data-list-id="${list.id}">
                <span class="list-option-name">${list.name}</span>
            </li>`
        ).join('');
    };

    const renderTasks = (data) => {
        const activeList = data.lists.find(l => l.id == data.activeListId);
        const sortMode = activeList ? (activeList.sortMode || 'manual') : 'date';
        
        let allTasks = [];
        if (SMART_LISTS[data.activeListId]) {
            allTasks = data.lists.flatMap(l => l.tasks).filter(t => isTaskInSmartList(t, data.activeListId));
            sortTriggerBtn.style.display = 'none';
        } else if (activeList) {
            allTasks = activeList.tasks;
            sortTriggerBtn.style.display = 'flex';
        }
        
        const priorityOrder = { high: 0, medium: 1, low: 2, default: 3 };
        if (sortMode === 'date') allTasks.sort((a, b) => (a.dueDate || 0) > (b.dueDate || 0) ? 1 : -1);
        if (sortMode === 'priority') allTasks.sort((a, b) => (priorityOrder[a.priority] || 3) - (priorityOrder[b.priority] || 3));
        
        const activeTasks = allTasks.filter(t => !t.completed);
        const completedTasks = allTasks.filter(t => t.completed);

        taskListEl.innerHTML = activeTasks.map(createTaskElement).join('');
        completedTaskList.innerHTML = completedTasks.map(createTaskElement).join('');
        completedTasksSection.style.display = state.showCompleted && completedTasks.length > 0 ? 'block' : 'none';
        
        listSortable.option("disabled", sortMode !== 'manual' || !!SMART_LISTS[data.activeListId]);
    };
    
    const renderCalendar = (data) => {
        calendarGridEl.innerHTML = '';
        calendarSortables.forEach(s => s.destroy());
        calendarSortables = [];
        
        const timeLabels = document.createElement('div');
        timeLabels.className = 'time-labels';
        const timeSlots = document.createElement('div');
        timeSlots.className = 'time-slots';
        
        for (let h = 0; h < 24; h++) {
            timeLabels.innerHTML += `<div class="time-label"><span>${h}:00</span></div>`;
            for (let m = 0; m < 2; m++) {
                const slotTime = new Date(state.currentCalendarDate);
                slotTime.setHours(h, m * 30, 0, 0);
                const slot = document.createElement('div');
                slot.className = 'time-slot';
                slot.dataset.time = slotTime.toISOString();
                timeSlots.appendChild(slot);
                calendarSortables.push(new Sortable(slot, { group: 'tasks', animation: 150, onAdd: handleTaskDropOnCalendar }));
            }
        }
        
        const startOfDay = new Date(state.currentCalendarDate);
        startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(startOfDay);
        endOfDay.setDate(endOfDay.getDate() + 1);

        data.lists.flatMap(l => l.tasks).forEach(task => {
            if (task.dueDate) {
                const taskDate = new Date(task.dueDate);
                if (taskDate >= startOfDay && taskDate < endOfDay) {
                    const eventEl = createCalendarEventElement(task, taskDate);
                    timeSlots.appendChild(eventEl);
                }
            }
        });
        
        calendarGridEl.append(timeLabels, timeSlots);
        calendarDateHeaderEl.textContent = state.currentCalendarDate.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    };

    const createTaskElement = (task) => {
        const details = [];
        if(task.dueDate) details.push(`<div class="task-detail-item">${new Date(task.dueDate).toLocaleTimeString('pl-PL', {hour:'2-digit', minute:'2-digit'})}</div>`);
        if(task.meetLink) details.push(`<div class="task-detail-item meet-link" title="Dołącz do spotkania"><svg class="meet-icon" ...></svg></div>`);
        if(task.attendees?.length) details.push(`<div class="task-detail-item" title="${task.attendees.join(', ')}"><svg ...></svg></div>`);

        return `
        <li class="task-item ${task.completed ? 'completed' : ''}" data-task-id="${task.id}" data-priority="${task.priority || 'medium'}">
            <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''}>
            <div class="task-content">
                <div class="task-text-content">${task.text}</div>
                <div class="task-details">${details.join('')}</div>
            </div>
            <button class="delete-btn icon-btn" title="Usuń zadanie">&times;</button>
        </li>`;
    };

    const createCalendarEventElement = (task, taskDate) => {
        const el = document.createElement('div');
        el.className = 'calendar-event';
        el.dataset.taskId = task.id;
        const startMinutes = taskDate.getHours() * 60 + taskDate.getMinutes();
        el.style.top = `${startMinutes}px`;
        el.style.height = `${task.duration || 60}px`;
        el.innerHTML = `<div class="event-title">${task.text}</div>`;
        return el;
    };
    
    // Obsługa zdarzeń
    async function handleTaskAction(e) {
        const target = e.target;
        const taskItem = target.closest('.task-item');
        if (!taskItem) return;
        const taskId = Number(taskItem.dataset.taskId);

        if (target.matches('.task-checkbox')) await updateTask(taskId, { completed: target.checked });
        else if (target.matches('.delete-btn')) await updateTask(taskId, { deleted: true });
        else if (target.matches('.meet-link')) window.open(state.data.lists.flatMap(l=>l.tasks).find(t=>t.id===taskId).meetLink, '_blank');
        else openEditModal(taskId);
    }
    
    const updateTask = async (taskId, props) => {
        let taskToUpdate, listId;
        for(const list of state.data.lists) {
            const taskIndex = list.tasks.findIndex(t => t.id === taskId);
            if (taskIndex > -1) {
                if(props.deleted) {
                    taskToUpdate = list.tasks.splice(taskIndex, 1)[0];
                    taskToUpdate.dueDate = null; // Aby usunąć z kalendarza
                } else {
                    taskToUpdate = list.tasks[taskIndex];
                    Object.assign(taskToUpdate, props);
                }
                listId = list.id;
                break;
            }
        }
        
        if (taskToUpdate) {
            await api.saveData(state.data);
            const syncResult = await api.syncTask(taskToUpdate);
            
            if(syncResult.data.action === 'created' || syncResult.data.action === 'updated') {
                taskToUpdate.googleCalendarEventId = syncResult.data.id;
                taskToUpdate.meetLink = syncResult.data.hangoutLink;
                await api.saveData(state.data);
            }
            renderAll();
        }
    };

    const openEditModal = (taskId) => {
        const task = state.data.lists.flatMap(l=>l.tasks).find(t=>t.id === taskId);
        if (!task) return;
        modal.dataset.editingTaskId = taskId;
        editTaskText.value = task.text;
        editTaskNotes.value = task.notes || '';
        editTaskPriority.value = task.priority || 'medium';
        editTaskAttendees.value = (task.attendees || []).join(', ');
        editTaskMeetLink.checked = !!task.createMeetLink || !!task.meetLink;
        if (task.dueDate) {
            const d = new Date(task.dueDate);
            editTaskDueDate.value = formatDate(d);
            editTaskDueTime.value = d.toTimeString().slice(0, 5);
        } else {
            editTaskDueDate.value = '';
            editTaskDueTime.value = '';
        }
        modal.style.display = 'flex';
    };

    const handleSaveEdit = async (e) => {
        e.preventDefault();
        const taskId = Number(modal.dataset.editingTaskId);
        const newProps = {
            text: editTaskText.value,
            notes: editTaskNotes.value,
            priority: editTaskPriority.value,
            attendees: editTaskAttendees.value.split(',').map(em => em.trim()).filter(Boolean),
            createMeetLink: editTaskMeetLink.checked
        };
        if (editTaskDueDate.value) {
            const time = editTaskDueTime.value || '00:00';
            newProps.dueDate = new Date(`${editTaskDueDate.value}T${time}`).toISOString();
        } else {
            newProps.dueDate = null;
        }
        await updateTask(taskId, newProps);
        modal.style.display = 'none';
    };
    
    const handleTaskDropOnCalendar = async (evt) => {
        const taskId = Number(evt.item.dataset.taskId);
        const newTimeISO = evt.to.dataset.time;
        evt.item.remove();
        await updateTask(taskId, { dueDate: newTimeISO });
    };
    
    // Inicjalizacja
    const init = async () => {
        const authStatus = await api.getStatus();
        if (authStatus.loggedIn) {
            loginContainer.style.display = 'none';
            appContainer.style.display = 'flex';
            userDisplayNameEl.textContent = authStatus.user.displayName;
            state.data = await api.getData();
            listSortable = new Sortable(taskListEl, { group: 'tasks', animation: 150 });
            
            // Rejestracja event listenerów
            taskListEl.addEventListener('click', handleTaskAction);
            completedTaskList.addEventListener('click', handleTaskAction);
            editForm.addEventListener('submit', handleSaveEdit);
            prevDayBtn.addEventListener('click', () => { state.currentCalendarDate.setDate(state.currentCalendarDate.getDate() - 1); renderAll(); });
            nextDayBtn.addEventListener('click', () => { state.currentCalendarDate.setDate(state.currentCalendarDate.getDate() + 1); renderAll(); });
            
            renderAll();
        } else {
            loginContainer.style.display = 'flex';
            appContainer.style.display = 'none';
        }
    };
    
    function isTaskInSmartList(task, listId) {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (listId) {
            case 'today':
                const endOfToday = new Date(startOfToday);
                endOfToday.setDate(endOfToday.getDate() + 1);
                return taskDate >= startOfToday && taskDate < endOfToday;
            case 'tomorrow':
                const startOfTomorrow = new Date(startOfToday);
                startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
                const endOfTomorrow = new Date(startOfTomorrow);
                endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
                return taskDate >= startOfTomorrow && taskDate < endOfTomorrow;
            case 'this-week':
                const startOfWeek = new Date(startOfToday);
                startOfWeek.setDate(startOfWeek.getDate() - (startOfWeek.getDay() + 6) % 7);
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(endOfWeek.getDate() + 7);
                return taskDate >= startOfWeek && taskDate < endOfWeek;
            default: return false;
        }
    }

    init();
});