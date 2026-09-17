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
    const profile = path.join(output, 'live-browser-profile');
    fs.mkdirSync(output, { recursive: true });
    const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
        '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9341',
        `--user-data-dir=${profile}`, 'about:blank'
    ], { stdio: 'ignore', windowsHide: true });
    let socket;
    let evaluate;
    let send;
    try {
        let tabs;
        for (let i = 0; i < 60; i++) {
            try { tabs = await (await fetch('http://127.0.0.1:9341/json')).json(); if (tabs.length) break; } catch {}
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
        const waitFor = async (expression, message, attempts = 120) => {
            for (let i = 0; i < attempts; i++) {
                if (await evaluate(expression)) return;
                await new Promise(resolve => setTimeout(resolve, 150));
            }
            throw new Error(message);
        };

        await send('Page.enable');
        await send('Page.navigate', { url: pathToFileURL(path.resolve('index.html')).href });
        await waitFor("document.readyState === 'complete' && !document.querySelector('#authFields').disabled", 'Auth did not initialize.');
        await evaluate(`document.querySelector('#openAuthButton').click();document.querySelector('#authEmail').value=${JSON.stringify(email)};document.querySelector('#authPassword').value=${JSON.stringify(password)};document.querySelector('#authSubmitButton').click()`);
        await waitFor("!document.querySelector('#authSignedIn').hidden && typeof categoryReady !== 'undefined' && categoryReady", 'Login or category load failed.');

        const name = `codex-live-${Date.now()}`;
        await evaluate(`openCategoryForm();categoryName.value=${JSON.stringify(name)};selectedColor='#b879e8';document.querySelector('#categoryForm').requestSubmit()`);
        await waitFor(`categories.some(category => category.name === ${JSON.stringify(name)})`, 'Category INSERT did not reach the UI.');
        const inserted = await evaluate(`(()=>{const row=categories.find(category=>category.name===${JSON.stringify(name)});globalThis.__liveCategoryId=row?.id;return {hasId:!!row?.id,ownerMatches:row?.user_id===categoryUserId,color:row?.color};})()`);
        assert.deepEqual(inserted, { hasId: true, ownerMatches: true, color: '#b879e8' });

        await send('Page.reload');
        await waitFor("document.readyState === 'complete' && !document.querySelector('#authSignedIn').hidden && typeof categoryReady !== 'undefined' && categoryReady", 'Session or categories did not restore after refresh.');
        await waitFor(`categories.some(category => category.name === ${JSON.stringify(name)})`, 'Inserted category did not survive refresh.');
        const updatedName = name + '-edit';
        await evaluate(`(()=>{const row=categories.find(category=>category.name===${JSON.stringify(name)});globalThis.__liveCategoryId=row.id;openCategoryForm(row);categoryName.value=${JSON.stringify(updatedName)};selectedColor='#4ecdb5';document.querySelector('#categoryForm').requestSubmit();})()`);
        try {
            await waitFor(`categories.some(category => category.id === globalThis.__liveCategoryId && category.name === ${JSON.stringify(updatedName)} && category.color === '#4ecdb5')`, 'Category UPDATE did not reach the UI.');
        } catch (error) {
            const diagnostic = await evaluate(`(async()=>{const {data,error}=await categoryClient.from('categories').select('id,name,color,user_id').eq('id',globalThis.__liveCategoryId);return {categoryError:document.querySelector('#categoryError').textContent,status:document.querySelector('#categoryStatus').textContent,rows:data,dbError:error&&{code:error.code,message:error.message}};})()`);
            throw new Error(`${error.message} ${JSON.stringify(diagnostic)}`);
        }

        const persisted = await evaluate(`(async()=>{const {data,error}=await categoryClient.from('categories').select('id,name,color,user_id').eq('id',globalThis.__liveCategoryId).eq('user_id',categoryUserId).single();return {error:error?.code||null,name:data?.name,color:data?.color,ownerMatches:data?.user_id===categoryUserId};})()`);
        assert.deepEqual(persisted, { error: null, name: updatedName, color: '#4ecdb5', ownerMatches: true });

        await evaluate(`openCategoryForm(categories.find(category=>category.id===globalThis.__liveCategoryId));document.querySelector('#confirmDeleteCategoryButton').click()`);
        await waitFor("!categories.some(category => category.id === globalThis.__liveCategoryId)", 'Category DELETE did not reach the UI.');
        const remaining = await evaluate(`(async()=>{const {data,error}=await categoryClient.from('categories').select('id').eq('id',globalThis.__liveCategoryId);return {error:error?.code||null,count:data?.length};})()`);
        assert.deepEqual(remaining, { error: null, count: 0 });
        delete globalThis.__liveCategoryId;

        await evaluate("document.querySelector('#openAuthButton').click();document.querySelector('#authLogoutButton').click()");
        await waitFor("document.querySelector('#authSignedIn').hidden && categoryUserId === null", 'Logout did not clear app access.');
        const loggedOut = await evaluate(`({categories:categories.length,todoDisabled:document.querySelector('#todoInput').disabled,manageDisabled:document.querySelector('#manageCategoriesButton').disabled,status:document.querySelector('#categoryStatus').textContent})`);
        assert.equal(loggedOut.categories, 0);
        assert.equal(loggedOut.todoDisabled, true);
        assert.equal(loggedOut.manageDisabled, true);
        assert.match(loggedOut.status, /로그인/);
        process.stdout.write(JSON.stringify({ login: 'ok', insert: 'ok', userId: 'ok', refresh: 'ok', updateName: 'ok', updateColor: 'ok', delete: 'ok', logoutLock: 'ok', cleanup: 'ok' }, null, 2));
        await send('Browser.close');
    } finally {
        if (evaluate) {
            try {
                await evaluate(`(async()=>{if(globalThis.__liveCategoryId&&typeof categoryClient!=='undefined'&&categoryUserId){await categoryClient.from('categories').delete().eq('id',globalThis.__liveCategoryId).eq('user_id',categoryUserId)}})()`);
            } catch {}
        }
        if (socket) socket.close();
        browser.kill();
    }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
