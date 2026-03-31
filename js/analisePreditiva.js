// ═══════════════════════════════════════════════════════════════
// FIREBASE
// ═══════════════════════════════════════════════════════════════
const FB_GERAL = 'https://sistema-p3-default-rtdb.firebaseio.com/geral.json';
const FB_CVP   = 'https://sistema-p3-default-rtdb.firebaseio.com/cvp.json';
const FB_CVLI  = 'https://sistema-p3-default-rtdb.firebaseio.com/cvli.json';

// ═══════════════════════════════════════════════════════════════
// UTILITÁRIOS DE INTERFACE
// ═══════════════════════════════════════════════════════════════
function atualizarRelogio() {
    const agora = new Date();
    const d = agora.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'long',year:'numeric'});
    const h = agora.toLocaleTimeString('pt-BR');
    document.getElementById('relogio').innerHTML = `${d}<br>${h}`;
}

function checkLogin() {
    const g = localStorage.getItem('userGraduacao');
    const n = localStorage.getItem('userNomeGuerra');
    const el = document.getElementById('user-info');
    if (g && n) {
        el.innerHTML = `<p>Bem Vindo(a):</p><p class="user-nome">${g} ${n}</p>`;
    } else {
        window.location.href = 'login.html';
    }
}

function logout() {
    localStorage.removeItem('userGraduacao');
    localStorage.removeItem('userNomeGuerra');
    window.location.href = 'login.html';
}

// ═══════════════════════════════════════════════════════════════
// MODELOS ESTATÍSTICOS
// ═══════════════════════════════════════════════════════════════

// Regressão linear simples → prevê o próximo ponto
function regressaoLinear(arr) {
    const n = arr.length;
    if (n < 2) return arr[0] ?? 0;
    let sx=0, sy=0, sxy=0, sx2=0;
    arr.forEach((v,i) => { sx+=i; sy+=v; sxy+=i*v; sx2+=i*i; });
    const denom = n*sx2 - sx*sx;
    const m = denom ? (n*sxy - sx*sy)/denom : 0;
    const b = (sy - m*sx)/n;
    return Math.round(Math.max(0, m*n + b));
}

// Média ponderada últimos 3 meses (pesos 1, 2, 3)
function mediaPonderada(arr) {
    const ult = arr.slice(-3);
    if (!ult.length) return 0;
    const pesos = [1,2,3].slice(3-ult.length);
    const soma = ult.reduce((a,v,i) => a + v*pesos[i], 0);
    return Math.round(soma / pesos.reduce((a,v) => a+v, 0));
}

// Combinação 60% ponderada + 40% regressão
function prever(arr) {
    return Math.round(mediaPonderada(arr)*0.6 + regressaoLinear(arr)*0.4);
}

// ═══════════════════════════════════════════════════════════════
// PARSERS
// ═══════════════════════════════════════════════════════════════
function nomeMes(i) {
    return ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][i];
}

function parseMesAno(item) {
    const data = (item.DATA || item.data || '').toString().trim();
    if (!data || data === '---') return null;
    let m, a;
    if (data.includes('/')) {
        const p = data.split('/');
        if (p.length < 3) return null;
        m = parseInt(p[1]) - 1;
        a = parseInt(p[2]);
    } else if (data.includes('-')) {
        const p = data.split('-');
        a = parseInt(p[0]); m = parseInt(p[1]) - 1;
    } else return null;
    if (isNaN(m) || isNaN(a) || m<0 || m>11) return null;
    return { m, a, chave: `${a}-${String(m+1).padStart(2,'0')}` };
}

function parseHora(item) {
    const h = (item.HORA || item.hora || '00:00').toString();
    return Math.min(23, Math.max(0, parseInt(h.split(':')[0]) || 0));
}

function parseDiaSemana(item) {
    const data = (item.DATA || '').toString().trim();
    if (!data || data === '---') return null;
    let d;
    if (data.includes('/')) {
        const p = data.split('/');
        if (p.length < 3) return null;
        d = new Date(`${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`);
    } else if (data.includes('-')) {
        d = new Date(data);
    }
    return (!d || isNaN(d)) ? null : d.getDay();
}

function topN(mapa, n=8) {
    return Object.entries(mapa).sort((a,b) => b[1]-a[1]).slice(0,n);
}

// ═══════════════════════════════════════════════════════════════
// RENDERIZADORES
// ═══════════════════════════════════════════════════════════════
function calcDelta(atual, anterior) {
    if (anterior == null || anterior === 0) return { txt:'—', cls:'eq' };
    const d = atual - anterior;
    if (d > 0) return { txt:`▲ +${d} vs mês ant.`, cls:'up' };
    if (d < 0) return { txt:`▼ ${d} vs mês ant.`, cls:'down' };
    return { txt:'= igual ao mês ant.', cls:'eq' };
}

function renderAlertas(cvpArr, cvliArr, mviArr) {
    const ultiCVP  = cvpArr.at(-1)  ?? 0, antCVP  = cvpArr.at(-2)  ?? 0;
    const ultiCVLI = cvliArr.at(-1) ?? 0, antCVLI = cvliArr.at(-2) ?? 0;
    const ultiMVI  = mviArr.at(-1)  ?? 0, antMVI  = mviArr.at(-2)  ?? 0;
    const prevCVP  = prever(cvpArr), prevCVLI = prever(cvliArr), prevMVI = prever(mviArr);

    const alertas = [];

    // CVP
    if (ultiCVP > antCVP * 1.2)
        alertas.push({tipo:'critico', icone:'🔴', t:`CVP em alta — +${ultiCVP-antCVP} no último mês`, s:`Previsão próximo mês: ${prevCVP} ocorrências`});
    else if (ultiCVP < antCVP)
        alertas.push({tipo:'neutro',  icone:'🟢', t:`CVP em queda`, s:`Último mês: ${ultiCVP} | Anterior: ${antCVP} | Prev.: ${prevCVP}`});
    else
        alertas.push({tipo:'critico', icone:'🟡', t:`CVP estável/levemente elevado`, s:`Último mês: ${ultiCVP} | Previsão: ${prevCVP}`});

    // CVLI
    if (ultiCVLI > antCVLI)
        alertas.push({tipo:'alto',   icone:'🔴', t:`CVLI em alta — +${ultiCVLI-antCVLI} no último mês`, s:`Mês anterior: ${antCVLI} | Previsão: ${prevCVLI}`});
    else if (ultiCVLI === 0)
        alertas.push({tipo:'neutro', icone:'✅', t:`CVLI: nenhum caso no mês atual`, s:`Mês anterior: ${antCVLI} | Previsão: ${prevCVLI}`});
    else
        alertas.push({tipo:'neutro', icone:'🟡', t:`CVLI dentro da média histórica`, s:`Último mês: ${ultiCVLI} | Previsão: ${prevCVLI}`});

    // MVI
    if (ultiMVI > antMVI)
        alertas.push({tipo:'alto',   icone:'🔴', t:`MVI em alta — ${ultiMVI} casos (Hom.+Latrocínio)`, s:`Mês anterior: ${antMVI} | Previsão: ${prevMVI}`});
    else if (ultiMVI === 0)
        alertas.push({tipo:'neutro', icone:'✅', t:`MVI: nenhum caso registrado no mês atual`, s:`Mês anterior: ${antMVI} | Previsão: ${prevMVI}`});
    else
        alertas.push({tipo:'neutro', icone:'🟡', t:`MVI dentro da média histórica`, s:`Último mês: ${ultiMVI} | Previsão: ${prevMVI}`});

    document.getElementById('alertas-bar').innerHTML = alertas.map(a =>
        `<div class="alerta ${a.tipo}">
            <div class="alerta-icone">${a.icone}</div>
            <div class="alerta-txt"><strong>${a.t}</strong><small>${a.s}</small></div>
        </div>`
    ).join('');
}

function renderHeatmapHora(id, contagens, r, g, b) {
    const max = Math.max(...contagens, 1);
    document.getElementById(id).innerHTML = contagens.map((v,i) => {
        const ratio = v / max;
        const alpha = Math.min(1, ratio * 1.3);
        const bg = v === 0 ? '#e9ecef' : `rgba(${r},${g},${b},${alpha})`;
        const cor = v === 0 ? '#aaa' : 'white';
        return `<div class="hora-cel${v===0?' zero':''}" style="background:${bg};color:${cor}"
                     title="${i}:00 — ${v} ocorrência(s)">${i}h</div>`;
    }).join('');
}

function renderHotspotLocalidade(tbodyId, mapa, cor, total) {
    const top = topN(mapa, 10);
    const max = top[0]?.[1] || 1;
    document.getElementById(tbodyId).innerHTML = top.map(([chave, cnt], i) => {
        const [cidade, bairro] = chave.split('||');
        const pct   = total ? Math.round(cnt/total*100) : 0;
        const risco = pct >= 20 ? 'alto' : pct >= 8 ? 'medio' : 'baixo';
        const rlabel = {alto:'Alto', medio:'Médio', baixo:'Baixo'}[risco];
        return `<tr>
            <td style="color:var(--sub);font-size:.72rem;font-weight:bold">${i+1}</td>
            <td>${cidade || 'N/D'}</td>
            <td><strong>${bairro || 'N/D'}</strong></td>
            <td><strong>${cnt}</strong></td>
            <td><span class="risco-badge risco-${risco}">${rlabel}</span></td>
        </tr>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════
// GRÁFICOS (Chart.js)
// ═══════════════════════════════════════════════════════════════
const CFG_BASE = {
    responsive:true, maintainAspectRatio:false,
    plugins:{ legend:{ labels:{ boxWidth:12, font:{size:11}, color:'#333' }}},
    scales:{
        x:{ grid:{display:false}, ticks:{font:{size:10},color:'#555'} },
        y:{ grid:{color:'#eee'},  ticks:{font:{size:10},color:'#555',precision:0}, beginAtZero:true }
    },
    animation:{ duration:700 }
};

// ═══════════════════════════════════════════════════════════════
// MODAL DE OCORRÊNCIAS
// ═══════════════════════════════════════════════════════════════
let _modalRegistros = [];

function abrirModal(titulo, subtitulo, registros) {
    _modalRegistros = registros || [];
    document.getElementById('modal-titulo').textContent    = titulo;
    document.getElementById('modal-subtitulo').textContent = subtitulo;
    document.getElementById('modal-busca').value = '';
    renderModalTabela(_modalRegistros);
    document.getElementById('modal-ocorrencias').classList.add('aberto');
}

function renderModalTabela(lista) {
    const tbody  = document.getElementById('modal-tbody');
    const footer = document.getElementById('modal-footer');
    if (!lista.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="modal-vazio">Nenhuma ocorrência encontrada.</td></tr>';
        footer.textContent = '';
        return;
    }
    tbody.innerHTML = lista.map(r => {
        const tip   = (r.TIPIFICACAO || r.TIPIFICACAO_GERAL || '—').trim();
        const cid   = (r.CIDADE  || '—').trim();
        const bai   = (r.BAIRRO  || '—').trim();
        const data  = (r.DATA    || '—').trim();
        const obito = (r.OBITO   || 'N').toString().trim().toUpperCase();
        const obitoLabel = obito === 'S'
            ? '<span style="background:#c62828;color:#fff;padding:1px 7px;border-radius:4px;font-weight:bold;font-size:.78em;">SIM</span>'
            : '<span style="background:#e0e0e0;color:#555;padding:1px 7px;border-radius:4px;font-size:.78em;">NÃO</span>';
        return `<tr>
            <td><span class="modal-boletim">${r.BOLETIM || '—'}</span></td>
            <td style="white-space:nowrap">${data}</td>
            <td>${tip}</td>
            <td>${cid} · ${bai}</td>
            <td style="text-align:center">${obitoLabel}</td>
        </tr>`;
    }).join('');
    footer.textContent = `${lista.length} ocorrência(s) exibida(s)`;
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('modal-fechar').onclick = () =>
        document.getElementById('modal-ocorrencias').classList.remove('aberto');
    document.getElementById('modal-ocorrencias').onclick = e => {
        if (e.target === document.getElementById('modal-ocorrencias'))
            document.getElementById('modal-ocorrencias').classList.remove('aberto');
    };
    document.getElementById('modal-busca').oninput = e => {
        const q = e.target.value.toLowerCase();
        renderModalTabela(_modalRegistros.filter(r =>
            (r.BOLETIM||'').toLowerCase().includes(q) ||
            (r.TIPIFICACAO||r.TIPIFICACAO_GERAL||'').toLowerCase().includes(q) ||
            (r.BAIRRO||'').toLowerCase().includes(q) ||
            (r.CIDADE||'').toLowerCase().includes(q)
        ));
    };
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
            document.getElementById('modal-ocorrencias').classList.remove('aberto');
    });
});

// ═══════════════════════════════════════════════════════════════
// GRÁFICOS (Chart.js)
// ═══════════════════════════════════════════════════════════════
function graficoLinha(id, labels, datasets, onClickCb) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    new Chart(ctx, {
        type:'line',
        data:{ labels, datasets },
        options:{
            ...CFG_BASE,
            plugins:{ ...CFG_BASE.plugins, legend:{ display: datasets.length > 1, labels: CFG_BASE.plugins.legend.labels }},
            elements:{ point:{ radius:4, hoverRadius:8 }},
            onClick: onClickCb ? (evt, elements) => {
                if (elements.length) onClickCb(elements[0].index);
            } : undefined
        }
    });
}

function graficoBar(id, labels, data, cor, horizontal=false) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return;
    new Chart(ctx, {
        type:'bar',
        data:{ labels, datasets:[{ data, backgroundColor: cor, borderRadius:4 }] },
        options:{
            ...CFG_BASE,
            indexAxis: horizontal ? 'y' : 'x',
            plugins:{ legend:{ display:false }}
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// CARREGAMENTO PRINCIPAL
// ═══════════════════════════════════════════════════════════════
async function carregar() {
    try {
        const [resGeral, resCVP, resCVLI] = await Promise.all([
            fetch(FB_GERAL), fetch(FB_CVP), fetch(FB_CVLI)
        ]);
        const dadosGeral = (await resGeral.json()) || {};
        const dadosCVP   = (await resCVP.json())   || {};
        const dadosCVLI  = (await resCVLI.json())  || {};

        const anoAtual = new Date().getFullYear();
        const mesAtual = new Date().getMonth(); // 0-based

        // ── Filtros por indicador ─────────────────────────────
        // Utilitário: remove acentos e normaliza para maiúsculas
        const norm = str => str.toString().trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

        // ── Função auxiliar: verifica se é tipo CVLI/MVI ────────
        // Todos os campos de tipificação são normalizados por norm() antes,
        // portanto todas as comparações são SEM acento.
        const ehTipoCVLI = t =>
            t.includes('HOMICIDIO') ||
            t.includes('FEMINICIDIO') ||
            t.includes('LATROCINIO');

        // ── MVI ───────────────────────────────────────────────
        // Inclui: HOMICIDIO, FEMINICIDIO, LATROCINIO diretos
        //       + TENTATIVA de HOMICIDIO/FEMINICIDIO/LATROCINIO com OBITO "S"
        // Exclui sempre: ACHADO, SUICIDIO, VIOLACAO (sem acento — já normalizado)
        const isMVI = item => {
            // Concatena AMBOS os campos de tipificação para não perder nenhum dado
            const t = norm(
                (item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || '')
            );
            const obito = norm(item.OBITO || '');

            // Exclusões absolutas — nunca entram no MVI
            if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return false;

            // TENTATIVA: só entra se for de tipo CVLI/MVI e tiver óbito confirmado
            if (t.includes('TENTATIVA')) return ehTipoCVLI(t) && obito === 'S';

            // Direto: apenas os tipos MVI permitidos
            return ehTipoCVLI(t);
        };

        // ── CVP: Roubos/extorsões
        const isCVP = item => {
            const t     = norm((item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || ''));
            const obito = norm(item.OBITO || '');
            if (t.includes('APOIO') || t.includes('OUTRAS')) return false;
            if (t.includes('TENTATIVA') && obito === 'S') return false; // vai para MVI
            return t.includes('ROUBO') || t.includes('EXTORSAO');
        };

        // ── CVLI ──────────────────────────────────────────────
        // Inclui: TENTATIVA de HOMICIDIO/FEMINICIDIO/LATROCINIO
        //       + HOMICIDIO, FEMINICIDIO, LATROCINIO diretos
        // Exclui: ACHADO, SUICIDIO, VIOLACAO (sem acento — já normalizado)
        // "TENTATIVA DE VIOLACAO DE DOMICILIO" é excluída pois
        // não é tentativa de tipo CVLI
        const cvliMap = {};
        Object.values(dadosGeral).forEach(item => {
            const t = norm(
                (item.TIPIFICACAO_GERAL || '') + ' ' + (item.TIPIFICACAO || '')
            );

            // Exclusões absolutas — nunca entram no CVLI
            if (t.includes('ACHADO') || t.includes('SUICIDIO') || t.includes('VIOLACAO')) return;

            // TENTATIVA: só entra se for tentativa de tipo CVLI
            if (t.includes('TENTATIVA')) {
                if (ehTipoCVLI(t)) cvliMap[item.BOLETIM || Math.random()] = item;
                return;
            }

            // Direto: apenas os tipos CVLI permitidos
            if (ehTipoCVLI(t)) {
                cvliMap[item.BOLETIM || Math.random()] = item;
            }
        });

        const arrCVP  = Object.values(dadosCVP).filter(isCVP);
        const arrCVLI = Object.values(cvliMap);
        const arrMVI  = Object.values(dadosGeral).filter(isMVI);

        // ── Série temporal 12 meses ───────────────────────────
        const meses12 = [];
        for (let i=11; i>=0; i--) {
            const d = new Date(anoAtual, mesAtual-i, 1);
            meses12.push({
                chave: `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,
                label: `${nomeMes(d.getMonth())}/${String(d.getFullYear()).slice(-2)}`
            });
        }

        const porMesCVP={}, porMesCVLI={}, porMesMVI={};
        const idxCVP={}, idxCVLI={}, idxMVI={};
        arrCVP.forEach(r  => {
            const d=parseMesAno(r); if(!d) return;
            porMesCVP[d.chave]=(porMesCVP[d.chave]||0)+1;
            (idxCVP[d.chave]=idxCVP[d.chave]||[]).push(r);
        });
        arrCVLI.forEach(r => {
            const d=parseMesAno(r); if(!d) return;
            porMesCVLI[d.chave]=(porMesCVLI[d.chave]||0)+1;
            (idxCVLI[d.chave]=idxCVLI[d.chave]||[]).push(r);
        });
        arrMVI.forEach(r  => {
            const d=parseMesAno(r); if(!d) return;
            porMesMVI[d.chave]=(porMesMVI[d.chave]||0)+1;
            (idxMVI[d.chave]=idxMVI[d.chave]||[]).push(r);
        });

        const cvpArr   = meses12.map(m => porMesCVP[m.chave]||0);
        const cvliArr  = meses12.map(m => porMesCVLI[m.chave]||0);
        const mviArr   = meses12.map(m => porMesMVI[m.chave]||0);
        const labels12 = meses12.map(m => m.label);

        // Mês atual e anterior
        const chaveAtual = meses12.at(-1).chave;
        const chaveAnt   = meses12.at(-2).chave;
        const cvpMes  = porMesCVP[chaveAtual]||0,   cvpAnt  = porMesCVP[chaveAnt]||0;
        const cvliMes = porMesCVLI[chaveAtual]||0,  cvliAnt = porMesCVLI[chaveAnt]||0;
        const mviMes  = porMesMVI[chaveAtual]||0,   mviAnt  = porMesMVI[chaveAnt]||0;

        const media = arr => arr.filter(v=>v>0).length
            ? Math.round(arr.filter(v=>v>0).reduce((a,b)=>a+b,0)/arr.filter(v=>v>0).length) : 0;
        const mediaCVP  = media(cvpArr);
        const mediaCVLI = media(cvliArr);
        const mediaMVI  = media(mviArr);

        // ── Cidade + Bairro crítico (chave "CIDADE|BAIRRO") ────
        function topCidadeBairro(arr) {
            const mapa = {};
            arr.forEach(r => {
                const cidade = (r.CIDADE || 'N/D').toString().trim();
                const bairro = (r.BAIRRO || 'N/D').toString().trim();
                const chave  = `${cidade}||${bairro}`;
                mapa[chave] = (mapa[chave]||0)+1;
            });
            return topN(mapa, 1)[0]; // retorna [chave, contagem]
        }
        const topCVP  = topCidadeBairro(arrCVP);
        const topCVLI = topCidadeBairro(arrCVLI);
        const topMVI  = topCidadeBairro(arrMVI);
        function formatarCidadeBairro(top) {
            if (!top) return 'N/D';
            const [cidade, bairro] = top[0].split('||');
            return `${cidade} · ${bairro}`;
        }

        // ── Horários ──────────────────────────────────────────
        const hCVP=Array(24).fill(0), hCVLI=Array(24).fill(0), hMVI=Array(24).fill(0);
        arrCVP.forEach(r  => hCVP[parseHora(r)]++);
        arrCVLI.forEach(r => hCVLI[parseHora(r)]++);
        arrMVI.forEach(r  => hMVI[parseHora(r)]++);

        // ── Dias da semana ────────────────────────────────────
        const dCVP=Array(7).fill(0), dCVLI=Array(7).fill(0), dMVI=Array(7).fill(0);
        arrCVP.forEach(r  => { const d=parseDiaSemana(r); if(d!==null) dCVP[d]++; });
        arrCVLI.forEach(r => { const d=parseDiaSemana(r); if(d!==null) dCVLI[d]++; });
        arrMVI.forEach(r  => { const d=parseDiaSemana(r); if(d!==null) dMVI[d]++; });

        // ── Tipificações ──────────────────────────────────────
        const tipCVP={}, tipCVLI={}, tipMVI={};
        arrCVP.forEach(r  => { const t=(r.TIPIFICACAO||r.TIPIFICACAO_GERAL||'N/D').trim(); tipCVP[t]=(tipCVP[t]||0)+1; });
        arrCVLI.forEach(r => { const t=(r.TIPIFICACAO||r.TIPIFICACAO_GERAL||'N/D').trim(); tipCVLI[t]=(tipCVLI[t]||0)+1; });
        arrMVI.forEach(r  => { const t=(r.TIPIFICACAO||'N/D').trim(); tipMVI[t]=(tipMVI[t]||0)+1; });

        // ── Hotspots cidade+bairro ────────────────────────────
        function mapaLocalidade(arr) {
            const mapa = {};
            arr.forEach(r => {
                const cidade = (r.CIDADE || 'N/D').toString().trim();
                const bairro = (r.BAIRRO || 'N/D').toString().trim();
                const chave  = `${cidade}||${bairro}`;
                mapa[chave] = (mapa[chave]||0)+1;
            });
            return mapa;
        }
        const localCVP  = mapaLocalidade(arrCVP);
        const localCVLI = mapaLocalidade(arrCVLI);
        const localMVI  = mapaLocalidade(arrMVI);

        // ══════════════════════════════════════════════════════
        // PREENCHE TELA
        // ══════════════════════════════════════════════════════

        document.getElementById('subtitulo-periodo').textContent =
            `Base: ${labels12[0]} → ${labels12.at(-1)} · ${arrCVP.length} CVP · ${arrCVLI.length} CVLI · ${arrMVI.length} MVI`;

        // Alertas
        renderAlertas(cvpArr, cvliArr, mviArr);

        // KPIs CVP
        document.getElementById('cvp-total').textContent          = arrCVP.length;
        document.getElementById('cvp-mes-atual').textContent      = cvpMes;
        document.getElementById('cvp-media').textContent          = mediaCVP;
        document.getElementById('cvp-cidade-bairro').textContent  = formatarCidadeBairro(topCVP);
        const dCVPobj = calcDelta(cvpMes, cvpAnt);
        const elDCVP = document.getElementById('cvp-delta');
        elDCVP.textContent = dCVPobj.txt; elDCVP.className = `delta ${dCVPobj.cls}`;

        // KPIs CVLI
        document.getElementById('cvli-total').textContent         = arrCVLI.length;
        document.getElementById('cvli-mes-atual').textContent     = cvliMes;
        document.getElementById('cvli-media').textContent         = mediaCVLI;
        document.getElementById('cvli-cidade-bairro').textContent = formatarCidadeBairro(topCVLI);
        const dCVLIobj = calcDelta(cvliMes, cvliAnt);
        const elDCVLI = document.getElementById('cvli-delta');
        elDCVLI.textContent = dCVLIobj.txt; elDCVLI.className = `delta ${dCVLIobj.cls}`;

        // KPIs MVI
        document.getElementById('mvi-total').textContent          = arrMVI.length;
        document.getElementById('mvi-mes-atual').textContent      = mviMes;
        document.getElementById('mvi-media').textContent          = mediaMVI;
        document.getElementById('mvi-cidade-bairro').textContent  = formatarCidadeBairro(topMVI);
        const dMVIobj = calcDelta(mviMes, mviAnt);
        const elDMVI = document.getElementById('mvi-delta');
        elDMVI.textContent = dMVIobj.txt; elDMVI.className = `delta ${dMVIobj.cls}`;

        // ── Nomes dos meses ──────────────────────────────────
        const NOMES_MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                             'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const proxMes = new Date(anoAtual, mesAtual + 1, 1);
        document.getElementById('prev-nome-mes-atual').textContent = NOMES_MESES[mesAtual];
        document.getElementById('prev-nome-prox-mes').textContent  = NOMES_MESES[proxMes.getMonth()];

        // ── Previsão para o mês atual (modelo sobre os 3 meses ANTERIORES ao atual) ──
        // Exclui o último ponto (mês atual) para que o real não contamine a estimativa
        const prevMesAtualCVP  = prever(cvpArr.slice(0, -1));
        const prevMesAtualCVLI = prever(cvliArr.slice(0, -1));
        const prevMesAtualMVI  = prever(mviArr.slice(0, -1));

        function renderPrevReal(idPrev, idReal, idDelta, previsto, real) {
            document.getElementById(idPrev).textContent = previsto;
            document.getElementById(idReal).textContent = real;
            const diff = real - previsto;
            const el = document.getElementById(idDelta);
            if (diff > 0)      { el.textContent = `▲ +${diff} acima do previsto`; el.className = 'p-delta up'; }
            else if (diff < 0) { el.textContent = `▼ ${diff} abaixo do previsto`; el.className = 'p-delta down'; }
            else               { el.textContent = `= conforme previsto`;           el.className = 'p-delta eq'; }
        }
        renderPrevReal('prevmes-cvp',  'real-cvp',  'delta-cvp-mes',  prevMesAtualCVP,  cvpMes);
        renderPrevReal('prevmes-cvli', 'real-cvli', 'delta-cvli-mes', prevMesAtualCVLI, cvliMes);
        renderPrevReal('prevmes-mvi',  'real-mvi',  'delta-mvi-mes',  prevMesAtualMVI,  mviMes);

        // ── Previsão próximo mês (modelo sobre os 12 meses incluindo o atual) ──
        document.getElementById('prev-cvp').textContent  = prever(cvpArr);
        document.getElementById('prev-cvli').textContent = prever(cvliArr);
        document.getElementById('prev-mvi').textContent  = prever(mviArr);

        // Gráficos tendência mensal
        graficoLinha('chart-cvp-mes', labels12, [{
            label:'CVP', data:cvpArr,
            borderColor:'#e65100', backgroundColor:'rgba(230,81,0,.12)',
            fill:true, tension:.35
        }], idx => {
            const m = meses12[idx];
            abrirModal(`CVP — ${m.label}`, `${cvpArr[idx]} ocorrência(s)`, idxCVP[m.chave]||[]);
        });
        graficoLinha('chart-cvli-mes', labels12, [{
            label:'CVLI', data:cvliArr,
            borderColor:'#6a1b9a', backgroundColor:'rgba(106,27,154,.12)',
            fill:true, tension:.35
        }], idx => {
            const m = meses12[idx];
            abrirModal(`CVLI — ${m.label}`, `${cvliArr[idx]} ocorrência(s)`, idxCVLI[m.chave]||[]);
        });
        graficoLinha('chart-mvi-mes', labels12, [{
            label:'MVI', data:mviArr,
            borderColor:'#b71c1c', backgroundColor:'rgba(183,28,28,.12)',
            fill:true, tension:.35
        }], idx => {
            const m = meses12[idx];
            abrirModal(`MVI — ${m.label}`, `${mviArr[idx]} ocorrência(s)`, idxMVI[m.chave]||[]);
        });

        // Gráfico dias da semana (CVP · CVLI · MVI)
        const diasLabel=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        graficoLinha('chart-diasemana', diasLabel, [
            { label:'CVP',  data:dCVP,  borderColor:'#e65100', backgroundColor:'transparent', tension:.35 },
            { label:'CVLI', data:dCVLI, borderColor:'#6a1b9a', backgroundColor:'transparent', tension:.35 },
            { label:'MVI',  data:dMVI,  borderColor:'#b71c1c', backgroundColor:'transparent', tension:.35 }
        ]);

        // Gráficos tipificações
        const tCVP  = topN(tipCVP,8),  tCVLI = topN(tipCVLI,8), tMVI = topN(tipMVI,8);
        graficoBar('chart-tip-cvp',  tCVP.map(t=>t[0]),  tCVP.map(t=>t[1]),  '#e65100', true);
        graficoBar('chart-tip-cvli', tCVLI.map(t=>t[0]), tCVLI.map(t=>t[1]), '#6a1b9a', true);
        graficoBar('chart-tip-mvi',  tMVI.map(t=>t[0]),  tMVI.map(t=>t[1]),  '#b71c1c', true);

        // Heatmaps horários
        renderHeatmapHora('horas-cvp',  hCVP,  230, 81,  0);
        renderHeatmapHora('horas-cvli', hCVLI, 106, 27,  154);
        renderHeatmapHora('horas-mvi',  hMVI,  183, 28,  28);

        // Hotspots cidade+bairro
        renderHotspotLocalidade('tbody-cvp',  localCVP,  '#e65100', arrCVP.length);
        renderHotspotLocalidade('tbody-cvli', localCVLI, '#6a1b9a', arrCVLI.length);
        renderHotspotLocalidade('tbody-mvi',  localMVI,  '#b71c1c', arrMVI.length);

        // Guarda referência dos dados para o relatório (acessível pelo botão)
        window._dadosPreditiva = { arrCVP, arrCVLI, arrMVI, meses12, labels12, cvpArr, cvliArr, mviArr };

    } catch(err) {
        console.error('Erro ao carregar preditiva:', err);
        document.getElementById('alertas-bar').innerHTML =
            `<div class="alerta alto"><div class="alerta-icone">⚠️</div>
             <div class="alerta-txt"><strong>Erro ao carregar dados</strong><small>${err.message}</small></div></div>`;
    } finally {
        document.getElementById('loading').style.display = 'none';
    }
}

// ═══════════════════════════════════════════════════════════════
// RELATÓRIO PREDITIVO — serializa dados e abre nova aba
// ═══════════════════════════════════════════════════════════════
function abrirRelatorioPreditivo(arrCVP, arrCVLI, arrMVI, meses12, labels12, cvpArr, cvliArr, mviArr) {
    const grad = localStorage.getItem('userGraduacao')  || '';
    const nome = localStorage.getItem('userNomeGuerra') || '';

    // Enxuga para só os campos necessários no relatório
    const enx = arr => arr.map(i => ({
        DATA:              i.DATA || i.data || '',
        HORA:              i.HORA || '',
        BOLETIM:           i.BOLETIM || '',
        TIPIFICACAO_GERAL: i.TIPIFICACAO_GERAL || '',
        TIPIFICACAO:       i.TIPIFICACAO || '',
        CIDADE:            i.CIDADE || '',
        BAIRRO:            i.BAIRRO || i.bairro || '',
        OBITO:             i.OBITO || 'N',
    }));

    const payload = {
        operador: (grad + ' ' + nome).trim(),
        arrCVP:   enx(arrCVP),
        arrCVLI:  enx(arrCVLI),
        arrMVI:   enx(arrMVI),
        meses12,
        labels12,
        cvpArr,
        cvliArr,
        mviArr,
    };

    const json = JSON.stringify(payload);
    try {
        localStorage.removeItem('p3_preditiva');
        localStorage.setItem('p3_preditiva', json);
        window.open('../relatorios/relatorio_preditiva.html', '_blank');
    } catch (e) {
        alert('Erro ao gerar relatório: dados muito grandes (' + Math.round(json.length/1024) + ' KB). Tente um período menor.');
        console.error(e);
    }
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);
    document.getElementById('btn-logout').addEventListener('click', logout);
    carregar();
});