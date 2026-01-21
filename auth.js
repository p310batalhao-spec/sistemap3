// auth.js - Controle de Sessão e Inatividade

const TIMEOUT_DURATION = 30 * 60 * 1000; // 30 minutos em milissegundos

function logout() {
    sessionStorage.clear(); // Limpa todos os dados
    window.location.href = 'login.html'; // Redireciona
}

function checkSession() {
    const isLoggedIn = sessionStorage.getItem('isLoggedIn');
    const lastActivity = sessionStorage.getItem('lastActivity');
    
    // Pega o nome do arquivo atual (ex: login.html ou index.html)
    const currentPage = window.location.pathname.split("/").pop();

    // Se NÃO estiver logado e NÃO estiver na página de login, expulsa para o login
    if (!isLoggedIn && currentPage !== "login.html" && currentPage !== "") {
        window.location.href = 'login.html';
        return;
    }

    // Se ESTIVER logado e tentar entrar na página de login, manda para a index
    if (isLoggedIn && currentPage === "login.html") {
        window.location.href = 'index.html';
        return;
    }

    // Verifica tempo de inatividade (apenas se estiver logado)
    if (isLoggedIn && lastActivity && (Date.now() - lastActivity > TIMEOUT_DURATION)) {
        alert("Sua sessão expirou por inatividade.");
        logout();
    }
}

function updateActivity() {
    sessionStorage.setItem('lastActivity', Date.now());
}

// Monitorar interações do utilizador
window.onload = function() {
    checkSession();
    
    // Eventos que reiniciam o cronômetro de 30 min
    document.onmousedown = updateActivity;
    document.onkeypress = updateActivity;
    document.onscroll = updateActivity;
    document.onclick = updateActivity;
};

// Verificar a cada 1 minuto se o tempo expirou (mesmo sem mexer no rato)
setInterval(checkSession, 60000);