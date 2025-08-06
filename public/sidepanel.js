document.addEventListener('DOMContentLoaded', () => {
    // NOWA SEKCJA: Sprawdzanie statusu logowania i przełączanie widoków
    const loginContainer = document.getElementById('login-container');
    const appContainer = document.getElementById('app-container');
    const userDisplayNameEl = document.getElementById('user-display-name');

    fetch('/api/auth/status')
        .then(res => res.json())
        .then(authStatus => {
            if (authStatus.loggedIn) {
                // Użytkownik jest zalogowany: pokaż aplikację, ukryj logowanie
                loginContainer.style.display = 'none';
                appContainer.style.display = 'flex';
                
                if(userDisplayNameEl && authStatus.user) {
                   // Zmieniamy tekst przycisku na nazwę użytkownika
                   const userSpan = userDisplayNameEl.querySelector('span');
                   if (userSpan) {
                       userSpan.textContent = authStatus.user.displayName;
                   }
                }
                
                initialize(); // Uruchom logikę aplikacji
            } else {
                // Użytkownik nie jest zalogowany: pokaż logowanie, ukryj aplikację
                loginContainer.style.display = 'flex';
                appContainer.style.display = 'none';
            }
        })
        .catch(err => {
            console.error("Błąd sprawdzania statusu autoryzacji", err);
            loginContainer.style.display = 'flex'; // Pokaż logowanie w razie błędu
            appContainer.style.display = 'none';
        });

    // Referencje do elementów UI
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
    const switchGoogleAccountBtn = document.getElementById('switch-google-account-btn');
    const sortDropdownContainer = document.getElementById('sort-dropdown-container');
    const sortTriggerBtn = document.getElementById('sort-trigger-btn');
    const sortOptionsList = document.getElementById('sort-options-list');

    // Zmienne globalne
    let toastTimeout;
    let showCompleted = false;
    let sortableInstance = null;
    const today = new Date();
    const currentMonthName = today.toLocaleString('pl-PL', { month: 'long' });

    // Ikony SVG dla przycisku sortowania
    const ICONS = {
        manual: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3zM8 8h8v8H8z"/></svg>`,
        date: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M16 14h-6"/><path d="M13 18H8"/></svg>`,
        priority: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>`
    };

    const SMART_LISTS = {
        'today': { id: 'today', name: 'Dzisiaj' }, 'tomorrow': { id: 'tomorrow', name: 'Jutro' },
        'this-week': { id: 'this-week', name: 'Ten tydzień' }, 'this-month': { id: 'this-month', name: `Ten miesiąc (${currentMonthName})` }
    };

    // ZAKTUALIZOWANA FUNKCJA saveStorage - używa fetch
    const saveStorage = (data) => {
        return fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        })
        .catch(error => console.error('Błąd zapisu danych:', error));
    };

    // ZAKTUALIZOWANA FUNKCJA getStorage - używa fetch
    const getStorage = () => {
        return fetch('/api/data')
            .then(response => response.json())
            .catch(error => {
                console.error("Błąd pobierania danych:", error);
                return { lists: [], activeListId: 'today' };
            });
    };
    
    // Funkcje pomocnicze
    const removeActiveInlineEditors = () => { document.querySelectorAll('.inline-editor').forEach(editor => editor.remove()); };
    const toggleListDropdown = () => dropdownContainer.classList.toggle('open');
    const closeListDropdown = () => dropdownContainer.classList.remove('open');
    const toggleSortDropdown = () => sortDropdownContainer.classList.toggle('open');
    const closeSortDropdown = () => sortDropdownContainer.classList.remove('open');
    const formatDateForInput = (date) => { const year = date.getFullYear(); const month = (date.getMonth() + 1).toString().padStart(2, '0'); const day = date.getDate().toString().padStart(2, '0'); return `${year}-${month}-${day}`; };
    
    const formatTaskDueDate = (dueDate) => {
        if (!dueDate) return 'Ustaw datę';
        const date = new Date(dueDate);
        if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) {
            return date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
        } else {
            const datePart = date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
            const timePart = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
            return `${datePart}, ${timePart}`;
        }
    };
    
    const showToast = (message, action = null) => {
        clearTimeout(toastTimeout);
        toastMessage.textContent = message;
        if (action && action.label && action.callback) {
            toastActionBtn.textContent = action.label;
            toastActionBtn.style.display = 'block';
            toastActionBtn.onclick = () => { action.callback(); toast.classList.remove('show'); };
        } else {
            toastActionBtn.style.display = 'none';
        }
        toast.classList.add('show');
        toastTimeout = setTimeout(() => { toast.classList.remove('show'); }, 5000);
    };

    const handleDateShortcutClick = (e) => {
        const shortcut = e.target.dataset.shortcut;
        const editor = e.target.closest('.inline-editor, .additional-inputs, form');
        if (!editor) return;
        const targetDateInput = editor.querySelector('input[type="date"]');
        const targetTimeInput = editor.querySelector('input[type="time"]');
        const date = new Date();
        if (shortcut === 'tomorrow') { date.setDate(date.getDate() + 1); }
        else if (shortcut === 'next-week') { const dayOfWeek = date.getDay(); const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek); date.setDate(date.getDate() + daysUntilMonday); }
        if (targetDateInput) { targetDateInput.value = formatDateForInput(date); }
        if (targetTimeInput) { targetTimeInput.value = '09:00'; }
    };
    
    const isTaskInSmartList = (task, listId) => {
        if (!task.dueDate) return false;
        const taskDate = new Date(task.dueDate);
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        switch (listId) {
            case 'today': {
                const endOfToday = new Date(startOfToday);
                endOfToday.setDate(endOfToday.getDate() + 1);
                return taskDate >= startOfToday && taskDate < endOfToday;
            }
            case 'tomorrow': {
                const startOfTomorrow = new Date(startOfToday);
                startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
                const endOfTomorrow = new Date(startOfTomorrow);
                endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);
                return taskDate >= startOfTomorrow && taskDate < endOfTomorrow;
            }
            case 'this-week': {
                const startOfWeek = new Date(startOfToday);
                startOfWeek.setDate(startOfWeek.getDate() - (startOfWeek.getDay() + 6) % 7);
                const endOfWeek = new Date(startOfWeek);
                endOfWeek.setDate(endOfWeek.getDate() + 7);
                return taskDate >= startOfWeek && taskDate < endOfWeek;
            }
            case 'this-month':
                return taskDate.getMonth() === now.getMonth() && taskDate.getFullYear() === now.getFullYear();
            default:
                return false;
        }
    };
    
    const render = (data) => {
        removeActiveInlineEditors();
        let activeListId = data.activeListId;
        let allTasksInView = [];
        const activeUserList = data.lists.find(list => list.id === activeListId);
        if (activeUserList && !activeUserList.sortMode) {
            activeUserList.sortMode = 'manual';
        }
        const currentSortMode = activeUserList ? activeUserList.sortMode : 'date';
        smartListOptions.innerHTML = '';
        Object.values(SMART_LISTS).forEach(list => {
            const li = document.createElement('li');
            li.className = 'list-option';
            li.textContent = list.name;
            li.dataset.listId = list.id;
            if (list.id === activeListId) li.classList.add('active');
            li.addEventListener('click', () => { switchList(list.id); closeListDropdown(); });
            smartListOptions.appendChild(li);
        });
        userListOptions.innerHTML = '';
        data.lists.forEach(list => {
            const li = document.createElement('li');
            li.className = 'list-option';
            li.dataset.listId = list.id;
            const nameSpan = document.createElement('span');
            nameSpan.className = 'list-option-name';
            nameSpan.textContent = list.name;
            li.appendChild(nameSpan);
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'list-option-actions';
            const editBtn = document.createElement('button');
            editBtn.className = 'list-option-btn';
            editBtn.title = "Zmień nazwę";
            editBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
            editBtn.onclick = (e) => { e.stopPropagation(); editListName(list.id, nameSpan); };
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'list-option-btn';
            deleteBtn.title = "Usuń listę";
            deleteBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
            deleteBtn.onclick = (e) => { e.stopPropagation(); deleteList(list.id); };
            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(deleteBtn);
            li.appendChild(actionsDiv);
            if (list.id === activeListId) li.classList.add('active');
            li.addEventListener('click', (e) => {
                if (!e.target.closest('.list-option-actions')) {
                    switchList(list.id);
                    closeListDropdown();
                }
            });
            userListOptions.appendChild(li);
        });
        const allTasks = data.lists.flatMap(list => list.tasks);
        if (SMART_LISTS[activeListId]) {
            currentListName.textContent = SMART_LISTS[activeListId].name;
            allTasksInView = allTasks.filter(task => isTaskInSmartList(task, activeListId));
            sortTriggerBtn.style.display = 'none';
        } else if (activeUserList) {
            currentListName.textContent = activeUserList.name;
            allTasksInView = activeUserList.tasks;
            sortTriggerBtn.style.display = 'flex';
        } else {
            currentListName.textContent = "Wybierz listę";
            sortTriggerBtn.style.display = 'none';
        }
        let sortedTasks = [...allTasksInView];
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        if (currentSortMode === 'date') {
            sortedTasks.sort((a, b) => {
                const dateA = a.dueDate ? new Date(a.dueDate) : null;
                const dateB = b.dueDate ? new Date(b.dueDate) : null;
                if (dateA && dateB) {
                    const dateDiff = dateA - dateB;
                    if (dateDiff !== 0) return dateDiff;
                } else if (dateA) { return -1; } 
                  else if (dateB) { return 1; }
                const priorityA = priorityOrder[a.priority] ?? 1;
                const priorityB = priorityOrder[b.priority] ?? 1;
                return priorityA - priorityB;
            });
        } else if (currentSortMode === 'priority') {
            sortedTasks.sort((a, b) => {
                const priorityA = priorityOrder[a.priority] ?? 1;
                const priorityB = priorityOrder[b.priority] ?? 1;
                const priorityDiff = priorityA - priorityB;
                if (priorityDiff !== 0) return priorityDiff;
                
                const dateA = a.dueDate ? new Date(a.dueDate) : null;
                const dateB = b.dueDate ? new Date(b.dueDate) : null;
                if (dateA && dateB) return dateA - dateB;
                if (dateA) return -1;
                if (dateB) return 1;
                return 0;
            });
        }
        const activeTasks = sortedTasks.filter(task => !task.completed);
        const completedTasks = sortedTasks.filter(task => task.completed);
        taskListEl.innerHTML = '';
        activeTasks.forEach(task => taskListEl.appendChild(createTaskElement(task)));
        completedTaskList.innerHTML = '';
        if (completedTasks.length > 0 && showCompleted) {
            completedTasksSection.classList.add('visible');
            completedTasks.forEach(task => completedTaskList.appendChild(createTaskElement(task)));
        } else {
            completedTasksSection.classList.remove('visible');
        }
        sortTriggerBtn.innerHTML = ICONS[currentSortMode];
        sortOptionsList.querySelectorAll('.list-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.sort === currentSortMode);
        });
        if (sortableInstance) {
            const isSortable = currentSortMode === 'manual' && !SMART_LISTS[activeListId];
            sortableInstance.option('disabled', !isSortable);
        }
    };
    
    // CAŁA LOGIKA APLIKACJI ZAMKNIĘTA W FUNKCJI `initialize`
    const initialize = async () => {
        let data = await getStorage();
        if (!data.lists || data.lists.length === 0) {
            const defaultListId = Date.now();
            data = { lists: [{ id: defaultListId, name: "Moje Zadania", tasks: [], sortMode: 'manual' }], activeListId: 'today' };
            await saveStorage(data);
        }
        sortableInstance = new Sortable(taskListEl, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            onEnd: handleTaskDrop,
        });
        render(data);
        // NOWA LINIA: Uruchom odświeżanie co 15 sekund
    setInterval(async () => {
        console.log("Odświeżam dane z serwera...");
        const latestData = await getStorage();
        render(latestData);
    }, 15000); // 15000 ms = 15 sekund

    };
    
    const handleTaskDrop = async (evt) => {
        const { oldIndex, newIndex } = evt;
        const data = await getStorage();
        const activeList = data.lists.find(list => list.id === data.activeListId);
        if (!activeList) return;
        const activeTasks = activeList.tasks.filter(t => !t.completed);
        const [movedItem] = activeTasks.splice(oldIndex, 1);
        activeTasks.splice(newIndex, 0, movedItem);
        const completedTasks = activeList.tasks.filter(t => t.completed);
        activeList.tasks = [...activeTasks, ...completedTasks];
        await saveStorage(data);
        render(data);
    };

    const switchSortMode = async (newMode) => {
        const data = await getStorage();
        const activeList = data.lists.find(list => list.id === data.activeListId);
        if (activeList) {
            activeList.sortMode = newMode;
            await saveStorage(data);
            render(data);
        }
        closeSortDropdown();
    };

    const addTask = async () => {
        const taskText = taskInput.value.trim();
        if (taskText === '') return;
        const data = await getStorage();
        const activeListId = data.activeListId;
        let dueDateValue = newTaskDateInput.value;
        const dueTimeValue = newTaskTimeInput.value;
        const priorityValue = newTaskPrioritySelect.value;
        if (!dueDateValue) {
            let autoSetDate = new Date();
            let dateWasSet = false;
            if (activeListId === 'today') { dateWasSet = true; }
            else if (activeListId === 'tomorrow') { autoSetDate.setDate(autoSetDate.getDate() + 1); dateWasSet = true; }
            else if (activeListId === 'this-week') { const today = new Date(); const dayOfWeek = today.getDay(); const daysToAdd = dayOfWeek === 0 ? 0 : 7 - dayOfWeek; autoSetDate.setDate(today.getDate() + daysToAdd); dateWasSet = true; }
            else if (activeListId === 'this-month') { const today = new Date(); autoSetDate = new Date(today.getFullYear(), today.getMonth() + 1, 0); dateWasSet = true; }
            if (dateWasSet) { dueDateValue = formatDateForInput(autoSetDate); }
        }
        const newDueDate = dueDateValue ? new Date(`${dueDateValue}T${dueTimeValue || '00:00'}`).toISOString() : null;
        const newTask = { 
            id: Date.now(), 
            text: taskText, 
            completed: false, 
            dueDate: newDueDate, 
            notes: '', 
            priority: priorityValue || 'medium', 
            notified: false,
            googleCalendarEventId: null
        };
        let targetList = data.lists.find(list => typeof list.id === 'number' && list.id === activeListId);
        if (!targetList) { targetList = data.lists.find(list => typeof list.id === 'number'); }
        if (!targetList) { alert("Proszę najpierw stworzyć listę zadań."); return; }
        targetList.tasks.unshift(newTask);
        await saveStorage(data);
        syncTaskWithCalendar(newTask);
        render(data);
        taskInput.value = ''; newTaskDateInput.value = ''; newTaskTimeInput.value = ''; newTaskPrioritySelect.value = 'medium'; addTaskWrapper.classList.remove('focused'); taskInput.blur();
    };

    const switchList = async (listId) => {
        const data = await getStorage();
        data.activeListId = isNaN(listId) ? listId : parseInt(listId, 10);
        await saveStorage(data);
        render(data);
    };

    const addList = async () => {
        const listName = newListInput.value.trim();
        if (listName === '') return;
        const newList = { id: Date.now(), name: listName, tasks: [], sortMode: 'manual' };
        const data = await getStorage();
        data.lists.push(newList);
        await saveStorage(data);
        await switchList(newList.id);
        newListInput.value = '';
        closeListDropdown();
    };

    const editListName = (listId, nameSpan) => {
        const currentName = nameSpan.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'list-option-input';
        input.onclick = (e) => e.stopPropagation();
        const save = async () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                const data = await getStorage();
                const list = data.lists.find(l => l.id === listId);
                if (list) list.name = newName;
                await saveStorage(data);
            }
            render(await getStorage());
        };
        input.onblur = save;
        input.onkeydown = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { input.blur(); } };
        nameSpan.style.display = 'none';
        nameSpan.parentElement.prepend(input);
        input.focus();
    };

    const deleteList = async (listId) => {
        if (confirm('Czy na pewno chcesz usunąć tę listę i wszystkie jej zadania?')) {
            const data = await getStorage();
            data.lists = data.lists.filter(l => l.id !== listId);
            if (data.activeListId === listId) {
                data.activeListId = 'today';
            }
            await saveStorage(data);
            render(data);
            closeListDropdown();
        }
    };

    const toggleTask = async (taskId) => {
        const data = await getStorage();
        for (const list of data.lists) {
            const task = list.tasks.find(t => t.id === taskId);
            if (task) {
                task.completed = !task.completed;
                break;
            }
        }
        await saveStorage(data);
        render(data);
    };

    const deleteTask = async (taskId) => {
        const data = await getStorage();
        let taskToDelete = null;
        data.lists.forEach(list => {
            const task = list.tasks.find(t => t.id === taskId);
            if (task) taskToDelete = task;
            list.tasks = list.tasks.filter(t => t.id !== taskId);
        });
        if (taskToDelete && taskToDelete.googleCalendarEventId) {
            taskToDelete.dueDate = null;
            syncTaskWithCalendar(taskToDelete);
        }
        await saveStorage(data);
        render(data);
    };

    const quickUpdateTask = async (taskId, newValues) => {
        const data = await getStorage();
        const activeListIdBeforeUpdate = data.activeListId;
        let taskBeforeUpdate, listBeforeUpdate, taskAfterUpdate;
        for (const list of data.lists) {
            const task = list.tasks.find(t => t.id === taskId);
            if (task) {
                taskBeforeUpdate = { ...task };
                listBeforeUpdate = list;
                Object.assign(task, newValues);
                taskAfterUpdate = task;
                break;
            }
        }
        await saveStorage(data);
        if (newValues.hasOwnProperty('dueDate')) {
            syncTaskWithCalendar(taskAfterUpdate);
        }
        render(await getStorage());
        if (taskBeforeUpdate && newValues.hasOwnProperty('dueDate') && SMART_LISTS[activeListIdBeforeUpdate]) {
            const wasVisible = isTaskInSmartList(taskBeforeUpdate, activeListIdBeforeUpdate);
            const isVisible = isTaskInSmartList(taskAfterUpdate, activeListIdBeforeUpdate);
            if (wasVisible && !isVisible) {
                showToast(`Zadanie zostało przeniesione.`, {
                    label: 'Pokaż listę',
                    callback: () => switchList(listBeforeUpdate.id)
                });
            }
        }
    };

    // ZAKTUALIZOWANA FUNKCJA syncTaskWithCalendar - używa fetch
    const syncTaskWithCalendar = async (task) => {
        try {
            const response = await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ task: task }),
            });
            if (response.status === 401) {
                showToast('Musisz się zalogować, aby synchronizować z kalendarzem.');
                return;
            }
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Nieznany błąd serwera.');
            }
            const result = await response.json();
            const event = result.data;
            if (event.action === 'created' && event.id) {
                const data = await getStorage();
                for (const list of data.lists) {
                    const taskToUpdate = list.tasks.find(t => t.id === task.id);
                    if (taskToUpdate) {
                        taskToUpdate.googleCalendarEventId = event.id;
                        break;
                    }
                }
                await saveStorage(data);
                render(data);
            }
            if (event.action === 'deleted') {
                const data = await getStorage();
                for (const list of data.lists) {
                    const taskToUpdate = list.tasks.find(t => t.id === task.id);
                    if (taskToUpdate) {
                        taskToUpdate.googleCalendarEventId = null;
                        break;
                    }
                }
                await saveStorage(data);
                render(data);
            }
        } catch (error) {
            console.error('Błąd wysyłania zadania do synchronizacji:', error);
            showToast(`Błąd synchronizacji: ${error.message}`);
        }
    };

    const openPriorityPicker = (task, targetElement) => {
        removeActiveInlineEditors();
        const picker = document.createElement('div');
        picker.className = 'inline-editor priority-picker';
        ['high', 'medium', 'low'].forEach(priority => {
            const option = document.createElement('button');
            option.className = 'priority-picker-option';
            option.dataset.priority = priority;
            option.textContent = { high: 'Wysoki', medium: 'Średni', low: 'Niski' }[priority];
            option.addEventListener('click', (e) => { e.stopPropagation(); quickUpdateTask(task.id, { priority: priority }); });
            picker.appendChild(option);
        });
        targetElement.appendChild(picker);
    };

    const openDateEditor = (task, targetElement) => {
        removeActiveInlineEditors();
        const editor = document.createElement('div');
        editor.className = 'inline-editor inline-date-editor';
        editor.addEventListener('click', (e) => e.stopPropagation());
        const shortcuts = document.createElement('div');
        shortcuts.className = 'date-shortcuts';
        shortcuts.innerHTML = `<button class="date-shortcut-btn" data-shortcut="today">Dziś</button><button class="date-shortcut-btn" data-shortcut="tomorrow">Jutro</button><button class="date-shortcut-btn" data-shortcut="next-week">Nast. tyg.</button>`;
        editor.appendChild(shortcuts);
        const inputsContainer = document.createElement('div');
        inputsContainer.className = 'date-time-inputs-inline';
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        const taskDate = task.dueDate ? new Date(task.dueDate) : new Date();
        dateInput.value = formatDateForInput(taskDate);
        timeInput.value = task.dueDate ? taskDate.toTimeString().split(' ')[0].substring(0, 5) : '';
        inputsContainer.appendChild(dateInput);
        inputsContainer.appendChild(timeInput);
        editor.appendChild(inputsContainer);
        const handleInlineShortcutClick = (e) => {
            const shortcut = e.target.dataset.shortcut;
            const date = new Date();
            if (shortcut === 'tomorrow') { date.setDate(date.getDate() + 1); }
            else if (shortcut === 'next-week') { const dayOfWeek = date.getDay(); const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek); date.setDate(date.getDate() + daysUntilMonday); }
            const newDate = formatDateForInput(date);
            const newTime = '09:00';
            const newDueDate = new Date(`${newDate}T${newTime}`).toISOString();
            editor.remove();
            quickUpdateTask(task.id, { dueDate: newDueDate });
        };
        shortcuts.querySelectorAll('.date-shortcut-btn').forEach(btn => { btn.addEventListener('click', handleInlineShortcutClick); });
        const handleBlur = (e) => {
            if (editor.contains(e.relatedTarget)) { return; }
            editor.remove();
            const newDate = dateInput.value;
            const newTime = timeInput.value || '00:00';
            const newDueDate = newDate ? new Date(`${newDate}T${newTime}`).toISOString() : null;
            quickUpdateTask(task.id, { dueDate: newDueDate });
        };
        targetElement.replaceWith(editor);
        dateInput.focus();
        dateInput.addEventListener('blur', handleBlur);
        timeInput.addEventListener('blur', handleBlur);
    };

    const createTaskElement = (task) => {
        const li = document.createElement('li');
        li.className = 'task-item';
        li.dataset.taskId = task.id;
        li.dataset.priority = task.priority || 'medium';
        li.draggable = true;
        li.addEventListener('dragstart', (event) => {
            const taskData = { id: task.id, text: task.text, notes: task.notes || '' };
            event.dataTransfer.setData('application/json', JSON.stringify(taskData));
            event.dataTransfer.effectAllowed = 'copy';
        });
        if (task.completed) { li.classList.add('completed'); }
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'task-checkbox';
        checkbox.checked = task.completed;
        checkbox.addEventListener('change', () => toggleTask(task.id));
        const taskContent = document.createElement('div');
        taskContent.className = 'task-content';
        taskContent.addEventListener('click', () => { removeActiveInlineEditors(); openEditModal(task); });
        const text = document.createElement('div');
        text.className = 'task-text-content';
        text.textContent = task.text;
        const details = document.createElement('div');
        details.className = 'task-details';
        const dateDetail = document.createElement('div');
        dateDetail.className = 'task-detail-item';
        const dateIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>`;
        const dateText = `<span>${formatTaskDueDate(task.dueDate)}</span>`;
        dateDetail.innerHTML = dateIcon + dateText;
        dateDetail.addEventListener('click', (e) => { e.stopPropagation(); openDateEditor(task, dateDetail); });
        details.appendChild(dateDetail);
        if (task.googleCalendarEventId) {
            const calendarIconDetail = document.createElement('div');
            calendarIconDetail.className = 'task-detail-item';
            calendarIconDetail.title = 'Zsynchronizowano z Kalendarzem Google';
            calendarIconDetail.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4285F4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M10.1 14.3 8.8 13l-1.4 1.4 2.7 2.7 5.2-5.2-1.4-1.4Z"/></svg>`;
            details.appendChild(calendarIconDetail);
        }
        const priorityDetail = document.createElement('div');
        priorityDetail.className = 'task-detail-item';
        const priorityText = `<span class="priority-tag">${task.priority || 'medium'}</span>`;
        priorityDetail.innerHTML = priorityText;
        priorityDetail.addEventListener('click', (e) => { e.stopPropagation(); openPriorityPicker(task, priorityDetail); });
        details.appendChild(priorityDetail);
        if (task.notes) {
            const notesDetail = document.createElement('div');
            notesDetail.className = 'task-detail-item';
            notesDetail.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/></svg>`;
            details.appendChild(notesDetail);
        }
        taskContent.appendChild(text);
        taskContent.appendChild(details);
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn icon-btn';
        deleteBtn.title = "Usuń zadanie";
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
        deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
        li.appendChild(checkbox);
        li.appendChild(taskContent);
        li.appendChild(deleteBtn);
        return li;
    };

    const openEditModal = (task) => {
        modal.dataset.editingTaskId = task.id;
        editTaskText.value = task.text;
        editTaskNotes.value = task.notes || '';
        editTaskPriority.value = task.priority || 'medium';
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

    const closeEditModal = () => { modal.style.display = 'none'; };

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
    
    // USUNIĘTA FUNKCJA handleSwitchGoogleAccount i nasłuchiwanie na chrome.runtime.onMessage

    // Event Listeners
    document.addEventListener('click', (e) => {
        if (!addTaskWrapper.contains(e.target) && taskInput.value.trim() === '' && !e.target.closest('.custom-dropdown-container')) {
            addTaskWrapper.classList.remove('focused');
        }
        if (!e.target.closest('.inline-editor') && !e.target.closest('.task-detail-item')) {
            removeActiveInlineEditors();
        }
        if (!e.target.closest('#custom-dropdown-container')) {
            closeListDropdown();
        }
        if (!e.target.closest('#sort-dropdown-container')) {
            closeSortDropdown();
        }
        if (e.target.classList.contains('date-shortcut-btn')) {
            handleDateShortcutClick(e);
        }
    });
    
    currentListTrigger.addEventListener('click', (e) => { e.stopPropagation(); toggleListDropdown(); });
    sortTriggerBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSortDropdown(); });
    sortOptionsList.querySelectorAll('.list-option').forEach(option => {
        option.addEventListener('click', () => switchSortMode(option.dataset.sort));
    });
    addListBtn.addEventListener('click', addList);
    newListInput.addEventListener('keypress', (e) => e.key === 'Enter' && addList());
    addTaskBtn.addEventListener('click', addTask);
    taskInput.addEventListener('keypress', (e) => e.key === 'Enter' && addTask());
    taskInput.addEventListener('focus', () => addTaskWrapper.classList.add('focused'));
    toggleCompletedBtn.addEventListener('click', async () => { showCompleted = !showCompleted; toggleCompletedBtn.classList.toggle('active', showCompleted); render(await getStorage()); });
    completedTasksToggle.addEventListener('click', () => completedTasksSection.classList.toggle('collapsed'));
    editForm.addEventListener('submit', handleSaveEdit);
    cancelEditBtn.addEventListener('click', closeEditModal);
    clearDateBtn.addEventListener('click', () => {
        editTaskDueDate.value = '';
        editTaskDueTime.value = '';
    });
    clearTimeBtn.addEventListener('click', () => {
        editTaskDueTime.value = '';
    });
    modal.addEventListener('click', (e) => { if (e.target === modal) closeEditModal(); });
});