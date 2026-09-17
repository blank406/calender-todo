const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../supabase.js'), 'utf8');
const signedIn = { user: { id: 'test-user', email: 'test@example.com' } };
async function boot(options = {}) {
    class Element {
        constructor() { this.events = {}; this.value = ''; this.hidden = false; this.disabled = false; this.textContent = ''; this.classList = { toggle() {} }; }
        addEventListener(name, handler) { this.events[name] = handler; }
        async fire(name) { return this.events[name]?.({ preventDefault() {} }); }
        setAttribute() {}
        focus() {}
        showModal() { this.open = true; }
        close() { this.open = false; this.fire('close'); }
        reportValidity() { return true; }
    }
    const elements = new Map();
    const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
    const calls = [];
    const store = options.store || new Map([['calendarTodos', 'untouched-todos'], ['calendarCategories', 'untouched-categories']]);
    let listener;
    let config;
    const auth = {
        onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
        async getSession() { return { data: { session: store.get('mock-session') || null }, error: null }; },
        async signUp(credentials) {
            calls.push(['signup', credentials]);
            if (options.signupError) return { error: options.signupError };
            if (options.confirmEmail) return { data: { session: null }, error: null };
            store.set('mock-session', signedIn); listener('SIGNED_IN', signedIn);
            return { data: { session: signedIn }, error: null };
        },
        async signInWithPassword(credentials) {
            calls.push(['login', credentials]);
            if (options.loginResult) return options.loginResult;
            if (options.loginError) return { error: options.loginError };
            store.set('mock-session', signedIn); listener('SIGNED_IN', signedIn);
            return { data: { session: signedIn }, error: null };
        },
        async signOut(arg) {
            calls.push(['logout', arg]);
            if (options.logoutError) return { error: options.logoutError };
            store.delete('mock-session'); listener('SIGNED_OUT', null); return { error: null };
        }
    };
    const context = vm.createContext({ URL, document: { getElementById: el },
        supabase: options.noSdk ? undefined : { createClient(url, key, settings) { config = {url,key,settings}; return {auth}; } }
    });
    vm.runInContext(source, context);
    await new Promise(resolve => setImmediate(resolve));
    return { el, calls, store, config, emit: (event, session) => listener(event, session) };
}
function fill(app) { app.el('authEmail').value = ' test@example.com '; app.el('authPassword').value = 'example-password-123'; }

test('initializes v2 with a public key and persistent sessions', async () => {
    const app = await boot();
    assert.equal(new URL(app.config.url).protocol, 'https:');
    assert.match(app.config.key, /^sb_publishable_/);
    assert.equal(app.config.settings.auth.persistSession, true);
    assert.equal(app.config.settings.auth.autoRefreshToken, true);
    assert.equal(app.el('authFields').disabled, false);
});
test('login, simulated reload and local logout do not touch Todo storage', async () => {
    const app = await boot(); fill(app);
    await app.el('authForm').fire('submit');
    assert.equal(app.calls[0][1].email, 'test@example.com');
    assert.equal(app.el('authPassword').value, '');
    assert.equal(app.el('authSignedIn').hidden, false);
    const reload = await boot({ store: app.store });
    assert.equal(reload.el('authSignedIn').hidden, false);
    assert.equal(reload.el('authUserEmail').textContent, signedIn.user.email);
    await reload.el('authLogoutButton').fire('click');
    assert.equal(reload.calls[0][1].scope, 'local');
    assert.equal(reload.el('authForm').hidden, false);
    assert.equal(app.store.get('calendarTodos'), 'untouched-todos');
    assert.equal(app.store.get('calendarCategories'), 'untouched-categories');
});
test('signup handles email confirmation without claiming an active session', async () => {
    const app = await boot({ confirmEmail: true });
    await app.el('authModeButton').fire('click'); fill(app);
    await app.el('authForm').fire('submit');
    assert.equal(app.calls[0][0], 'signup');
    assert.equal(app.el('authSignedIn').hidden, true);
    assert.match(app.el('authStatus').textContent, /이메일/);
    assert.equal(app.el('authPassword').value, '');
});
test('signup without confirmation immediately renders the authenticated account', async () => {
    const app = await boot(); await app.el('authModeButton').fire('click'); fill(app);
    await app.el('authForm').fire('submit');
    assert.equal(app.el('authSignedIn').hidden, false);
});
test('failed login and logout remain retryable and preserve the correct session', async () => {
    const app = await boot({ loginError: {code:'invalid_credentials'} }); fill(app);
    await app.el('authForm').fire('submit');
    assert.match(app.el('authStatus').textContent, /비밀번호/);
    assert.equal(app.el('authFields').disabled, false);
    const signed = await boot({store: new Map([['mock-session',signedIn]]), logoutError: {code:'network_error'}});
    await signed.el('authLogoutButton').fire('click');
    assert.equal(signed.el('authSignedIn').hidden, false);
    assert.equal(signed.el('authLogoutButton').disabled, false);
});
test('auth events update the UI and closing clears the password', async () => {
    const app = await boot();
    app.emit('SIGNED_IN',signedIn);
    assert.equal(app.el('authSignedIn').hidden,false);
    app.emit('SIGNED_OUT',null);
    assert.equal(app.el('authForm').hidden,false);
    fill(app); await app.el('closeAuthButton').fire('click');
    assert.equal(app.el('authPassword').value,'');
});
test('missing CDN module leaves a usable account dialog and disabled auth requests', async () => {
    const app = await boot({noSdk:true});
    await app.el('openAuthButton').fire('click');
    assert.equal(app.el('authDialog').open,true);
    assert.equal(app.el('authFields').disabled,true);
    assert.match(app.el('authStatus').textContent,/불러오지 못/);
});
test('duplicate submits send only one auth request', async () => {
    let finish;
    const pending = new Promise(resolve => { finish=resolve; });
    const app = await boot({loginResult:pending}); fill(app);
    const first=app.el('authForm').fire('submit');
    await app.el('authForm').fire('submit');
    assert.equal(app.calls.length,1);
    finish({data:{session:signedIn},error:null}); await first;
    assert.equal(app.el('authFields').disabled,false);
});

test('password visibility toggles in login and signup without changing input or submitting', async () => {
    const app = await boot();
    fill(app);
    assert.equal(app.el('authPassword').type, 'password');
    await app.el('toggleAuthPassword').fire('click');
    assert.equal(app.el('authPassword').type, 'text');
    assert.equal(app.el('authPassword').value, 'example-password-123');
    await app.el('toggleAuthPassword').fire('click');
    assert.equal(app.el('authPassword').type, 'password');
    await app.el('toggleAuthPassword').fire('click');
    await app.el('authModeButton').fire('click');
    assert.equal(app.el('authPassword').type, 'password');
    fill(app);
    await app.el('toggleAuthPassword').fire('click');
    assert.equal(app.el('authPassword').type, 'text');
    await app.el('closeAuthButton').fire('click');
    assert.equal(app.el('authPassword').type, 'password');
    assert.equal(app.el('authPassword').value, '');
    assert.equal(app.calls.length, 0);
});
