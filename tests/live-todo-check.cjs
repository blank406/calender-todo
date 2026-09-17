const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');

const email = process.env.CATEGORY_TEST_EMAIL;
const password = process.env.CATEGORY_TEST_PASSWORD;
if (!email || !password) throw new Error('CATEGORY_TEST_EMAIL and CATEGORY_TEST_PASSWORD are required.');

(async () => {
    const output = path.resolve('tests/visual-output');
    const profile = path.join(output, 'live-todo-browser-profile');
    fs.mkdirSync(output, { recursive: true });
    const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
        '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9342',
        `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore', windowsHide: true });
    let socket;
    let evaluate;
    let send;
    const prefix = `codex-todo-${Date.now()}`;
    try {
        let tabs;
        for (let i = 0; i < 60; i++) {
            try { tabs = await (await fetch('http://127.0.0.1:9342/json')).json(); if (tabs.length) break; } catch {}
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (!tabs?.length) throw new Error('Headless browser did not start.');
        socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
        await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        let sequence = 0;
        const pending = new Map();
        socket.onmessage = event => {
            const message = JSON.parse(event.data);
            if (!pending.has(message.id)) return;
            const callbacks = pending.get(message.id); pending.delete(message.id);
            message.error ? callbacks.reject(new Error(message.error.message)) : callbacks.resolve(message.result);
        };
        send = (method, params = {}) => new Promise((resolve, reject) => {
            const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
        });
        evaluate = async expression => {
            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
            return result.result.value;
        };
        const waitFor = async (expression, message, attempts = 160) => {
            for (let i = 0; i < attempts; i++) {
                if (await evaluate(expression)) return;
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            const diagnostic = await evaluate(`({todoStatus:document.querySelector('#storageStatus')?.textContent,categoryStatus:document.querySelector('#categoryStatus')?.textContent,todoReady:globalThis.todoReady,todoBusy:globalThis.todoBusy})`);
            throw new Error(`${message} ${JSON.stringify(diagnostic)}`);
        };
        const setDate = async (year, day) => evaluate(`currentYear=${year};currentMonth=8;selectedDate=new Date(${year},8,${day});showSelectedDate();renderCalendar()`);
        const add = async (text, year, day) => {
            await setDate(year, day);
            await evaluate(`todoInput.value=${JSON.stringify(text)};document.querySelector('#addTodoButton').click()`);
            await waitFor(`Object.values(todos).flat().some(todo=>todo.text===${JSON.stringify(text)})&&!todoBusy`, `Todo INSERT failed for ${text}.`);
            return evaluate(`Object.values(todos).flat().find(todo=>todo.text===${JSON.stringify(text)}).id`);
        };
        const openMenuFor = async text => evaluate(`(()=>{const row=[...document.querySelectorAll('.todo-item')].find(node=>node.querySelector('.todo-text')?.textContent===${JSON.stringify(text)});if(!row)return false;row.querySelector('.todo-more').click();return true})()`);

        await send('Page.enable');
        await send('Page.navigate', { url: pathToFileURL(path.resolve('index.html')).href });
        await waitFor("document.readyState === 'complete' && !document.querySelector('#authFields').disabled", 'Auth did not initialize.');
        await evaluate(`document.querySelector('#openAuthButton').click();document.querySelector('#authEmail').value=${JSON.stringify(email)};document.querySelector('#authPassword').value=${JSON.stringify(password)};document.querySelector('#authSubmitButton').click()`);
        await waitFor("!document.querySelector('#authSignedIn').hidden && categoryReady && todoReady", 'Login or initial data load failed.');

        const setup = await evaluate(`(async()=>{
            let year=2091;
            while(year<2120){const {data,error}=await categoryClient.from('todos').select('id').eq('user_id',categoryUserId).in('todo_date',[year+'-09-15',year+'-09-16']);if(error)return {error:error.code||error.message};if(!data.length)break;year++;}
            const {data,error}=await categoryClient.from('categories').insert({name:${JSON.stringify(prefix.slice(0, 30))},color:'#b879e8',user_id:categoryUserId}).select(CATEGORY_COLUMNS).single();
            if(error)return {error:error.code||error.message};globalThis.__liveTodoCategoryId=data.id;await loadCategories();activeCategoryId=data.id;renderCategories();return {year,categoryId:data.id,userId:categoryUserId};
        })()`);
        assert.equal(setup.error, undefined);
        assert.ok(setup.categoryId);
        const year = setup.year;
        const first = `${prefix}-first`;
        const firstId = await add(first, year, 15);
        const inserted = await evaluate(`(async()=>{const {data,error}=await categoryClient.from('todos').select(TODO_COLUMNS).eq('id',${JSON.stringify(firstId)}).eq('user_id',categoryUserId).single();return {error:error?.code||null,user:data?.user_id,date:data?.todo_date,category:data?.category_id,completed:data?.completed};})()`);
        assert.deepEqual(inserted, { error: null, user: setup.userId, date: `${year}-09-15`, category: setup.categoryId, completed: false });

        await send('Page.reload');
        await waitFor("document.readyState === 'complete' && !document.querySelector('#authSignedIn').hidden && categoryReady && todoReady", 'Session or Todo data did not restore after refresh.');
        await waitFor(`Object.values(todos).flat().some(todo=>todo.id===${JSON.stringify(firstId)})`, 'Inserted Todo did not restore after refresh.');
        await setDate(year, 15);
        await evaluate(`(()=>{const row=[...document.querySelectorAll('.todo-item')].find(node=>node.querySelector('.todo-text')?.textContent===${JSON.stringify(first)});row.querySelector('.todo-checkbox').click()})()`);
        await waitFor(`Object.values(todos).flat().find(todo=>todo.id===${JSON.stringify(firstId)})?.completed===true&&!todoBusy`, 'Todo check failed.');
        assert.equal(await evaluate(`(async()=>{const {data}=await categoryClient.from('todos').select('completed').eq('id',${JSON.stringify(firstId)}).single();return data.completed})()`), true);
        await evaluate(`(()=>{const row=[...document.querySelectorAll('.todo-item')].find(node=>node.querySelector('.todo-text')?.textContent===${JSON.stringify(first)});row.querySelector('.todo-checkbox').click()})()`);
        await waitFor(`Object.values(todos).flat().find(todo=>todo.id===${JSON.stringify(firstId)})?.completed===false&&!todoBusy`, 'Todo uncheck failed.');

        assert.equal(await openMenuFor(first), true);
        await evaluate(`document.querySelector('#openMoveTodoButton').click();moveDate=new Date(${year},8,16);renderMoveCalendar();document.querySelector('#confirmMoveTodoButton').click()`);
        await waitFor(`todos[${JSON.stringify(`${year}-09-16`)}]?.some(todo=>todo.id===${JSON.stringify(firstId)})&&!todoBusy`, 'Todo move failed.');
        assert.equal(await evaluate(`(async()=>{const {data}=await categoryClient.from('todos').select('todo_date').eq('id',${JSON.stringify(firstId)}).single();return data.todo_date})()`), `${year}-09-16`);
        await setDate(year, 16);
        assert.equal(await openMenuFor(first), true);
        await evaluate(`document.querySelector('#deleteMenuTodoButton').click()`);
        await waitFor(`!Object.values(todos).flat().some(todo=>todo.id===${JSON.stringify(firstId)})&&!todoBusy`, 'Individual Todo delete failed.');
        assert.equal(await evaluate(`(async()=>{const {data}=await categoryClient.from('todos').select('id').eq('id',${JSON.stringify(firstId)});return data.length})()`), 0);

        const bulkA = `${prefix}-bulk-a`, bulkB = `${prefix}-bulk-b`, keep = `${prefix}-keep`;
        await add(bulkA, year, 15);
        await add(bulkB, year, 15);
        const keepId = await add(keep, year, 16);
        await setDate(year, 15);
        await evaluate(`document.querySelector('#deleteAllTodosButton').click();document.querySelector('#confirmDeleteAllTodosButton').click()`);
        await waitFor(`!todos[${JSON.stringify(`${year}-09-15`)}]&&!todoBusy`, 'Bulk Todo delete failed.');
        const afterBulk = await evaluate(`(async()=>{const {data,error}=await categoryClient.from('todos').select('id,todo_date,text').eq('user_id',categoryUserId).in('todo_date',[${JSON.stringify(`${year}-09-15`)},${JSON.stringify(`${year}-09-16`)}]);return {error:error?.code||null,rows:data};})()`);
        assert.equal(afterBulk.error, null);
        assert.deepEqual(afterBulk.rows.map(row => [row.id, row.todo_date, row.text]), [[keepId, `${year}-09-16`, keep]]);

        await evaluate(`document.querySelector('#openAuthButton').click();document.querySelector('#authLogoutButton').click()`);
        await waitFor("document.querySelector('#authSignedIn').hidden && categoryUserId === null", 'Logout did not finish.');
        const locked = await evaluate(`({todoCount:Object.keys(todos).length,categoryCount:categories.length,inputDisabled:todoInput.disabled,addDisabled:document.querySelector('#addTodoButton').disabled})`);
        assert.deepEqual(locked, { todoCount: 0, categoryCount: 0, inputDisabled: true, addDisabled: true });

        await evaluate(`document.querySelector('#authEmail').value=${JSON.stringify(email)};document.querySelector('#authPassword').value=${JSON.stringify(password)};document.querySelector('#authSubmitButton').click()`);
        await waitFor("!document.querySelector('#authSignedIn').hidden && categoryReady && todoReady", 'Second login failed.');
        await waitFor(`todos[${JSON.stringify(`${year}-09-16`)}]?.some(todo=>todo.id===${JSON.stringify(keepId)})`, 'Remaining Todo did not restore after second login.');
        const cleanup = await evaluate(`(async()=>{const deleted=await categoryClient.from('todos').delete().eq('id',${JSON.stringify(keepId)}).eq('user_id',categoryUserId).select('id');const category=await categoryClient.from('categories').delete().eq('id',globalThis.__liveTodoCategoryId||${JSON.stringify(setup.categoryId)}).eq('user_id',categoryUserId).select('id');return {todoError:deleted.error?.code||null,categoryError:category.error?.code||null};})()`);
        assert.deepEqual(cleanup, { todoError: null, categoryError: null });

        process.stdout.write(JSON.stringify({ login: 'ok', insert: 'ok', userId: 'ok', todoDate: 'ok', categoryId: 'ok', refresh: 'ok', check: 'ok', uncheck: 'ok', move: 'ok', individualDelete: 'ok', bulkDeleteOnlyDate: 'ok', logoutLock: 'ok', reloginRestore: 'ok', cleanup: 'ok', isolatedYear: year }, null, 2));
        await send('Browser.close');
    } finally {
        if (evaluate) {
            try {
                await evaluate(`(async()=>{if(typeof categoryClient==='undefined'||!categoryClient||!categoryUserId)return;await categoryClient.from('todos').delete().eq('user_id',categoryUserId).like('text',${JSON.stringify(prefix + '%')});if(globalThis.__liveTodoCategoryId)await categoryClient.from('categories').delete().eq('id',globalThis.__liveTodoCategoryId).eq('user_id',categoryUserId);})()`);
            } catch {}
        }
        if (socket) socket.close();
        browser.kill();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
