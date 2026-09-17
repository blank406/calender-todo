(() => {
    const FONT_STORAGE_KEY = 'calendarTodoFont';
    const choices = new Set(['default', 'concon', 'positive']);
    const dialog = document.getElementById('settingsDialog');
    const select = document.getElementById('fontPreference');
    const status = document.getElementById('fontSettingsStatus');

    function applyFont(value) {
        const selected = choices.has(value) ? value : 'default';
        document.documentElement.dataset.appFont = selected;
        select.value = selected;
    }

    function loadFont() {
        try {
            return localStorage.getItem(FONT_STORAGE_KEY) || 'default';
        } catch {
            status.textContent = '저장된 폰트 설정을 불러오지 못했습니다.';
            return 'default';
        }
    }

    applyFont(loadFont());

    select.addEventListener('change', () => {
        applyFont(select.value);
        status.textContent = '';
        try {
            localStorage.setItem(FONT_STORAGE_KEY, select.value);
        } catch {
            status.textContent = '폰트 설정을 저장하지 못했습니다.';
        }
    });

    document.getElementById('openSettingsButton').addEventListener('click', () => dialog.showModal());
    document.getElementById('closeSettingsButton').addEventListener('click', () => dialog.close());
})();
