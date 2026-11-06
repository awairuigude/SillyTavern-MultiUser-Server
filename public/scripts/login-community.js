const form = document.getElementById('communityRegistration');
const openButton = document.getElementById('openInviteRegistration');
const message = document.getElementById('registrationMessage');
let restored = [];

function setRegistrationMessage(text, status = 'error') {
    message.dataset.status = status;
    message.textContent = text;
}

function closeRegistration() {
    form.hidden = true;
    openButton.hidden = false;
    for (const [element, display] of restored) element.style.display = display;
    restored = [];
}

openButton.addEventListener('click', () => {
    restored = ['userListBlock', 'normalLoginPrompt', 'discreetLoginPrompt', 'errorMessage'].map(id => {
        const element = document.getElementById(id);
        const previous = element.style.display;
        element.style.display = 'none';
        return [element, previous];
    });
    openButton.hidden = true;
    form.hidden = false;
    setRegistrationMessage('', 'pending');
    form.elements.handle.focus();
});

document.getElementById('cancelInviteRegistration').addEventListener('click', closeRegistration);

form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.confirm) {
        setRegistrationMessage('两次输入的密码不一致。');
        return;
    }
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    setRegistrationMessage('正在创建账户…', 'pending');
    try {
        const tokenResponse = await fetch('/csrf-token');
        if (!tokenResponse.ok) throw new Error('无法连接服务器，请刷新后重试。');
        const { token } = await tokenResponse.json();
        const response = await fetch('/api/community/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
            body: JSON.stringify({ handle: values.handle, name: values.name, password: values.password, invite: values.invite }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '注册失败，请重试。');
        form.reset();
        closeRegistration();
        document.getElementById('userHandle').value = data.handle;
        const loginMessage = document.getElementById('errorMessage');
        loginMessage.dataset.status = 'success';
        loginMessage.textContent = `注册成功！请使用用户名 ${data.handle} 和刚设置的密码登录。`;
        // Refresh the account picker if discreet login is disabled.
        if (document.getElementById('handleEntryBlock').style.display === 'none') {
            window.location.assign(`/login?registered=${encodeURIComponent(data.handle)}`);
        }
    } catch (error) {
        setRegistrationMessage(error.message);
    } finally {
        submit.disabled = false;
    }
});

fetch('/api/community/registration')
    .then(response => response.ok ? response.json() : { enabled: false })
    .then(data => { openButton.hidden = !data.enabled; })
    .catch(() => { openButton.hidden = true; });
