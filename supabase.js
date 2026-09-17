// Browser-only public credentials. Never put a service_role or secret key here.
const SUPABASE_URL = 'https://phvwkdasscxzymznhcqq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0b8QMFMZfbZ_heE51NgGYA_YV1EBf1m';

// Auth supplies the current user to category and Todo synchronization.
(() => {
    const el = id => document.getElementById(id);
    const dialog = el('authDialog');
    const form = el('authForm');
    const fields = el('authFields');
    const password = el('authPassword');
    let client = null;
    let ready = false;
    let busy = false;
    let mode = 'login';
    let session = null;
    let authRevision = 0;

    function setPasswordVisible(visible) {
        password.type = visible ? 'text' : 'password';
        const label = visible ? '비밀번호 숨기기' : '비밀번호 보기';
        el('toggleAuthPassword').setAttribute('aria-pressed', String(visible));
        el('toggleAuthPassword').setAttribute('aria-label', label);
        el('toggleAuthPassword').title = label;
    }

    el('toggleAuthPassword').addEventListener('click', () => {
        if (!ready || busy) return;
        setPasswordVisible(password.type === 'password');
    });

    function status(message, error = false) {
        el('authStatus').textContent = message;
        el('authStatus').classList.toggle('auth-error', error);
    }

    function emailRedirectUrl() {
        return new URL('./', globalThis.location.href).href;
    }

    function render() {
        if (!password.value) setPasswordVisible(false);
        const signedIn = !!session?.user;
        el('openAuthButton').textContent = signedIn ? '계정' : '로그인';
        el('openAuthButton').title = signedIn ? session.user.email || '계정' : '로그인 / 회원가입';
        el('authTitle').textContent = signedIn ? '내 계정' : mode === 'signup' ? '회원가입' : '로그인';
        form.hidden = signedIn;
        el('authSignedIn').hidden = !signedIn;
        el('authUserEmail').textContent = signedIn ? session.user.email || '' : '';
        fields.disabled = !ready || busy;
        el('authLogoutButton').disabled = !ready || busy;
        el('authSubmitButton').textContent = busy ? '처리 중…' : mode === 'signup' ? '회원가입' : '로그인';
        el('authModeButton').textContent = mode === 'signup' ? '로그인으로 전환' : '회원가입으로 전환';
        password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
        form.setAttribute('aria-busy', String(busy));
        // The controller resets access synchronously and handles DB failures itself.
        // Do not await it in an Auth state-change callback.
        globalThis.calendarCategoryController?.setSession(client, session?.user ?? null);
    }

    function errorMessage(error) {
        const messages = {
            invalid_credentials: '이메일 또는 비밀번호를 확인해주세요.',
            email_not_confirmed: '이메일 인증을 완료한 뒤 로그인해주세요.',
            user_already_exists: '이미 가입된 계정입니다. 로그인해주세요.',
            weak_password: '비밀번호가 프로젝트의 보안 기준에 맞지 않습니다. 더 긴 비밀번호를 사용해주세요.',
            over_email_send_rate_limit: '이메일 전송 요청이 많습니다. 잠시 후 다시 시도해주세요.',
            over_request_rate_limit: '요청이 많습니다. 잠시 후 다시 시도해주세요.',
            signup_disabled: '현재 회원가입이 비활성화되어 있습니다.'
        };
        return messages[error?.code] || '인증 요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해주세요.';
    }

    el('openAuthButton').disabled = false;
    el('openAuthButton').addEventListener('click', () => dialog.showModal());
    el('closeAuthButton').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { password.value = ''; setPasswordVisible(false); });
    el('authModeButton').addEventListener('click', () => {
        if (!ready || busy) return;
        mode = mode === 'login' ? 'signup' : 'login';
        password.value = '';
        status('');
        render();
        el('authEmail').focus();
    });

    el('authResendButton').addEventListener('click', async () => {
        const emailInput = el('authEmail');
        if (!ready || busy || session?.user || !emailInput.reportValidity()) return;
        busy = true;
        status('인증 메일을 요청하고 있습니다.');
        render();
        try {
            const { error } = await client.auth.resend({
                type: 'signup',
                email: emailInput.value.trim(),
                options: { emailRedirectTo: emailRedirectUrl() }
            });
            if (error) throw error;
            status('가입 기록이 있는 미인증 계정이라면 새 인증 메일을 전송했습니다.');
        } catch (error) {
            status(errorMessage(error), true);
        } finally {
            busy = false;
            render();
        }
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!ready || busy || session?.user || !form.reportValidity()) return;
        const email = el('authEmail').value.trim();
        const credentials = { email, password: password.value };
        busy = true;
        status('처리 중입니다.');
        render();
        try {
            const { data, error } = mode === 'signup'
                ? await client.auth.signUp({
                    ...credentials,
                    options: {
                        // Keep confirmation links inside the current GitHub Pages project path.
                        emailRedirectTo: emailRedirectUrl()
                    }
                })
                : await client.auth.signInWithPassword(credentials);
            if (error) throw error;
            session = data.session;
            password.value = '';
            if (session) {
                status(mode === 'signup' ? '회원가입 및 로그인이 완료되었습니다.' : '로그인되었습니다.');
            } else if (mode === 'signup') {
                mode = 'login';
                status('이메일로 가입 확인 안내가 전송되었다면 인증을 완료한 뒤 로그인해주세요.');
            } else {
                status('로그인 세션을 확인할 수 없습니다. 다시 시도해주세요.', true);
            }
        } catch (error) {
            password.value = '';
            status(errorMessage(error), true);
        } finally {
            busy = false;
            render();
        }
    });

    el('authLogoutButton').addEventListener('click', async () => {
        if (!ready || busy || !session?.user) return;
        busy = true;
        status('로그아웃 중입니다.');
        render();
        try {
            const { error } = await client.auth.signOut({ scope: 'local' });
            if (error) throw error;
            session = null;
            password.value = '';
            mode = 'login';
            status('로그아웃되었습니다.');
        } catch (error) {
            status(errorMessage(error), true);
        } finally {
            busy = false;
            render();
        }
    });

    async function initialize() {
        try {
            if (!SUPABASE_PUBLISHABLE_KEY.startsWith('sb_publishable_') || new URL(SUPABASE_URL).protocol !== 'https:') {
                throw new Error('Invalid public configuration');
            }
            if (!globalThis.supabase?.createClient) {
                status('인증 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해주세요.', true);
                return;
            }
            client = globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
            });
            // Keep the callback synchronous: never await Auth calls inside it.
            client.auth.onAuthStateChange((_event, nextSession) => {
                authRevision++;
                session = nextSession;
                password.value = '';
                if (!busy) status(session ? '로그인되어 있습니다.' : '');
                render();
            });
            const revision = authRevision;
            const { data, error } = await client.auth.getSession();
            if (error) throw error;
            if (revision === authRevision) session = data.session;
            ready = true;
            status(session ? '로그인되어 있습니다.' : '');
        } catch {
            status('인증 연결을 준비하지 못했습니다. 연결 상태를 확인하고 새로고침해주세요.', true);
        } finally {
            render();
        }
    }

    render();
    initialize();
})();
