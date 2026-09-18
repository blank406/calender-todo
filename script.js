const byId = id => document.getElementById(id);
const calendar = byId('calendar');
const calendarTitle = byId('calendarTitle');
const selectedDateText = byId('selectedDate');
const todoInput = byId('todoInput');
const todoList = byId('todoList');
const categoryName = byId('categoryName');

const COLORS = ['#b879e8', '#f47f91', '#4ecdb5', '#e397d8', '#f3ca50', '#6bb9ed'];
let categories = [];
let todos = Object.create(null);
let selectedDate = new Date();
let currentYear = selectedDate.getFullYear();
let currentMonth = selectedDate.getMonth();
let activeCategoryId = categories[0]?.id ?? null;
let editingCategoryId = null;
let selectedColor = COLORS[0];
let pendingDeleteDate = null;
let movingTodo = null;
let editingTodo = null;
let movingSource = null;
let moveDate = null;
let moveMonth = new Date();
let categoryClient = null;
let categoryUserId = null;
let categoryLoading = false;
let categoryReady = false;
let categoryBusy = false;
let categoryVersion = 0;
let todoLoading = false;
let todoReady = false;
let todoBusy = false;
const CATEGORY_COLUMNS = 'id,name,color,user_id,created_at';
const TODO_COLUMNS = 'id,todo_date,text,completed,category_id,user_id,created_at';

function categoryStatus(message, retry = false) {
    byId('categoryStatus').textContent = message;
    byId('retryCategoriesButton').hidden = !retry;
}

function renderCategoryAccess() {
    const locked = !categoryUserId || !categoryReady || categoryLoading || categoryBusy;
    byId('manageCategoriesButton').disabled = locked;
    byId('addCategoryButton').disabled = locked;
    byId('categoryFields').disabled = locked;
    byId('categoryForm').setAttribute('aria-busy', String(categoryBusy));
    renderTodoAccess();
}

function todoStatus(message, retry = false) {
    byId('storageStatus').textContent = message;
    byId('storageStatus').hidden = !message;
    byId('retryTodosButton').hidden = !retry;
}

function renderTodoAccess() {
    const locked = !categoryUserId || !todoReady || todoLoading || todoBusy;
    todoInput.disabled = locked;
    byId('addTodoButton').disabled = locked;
    byId('confirmDeleteAllTodosButton').disabled = locked;
    byId('deleteMenuTodoButton').disabled = locked;
    byId('openMoveTodoButton').disabled = locked;
    byId('openEditTodoButton').disabled = locked;
    byId('editTodoInput').disabled = locked;
    byId('saveEditTodoButton').disabled = locked;
    byId('cancelEditTodoButton').disabled = todoBusy;
    byId('editTodoForm').setAttribute('aria-busy', String(todoBusy));
    byId('confirmMoveTodoButton').disabled = locked || !moveDate || formatDateKey(moveDate) === movingSource;
}

function refreshCategoryUI() {
    renderCategories();
    renderTodos();
    renderCalendar();
    renderCategoryAccess();
}

function categoryErrorMessage(error) {
    if (error?.code === '23503') return '연결된 데이터 때문에 삭제할 수 없습니다. 기존 데이터베이스의 삭제 정책을 확인해주세요.';
    if (error?.code === '23505') return '같은 카테고리가 이미 존재합니다. 이름을 확인해주세요.';
    if (error?.code === '42501') return '카테고리 DB 권한이 없습니다. categories 테이블의 authenticated 권한과 RLS 정책을 확인해주세요.';
    if (error?.code === 'PGRST301') return '로그인 세션이 만료되었습니다. 다시 로그인해주세요.';
    return '카테고리 요청에 실패했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.';
}

async function loadCategories() {
    if (!categoryUserId || !categoryClient || categoryLoading || categoryBusy) return;
    const version = categoryVersion;
    const userId = categoryUserId;
    categoryLoading = true;
    categoryStatus('카테고리를 불러오는 중…');
    renderCategoryAccess();
    try {
        const { data, error } = await categoryClient.from('categories')
            .select(CATEGORY_COLUMNS).eq('user_id', userId)
            .order('created_at', { ascending: true }).order('id', { ascending: true });
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!Array.isArray(data) || data.some(row => row.user_id !== userId)) throw new Error('Invalid category ownership');
        categories = data;
        categoryReady = true;
        categoryStatus(categories.length ? '' : '아직 카테고리가 없습니다. + 버튼으로 추가하세요.');
    } catch (error) {
        if (version === categoryVersion) categoryStatus(categoryErrorMessage(error), true);
    } finally {
        if (version === categoryVersion) {
            categoryLoading = false;
            refreshCategoryUI();
        }
    }
}

function todoErrorMessage(error) {
    if (error?.code === '23503') return '선택한 카테고리를 사용할 수 없습니다. 카테고리를 다시 확인해주세요.';
    if (error?.code === '42501') return 'Todo DB 권한이 없습니다. todos 테이블의 authenticated 권한과 RLS 정책을 확인해주세요.';
    if (error?.code === 'PGRST301') return '로그인 세션이 만료되었습니다. 다시 로그인해주세요.';
    return '할 일 요청에 실패했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.';
}

function todoFromRow(row) {
    return {
        id: row.id,
        todo_date: row.todo_date,
        text: row.text,
        completed: row.completed === true,
        categoryId: row.category_id ?? null,
        user_id: row.user_id,
        created_at: row.created_at
    };
}

async function loadTodos() {
    if (!categoryUserId || !categoryClient || todoLoading || todoBusy) return;
    const version = categoryVersion;
    const userId = categoryUserId;
    todoLoading = true;
    todoReady = false;
    todoStatus('할 일을 불러오는 중…');
    renderTodoAccess();
    try {
        const { data, error } = await categoryClient.from('todos')
            .select(TODO_COLUMNS).eq('user_id', userId)
            .order('todo_date', { ascending: true })
            .order('created_at', { ascending: true }).order('id', { ascending: true });
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!Array.isArray(data) || data.some(row => row.user_id !== userId || !/^\d{4}-\d{2}-\d{2}$/.test(row.todo_date))) {
            throw new Error('Invalid todo data');
        }
        const loaded = Object.create(null);
        for (const row of data) (loaded[row.todo_date] ||= []).push(todoFromRow(row));
        todos = loaded;
        todoReady = true;
        todoStatus('');
    } catch (error) {
        if (version === categoryVersion) todoStatus(todoErrorMessage(error), true);
    } finally {
        if (version === categoryVersion) {
            todoLoading = false;
            refreshCategoryUI();
        }
    }
}

globalThis.calendarCategoryController = {
    setSession(client, user) {
        const nextUserId = user?.id ?? null;
        if (categoryUserId === nextUserId && categoryClient === client) return;
        categoryVersion++;
        categoryClient = client;
        categoryUserId = nextUserId;
        categories = [];
        todos = Object.create(null);
        categoryLoading = false;
        categoryReady = false;
        categoryBusy = false;
        todoLoading = false;
        todoReady = false;
        todoBusy = false;
        activeCategoryId = null;
        todoInput.value = '';
        categoryName.value = '';
        byId('categoryError').textContent = '';
        todoStatus(categoryUserId ? '할 일을 불러오는 중…' : '로그인 후 이용해주세요.');
        closeCategoryForm();
        cancelBulkDelete();
        closeTodoMenu();
        closeTodoEditor();
        byId('categoryDialog').hidePopover();
        byId('moveTodoDialog').close();
        byId('moveTodoText').textContent = '';
        byId('moveCalendar').replaceChildren();
        movingTodo = null;
        movingSource = null;
        moveDate = null;
        categoryStatus(categoryUserId ? '카테고리를 불러오는 중…' : '로그인 후 이용해주세요.');
        refreshCategoryUI();
        if (!categoryUserId) return Promise.resolve();
        return Promise.allSettled([loadCategories(), loadTodos()]);
    }
};
byId('retryCategoriesButton').addEventListener('click', loadCategories);
byId('retryTodosButton').addEventListener('click', loadTodos);

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function button(className, text, action, label) {
    const node = element('button', className, text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    node.addEventListener('click', action);
    return node;
}
function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function decorateDay(node, date) {
    const items = categoryUserId ? todos[formatDateKey(date)] || [] : [];
    node.classList.toggle('today', formatDateKey(date) === formatDateKey(new Date()));
    node.classList.toggle('has-todos', items.length > 0);
    node.classList.toggle('all-completed', items.length > 0 && items.every(t => t.completed));
    const counts = categories.map(c => ({ ...c, count: items.filter(t => t.categoryId === c.id).length }));
    const representative = counts.reduce((best, c) => c.count > (best?.count || 0) ? c : best, null);
    node.classList.toggle('mixed-categories', counts.filter(c => c.count > 0).length > 1);
    if (items.length) node.style.setProperty('--indicator-color', representative?.color || '#a29aaf');
}
function buildCalendar(container, year, month, selection, select) {
    container.replaceChildren();
    for (let i = 0; i < new Date(year, month, 1).getDay(); i++) container.appendChild(element('div'));
    const last = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= last; day++) {
        const date = new Date(year, month, day);
        const node = button('date', day, () => select(date), `${year}년 ${month + 1}월 ${day}일`);
        const selected = !!selection && formatDateKey(date) === formatDateKey(selection);
        node.classList.toggle('selected', selected);
        node.setAttribute('aria-pressed', String(selected));
        decorateDay(node, date);
        container.appendChild(node);
    }
}
function renderCalendar() {
    renderMonthNavigation();
    calendarTitle.textContent = `${currentYear}년 ${currentMonth + 1}월`;
    buildCalendar(calendar, currentYear, currentMonth, selectedDate, date => {
        selectedDate = date;
        showSelectedDate();
        renderCalendar();
    });
}
function renderMonthNavigation() {
    byId('navigationYear').textContent = currentYear;
    byId('monthList').replaceChildren();
    for (let month = 0; month < 12; month++) {
        const item = button('month-button', undefined, () => {
            currentMonth = month;
            cancelBulkDelete();
            renderCalendar();
        }, `${currentYear}년 ${month + 1}월`);
        item.setAttribute('aria-pressed', String(month === currentMonth));
        const prefix = `${currentYear}-${String(month + 1).padStart(2, '0')}-`;
        const count = Object.entries(categoryUserId ? todos : {}).reduce((sum, [key, items]) => sum + (key.startsWith(prefix) ? items.length : 0), 0);
        item.append(element('span', '', `${month + 1}월`), element('span', 'month-count', count || '—'));
        byId('monthList').appendChild(item);
    }
}
function cancelBulkDelete() {
    pendingDeleteDate = null;
    byId('deleteAllTodosConfirm').hidden = true;
    byId('deleteAllTodosButton').setAttribute('aria-expanded', 'false');
}
function showSelectedDate() {
    const weekdays = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
    selectedDateText.textContent = `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일 ${weekdays[selectedDate.getDay()]}`;
    cancelBulkDelete();
    renderCategories();
    renderTodos();
}
function categoryDot(category) {
    const dot = element('span', 'category-dot');
    dot.style.backgroundColor = category?.color || '#a29aaf';
    dot.title = category?.name || '카테고리 없음';
    return dot;
}
function renderCategories() {
    if (!categories.some(category => category.id === activeCategoryId)) {
        activeCategoryId = categories[0]?.id ?? null;
    }
    const list = byId('categoryList');
    const management = byId('categoryManagementList');
    list.replaceChildren();
    management.replaceChildren();
    const items = todos[formatDateKey(selectedDate)] || [];
    for (const category of categories) {
        const row = element('div', 'category-row');
        row.classList.toggle('active', category.id === activeCategoryId);
        const filter = button('category-filter', undefined, () => {
            if (!categoryUserId || categoryBusy) return;
            activeCategoryId = category.id;
            renderCategories();
        });
        filter.setAttribute('aria-pressed', String(category.id === activeCategoryId));
        filter.title = `${category.name}에 새 할 일 추가`;
        filter.append(categoryDot(category), element('span', 'category-label', category.name),
            element('span', 'category-count', items.filter(t => t.categoryId === category.id).length));
        row.appendChild(filter);
        list.appendChild(row);
        if (category.id !== null) {
            const managementRow = element('div', 'category-management-row');
            managementRow.append(categoryDot(category), element('span', 'category-management-name', category.name),
                button('category-edit', '편집', () => openCategoryForm(category), `${category.name} 편집`));
            management.appendChild(managementRow);
        }
    }
}
function renderTodos() {
    todoList.replaceChildren();
    if (!categoryUserId) {
        byId('deleteAllTodosButton').disabled = true;
        todoList.appendChild(element('p', 'empty-message', '로그인 후 할 일을 확인할 수 있습니다.'));
        return;
    }
    if (!todoReady) {
        byId('deleteAllTodosButton').disabled = true;
        todoList.appendChild(element('p', 'empty-message', todoLoading ? '할 일을 불러오는 중…' : '할 일을 불러오지 못했습니다.'));
        return;
    }
    const key = formatDateKey(selectedDate);
    const items = todos[key] || [];
    const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
    const sortedItems = [...items].sort((a, b) =>
        (categoryOrder.get(a.categoryId) ?? categories.length) -
        (categoryOrder.get(b.categoryId) ?? categories.length));
    byId('deleteAllTodosButton').disabled = items.length === 0 || todoBusy;
    if (!items.length) todoList.appendChild(element('p', 'empty-message', '이 날짜의 할 일이 없습니다.'));
    for (const todo of sortedItems) {
        const row = element('div', 'todo-item');
        const check = button('todo-checkbox', todo.completed ? '✓' : '', () => updateTodoCompleted(key, todo), `${todo.text} 완료`);
        check.disabled = todoBusy;
        check.classList.toggle('checked', todo.completed);
        check.setAttribute('aria-pressed', String(todo.completed));
        const label = element('span', 'todo-text', todo.text);
        label.classList.toggle('completed', todo.completed);
        row.append(check, categoryDot(categories.find(c => c.id === todo.categoryId)), label,
            button('todo-more', '⋯', event => {
                if (!categoryUserId || todoBusy || editingTodo || !todos[key]?.includes(todo)) return;
                movingTodo = todo;
                movingSource = key;
                const menu = byId('todoMenu');
                const trigger = event.currentTarget.getBoundingClientRect();
                menu.showPopover();
                const bounds = menu.getBoundingClientRect();
                const left = Math.max(8, Math.min(trigger.right - bounds.width, innerWidth - bounds.width - 8));
                const below = trigger.bottom + 6;
                const top = below + bounds.height <= innerHeight - 8
                    ? below : Math.max(8, trigger.top - bounds.height - 6);
                menu.style.left = `${left}px`;
                menu.style.top = `${top}px`;
            }, `${todo.text} 더 보기`));
        todoList.appendChild(row);
    }
}
function removeTodo(key, todo) {
    if (!categoryUserId) return false;
    const index = todos[key]?.indexOf(todo) ?? -1;
    if (index < 0) return false;
    todos[key].splice(index, 1);
    if (!todos[key].length) delete todos[key];
    return true;
}
function closeTodoMenu() {
    byId('todoMenu').hidePopover();
}
todoList.addEventListener('scroll', closeTodoMenu);
globalThis.addEventListener?.('resize', closeTodoMenu);
globalThis.addEventListener?.('scroll', closeTodoMenu);
function refreshTodoUI() {
    renderCategories();
    renderTodos();
    renderCalendar();
    renderTodoAccess();
}

async function runTodoMutation(message, action) {
    if (!categoryUserId || !todoReady || todoLoading || todoBusy) return false;
    const version = categoryVersion;
    todoBusy = true;
    todoStatus(message);
    refreshTodoUI();
    try {
        await action(categoryUserId, version);
        if (version !== categoryVersion) return false;
        todoStatus('');
        return true;
    } catch (error) {
        if (version === categoryVersion) todoStatus(todoErrorMessage(error), true);
        return false;
    } finally {
        if (version === categoryVersion) {
            todoBusy = false;
            refreshTodoUI();
        }
    }
}

async function addTodo() {
    if (!categoryUserId || !todoReady || todoLoading || todoBusy) return;
    const text = todoInput.value.trim();
    if (!text) return;
    const key = formatDateKey(selectedDate);
    const categoryId = categories.some(category => category.id === activeCategoryId) ? activeCategoryId : null;
    const succeeded = await runTodoMutation('할 일을 저장하는 중…', async (userId, version) => {
        const { data, error } = await categoryClient.from('todos').insert({
            user_id: userId,
            todo_date: key,
            text,
            completed: false,
            category_id: categoryId
        }).select(TODO_COLUMNS).single();
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!data || data.user_id !== userId || data.todo_date !== key) throw new Error('Invalid todo ownership');
        (todos[key] ||= []).push(todoFromRow(data));
    });
    if (succeeded) todoInput.value = '';
    todoInput.focus();
}

async function updateTodoCompleted(key, todo) {
    if (!todo?.id || !todos[key]?.includes(todo)) return;
    const completed = !todo.completed;
    await runTodoMutation('완료 상태를 저장하는 중…', async (userId, version) => {
        const { data, error } = await categoryClient.from('todos').update({ completed })
            .eq('id', todo.id).eq('user_id', userId).select(TODO_COLUMNS).single();
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!data || data.user_id !== userId || data.id !== todo.id) throw new Error('Invalid todo ownership');
        Object.assign(todo, todoFromRow(data));
    });
}

async function deleteTodo(key, todo) {
    if (!todo?.id || !todos[key]?.includes(todo)) return;
    await runTodoMutation('할 일을 삭제하는 중…', async (userId, version) => {
        const { data, error } = await categoryClient.from('todos').delete()
            .eq('id', todo.id).eq('user_id', userId).select('id').single();
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!data || data.id !== todo.id) throw new Error('Invalid todo ownership');
        removeTodo(key, todo);
    });
}
function closeTodoEditor() {
    editingTodo = null;
    byId('editTodoDialog').close();
    byId('editTodoInput').value = '';
    byId('editTodoError').textContent = '';
}
byId('openEditTodoButton').addEventListener('click', () => {
    if (!categoryUserId || !todoReady || todoLoading || todoBusy || editingTodo ||
        !movingTodo || movingTodo.user_id !== categoryUserId || !todos[movingSource]?.includes(movingTodo)) return;
    editingTodo = { todo: movingTodo, source: movingSource };
    closeTodoMenu();
    movingTodo = null;
    movingSource = null;
    cancelBulkDelete();
    byId('editTodoInput').value = editingTodo.todo.text;
    byId('editTodoError').textContent = '';
    byId('editTodoDialog').showModal();
    byId('editTodoInput').focus();
});
byId('cancelEditTodoButton').addEventListener('click', () => {
    if (!todoBusy) closeTodoEditor();
});
byId('editTodoDialog').addEventListener('cancel', event => {
    event.preventDefault();
    if (!todoBusy) closeTodoEditor();
});
byId('editTodoInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
});
byId('editTodoForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!categoryUserId || !todoReady || todoLoading || todoBusy || !editingTodo) return;
    const editor = editingTodo;
    const { todo, source } = editor;
    if (todo.user_id !== categoryUserId || !todos[source]?.includes(todo)) return;
    const text = byId('editTodoInput').value.trim();
    if (!text) {
        byId('editTodoError').textContent = '할 일 내용을 입력해주세요.';
        byId('editTodoInput').focus();
        return;
    }
    if (text === todo.text) { closeTodoEditor(); return; }
    byId('editTodoError').textContent = '';
    const succeeded = await runTodoMutation('할 일을 수정하는 중…', async (userId, version) => {
        const { data, error } = await categoryClient.from('todos').update({ text })
            .eq('id', todo.id).eq('user_id', userId).select('id,user_id,text').single();
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!data || data.id !== todo.id || data.user_id !== userId || data.text !== text) {
            throw new Error('Invalid todo update');
        }
        todo.text = data.text;
    });
    if (editingTodo !== editor) return;
    if (succeeded) closeTodoEditor();
    else byId('editTodoError').textContent = byId('storageStatus').textContent;
});

function renderPalette() {
    byId('categoryPalette').replaceChildren();
    for (const color of [...new Set([...COLORS, selectedColor])]) {
        const swatch = button('color-swatch', '', () => { selectedColor = color; renderPalette(); }, `색상 ${color}`);
        swatch.style.backgroundColor = color;
        swatch.setAttribute('aria-pressed', String(color === selectedColor));
        byId('categoryPalette').appendChild(swatch);
    }
}
function openCategoryForm(category) {
    if (!categoryUserId || !categoryReady || categoryLoading || categoryBusy) return;
    editingCategoryId = category?.id || null;
    categoryName.value = category?.name || '';
    categoryName.readOnly = false;
    selectedColor = category?.color || COLORS[0];
    byId('categoryFormTitle').textContent = category ? '카테고리 편집' : '카테고리 추가';
    byId('categoryForm').hidden = false;
    byId('categoryError').textContent = '';
    byId('deleteCategoryButton').hidden = !category;
    byId('categoryDeleteConfirm').hidden = true;
    renderPalette();
    categoryName.focus();
}
function closeCategoryForm() {
    editingCategoryId = null;
    byId('categoryForm').hidden = true;
    byId('categoryDeleteConfirm').hidden = true;
}
byId('categoryForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!categoryUserId || !categoryReady || categoryLoading || categoryBusy) return;
    const name = categoryName.value.trim();
    if (!name || name.length > 30) {
        byId('categoryError').textContent = '이름을 1~30자로 입력하세요.';
        return;
    }
    const id = editingCategoryId;
    const userId = categoryUserId;
    const version = categoryVersion;
    const color = selectedColor;
    categoryBusy = true;
    byId('categoryError').textContent = '';
    categoryStatus('카테고리를 저장하는 중…');
    renderCategoryAccess();
    try {
        const query = id
            ? categoryClient.from('categories').update({ name, color }).eq('id', id).eq('user_id', userId)
            : categoryClient.from('categories').insert({ name, color, user_id: userId });
        const { data, error } = await query.select(CATEGORY_COLUMNS).single();
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!data || data.user_id !== userId) throw new Error('Invalid category ownership');
        if (id) categories = categories.map(category => category.id === id ? data : category);
        else categories.push(data);
        categories.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
        closeCategoryForm();
        categoryStatus('');
    } catch (error) {
        if (version === categoryVersion) {
            byId('categoryError').textContent = categoryErrorMessage(error);
            categoryStatus(categoryErrorMessage(error), true);
        }
    } finally {
        if (version === categoryVersion) {
            categoryBusy = false;
            refreshCategoryUI();
        }
    }
});
byId('addCategoryButton').addEventListener('click', () => openCategoryForm());
byId('cancelCategoryButton').addEventListener('click', closeCategoryForm);
byId('manageCategoriesButton').addEventListener('click', () => {
    if (categoryUserId && categoryReady && !categoryLoading && !categoryBusy) byId('categoryDialog').showPopover();
});
byId('closeCategoriesButton').addEventListener('click', () => {
    closeCategoryForm();
    byId('categoryDialog').hidePopover();
    byId('manageCategoriesButton').focus();
});
byId('categoryDialog').addEventListener('toggle', event => {
    if (event.newState === 'closed') closeCategoryForm();
});
byId('deleteCategoryButton').addEventListener('click', () => {
    if (editingCategoryId) byId('categoryDeleteConfirm').hidden = false;
});
byId('cancelDeleteCategoryButton').addEventListener('click', () => { byId('categoryDeleteConfirm').hidden = true; });
byId('confirmDeleteCategoryButton').addEventListener('click', async () => {
    if (!categoryUserId || !categoryReady || categoryLoading || categoryBusy || !editingCategoryId) return;
    const id = editingCategoryId;
    const userId = categoryUserId;
    const version = categoryVersion;
    categoryBusy = true;
    byId('categoryError').textContent = '';
    categoryStatus('카테고리를 삭제하는 중…');
    renderCategoryAccess();
    try {
        // Do not alter the DB's todos table or its foreign-key policy.
        const { error } = await categoryClient.from('categories').delete()
            .eq('id', id).eq('user_id', userId).select('id').single();
        if (version !== categoryVersion) return;
        if (error) throw error;
        categories = categories.filter(category => category.id !== id);
        for (const items of Object.values(todos)) for (const todo of items) {
            if (todo.categoryId === id) todo.categoryId = null;
        }
        closeCategoryForm();
        categoryStatus('카테고리를 삭제했습니다.');
    } catch (error) {
        if (version === categoryVersion) {
            byId('categoryError').textContent = categoryErrorMessage(error);
            categoryStatus(categoryErrorMessage(error), true);
        }
    } finally {
        if (version === categoryVersion) {
            categoryBusy = false;
            refreshCategoryUI();
        }
    }
});
byId('addTodoButton').addEventListener('click', addTodo);
byId('deleteMenuTodoButton').addEventListener('click', async () => {
    if (!movingTodo || !movingSource || todoBusy) return;
    const todo = movingTodo;
    const source = movingSource;
    movingTodo = null;
    movingSource = null;
    byId('todoMenu').hidePopover();
    await deleteTodo(source, todo);
});
for (const [id, offset] of [['prevYear', -1], ['nextYear', 1]]) byId(id).addEventListener('click', () => {
    currentYear += offset;
    cancelBulkDelete();
    renderCalendar();
});
todoInput.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        addTodo();
    }
});
function moveCurrentMonth(offset) {
    const date = new Date(currentYear, currentMonth + offset, 1);
    currentYear = date.getFullYear();
    currentMonth = date.getMonth();
    cancelBulkDelete();
    renderCalendar();
}
for (const [id, offset] of [['prevMonth', -1], ['nextMonth', 1]]) {
    byId(id).addEventListener('click', () => moveCurrentMonth(offset));
}

let calendarTouchStart = null;
const isMobileCalendarTouch = () => typeof matchMedia === 'function' &&
    matchMedia('(max-width: 650px) and (pointer: coarse)').matches;
byId('calendarPanel').addEventListener('touchstart', event => {
    if (!isMobileCalendarTouch() || event.touches.length !== 1) {
        calendarTouchStart = null;
        return;
    }
    const touch = event.touches[0];
    calendarTouchStart = { x: touch.clientX, y: touch.clientY };
}, { passive: true });
byId('calendarPanel').addEventListener('touchend', event => {
    if (!calendarTouchStart || !isMobileCalendarTouch() || event.changedTouches.length !== 1) {
        calendarTouchStart = null;
        return;
    }
    const start = calendarTouchStart;
    calendarTouchStart = null;
    const touch = event.changedTouches[0];
    const horizontal = touch.clientX - start.x;
    const vertical = touch.clientY - start.y;
    if (Math.abs(horizontal) < 50 || Math.abs(horizontal) <= Math.abs(vertical)) return;
    moveCurrentMonth(horizontal < 0 ? 1 : -1);
}, { passive: true });
byId('calendarPanel').addEventListener('touchcancel', () => { calendarTouchStart = null; }, { passive: true });
byId('deleteAllTodosButton').addEventListener('click', () => {
    if (!categoryUserId) return;
    const key = formatDateKey(selectedDate);
    if (!todos[key]?.length) return;
    pendingDeleteDate = key;
    byId('deleteAllTodosMessage').textContent = `${selectedDate.getMonth() + 1}월 ${selectedDate.getDate()}일의 모든 할 일을 삭제할까요?`;
    byId('deleteAllTodosConfirm').hidden = false;
    byId('deleteAllTodosButton').setAttribute('aria-expanded', 'true');
    byId('cancelDeleteAllTodosButton').focus();
});
byId('cancelDeleteAllTodosButton').addEventListener('click', cancelBulkDelete);
byId('deleteAllTodosConfirm').addEventListener('keydown', event => {
    if (event.key === 'Escape') { cancelBulkDelete(); byId('deleteAllTodosButton').focus(); }
});
byId('confirmDeleteAllTodosButton').addEventListener('click', async () => {
    if (!categoryUserId || todoBusy || !pendingDeleteDate || pendingDeleteDate !== formatDateKey(selectedDate)) return;
    const key = pendingDeleteDate;
    const expectedIds = (todos[key] || []).map(todo => todo.id);
    const succeeded = await runTodoMutation('이 날짜의 할 일을 삭제하는 중…', async (userId, version) => {
        const { data, error } = await categoryClient.from('todos').delete()
            .eq('user_id', userId).eq('todo_date', key).select('id');
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!Array.isArray(data) || data.length !== expectedIds.length || expectedIds.some(id => !data.some(row => row.id === id))) {
            throw new Error('Todo bulk delete mismatch');
        }
        delete todos[key];
    });
    if (succeeded) cancelBulkDelete();
});
function renderMoveCalendar() {
    const year = moveMonth.getFullYear();
    const month = moveMonth.getMonth();
    byId('moveMonthTitle').textContent = `${year}년 ${month + 1}월`;
    buildCalendar(byId('moveCalendar'), year, month, moveDate, date => { moveDate = date; renderMoveCalendar(); });
    byId('confirmMoveTodoButton').disabled = todoBusy || !moveDate || formatDateKey(moveDate) === movingSource;
    byId('moveDateSummary').textContent = moveDate ? `${moveDate.getFullYear()}년 ${moveDate.getMonth() + 1}월 ${moveDate.getDate()}일` : '이동할 날짜를 선택하세요.';
}
byId('openMoveTodoButton').addEventListener('click', () => {
    if (!categoryUserId || !movingTodo || !todos[movingSource]?.includes(movingTodo)) return;
    byId('todoMenu').hidePopover();
    moveDate = null;
    moveMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    byId('moveTodoText').textContent = movingTodo.text;
    renderMoveCalendar();
    byId('moveTodoDialog').showModal();
});
for (const [id, offset] of [['movePrevMonth', -1], ['moveNextMonth', 1]]) byId(id).addEventListener('click', () => {
    moveMonth = new Date(moveMonth.getFullYear(), moveMonth.getMonth() + offset, 1);
    renderMoveCalendar();
});
byId('cancelMoveTodoButton').addEventListener('click', () => byId('moveTodoDialog').close());
byId('moveTodoDialog').addEventListener('close', () => { movingTodo = null; movingSource = null; moveDate = null; });
byId('confirmMoveTodoButton').addEventListener('click', async () => {
    if (!categoryUserId || todoBusy || !movingTodo || !moveDate) return;
    const todo = movingTodo;
    const source = movingSource;
    const destination = formatDateKey(moveDate);
    if (destination === source || !todos[source]?.includes(todo) || !todo.id) return;
    const succeeded = await runTodoMutation('할 일 날짜를 변경하는 중…', async (userId, version) => {
        const { data, error } = await categoryClient.from('todos').update({ todo_date: destination })
            .eq('id', todo.id).eq('user_id', userId).select(TODO_COLUMNS).single();
        if (version !== categoryVersion) return;
        if (error) throw error;
        if (!data || data.user_id !== userId || data.id !== todo.id || data.todo_date !== destination) {
            throw new Error('Invalid todo ownership');
        }
        removeTodo(source, todo);
        Object.assign(todo, todoFromRow(data));
        (todos[destination] ||= []).push(todo);
    });
    if (succeeded) byId('moveTodoDialog').close();
});
showSelectedDate();
renderCalendar();
renderCategoryAccess();

