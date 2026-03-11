// ====================================================================
// CONFIGURAÇÃO FIREBASE
// ====================================================================
const DATABASE_URL = 'https://sistema-p3-default-rtdb.firebaseio.com';
const NODES = {
    cursos: 'instrucao_cursos',
    instrutores: 'instrucao_instrutores',
    alunos: 'instrucao_alunos',
    planos: 'instrucao_planos',
    tiro: 'instrucao_tiro'
};

// Cache local
let cache = { cursos: {}, instrutores: {}, alunos: {}, planos: {}, tiro: {} };
let sidebarAtiva = null;

// ====================================================================
// FIREBASE CRUD
// ====================================================================
async function fbGet(node) {
    const res = await fetch(`${DATABASE_URL}/${node}.json`);
    return await res.json() || {};
}
async function fbPost(node, data) {
    const res = await fetch(`${DATABASE_URL}/${node}.json`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    return await res.json();
}
async function fbPatch(node, id, data) {
    const res = await fetch(`${DATABASE_URL}/${node}/${id}.json`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    return await res.json();
}
async function fbDelete(node, id) {
    await fetch(`${DATABASE_URL}/${node}/${id}.json`, { method: 'DELETE' });
}

// ====================================================================
// ABAS
// ====================================================================
function ativarAba(aba) {
    document.querySelectorAll('.aba-btn').forEach(b => b.classList.remove('ativa'));
    document.querySelectorAll('.aba-conteudo').forEach(c => c.classList.remove('ativa'));
    document.querySelector(`[data-aba="${aba}"]`).classList.add('ativa');
    document.getElementById(`aba-${aba}`).classList.add('ativa');
}

// ====================================================================
// SIDEBAR
// ====================================================================

function abrirSidebar(tipo, dados = null) {
    fecharTodasSidebars();
    sidebarAtiva = tipo;
    const form = document.getElementById(`form-${tipo}`);
    form.reset();
    document.getElementById(`${tipo}-id`).value = '';

    if (tipo === 'curso') {
        document.getElementById('titulo-form-curso').textContent = dados ? '✏️ EDITAR CURSO / ESTÁGIO' : '📘 NOVO CURSO / ESTÁGIO';
    }
    if (tipo === 'plano' && !dados) {
        // Novo plano: garante que o tbody começa com 1 linha com select de instrutor
        const tbody = document.getElementById('corpo-conteudo');
        if (tbody) { tbody.innerHTML = ''; adicionarLinhaConteudo(); }
    }

    if (dados) preencherSidebar(tipo, dados);

    // Popula selects de cursos nas sidebars vinculadas
    if (['aluno', 'plano', 'tiro'].includes(tipo)) popularSelectCursos(tipo);
    if (tipo === 'tiro' || tipo === 'plano') popularSelectInstrutoresPlano(tipo);
    if (tipo === 'aluno' || tipo === 'instrutor') verificarEfetivo(tipo);

    form.classList.add('ativo');
    document.getElementById('overlay-sidebar').classList.add('ativo');
}

function fecharTodasSidebars() {
    document.querySelectorAll('.sidbarform').forEach(f => f.classList.remove('ativo'));
    document.getElementById('overlay-sidebar').classList.remove('ativo');
    sidebarAtiva = null;
}

// Botões fechar
['curso', 'instrutor', 'aluno', 'plano', 'tiro'].forEach(tipo => {
    document.getElementById(`btn-fechar-${tipo}`).addEventListener('click', fecharTodasSidebars);
});
// listener movido para DOMContentLoaded
function preencherSidebar(tipo, dados) {
    const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
    document.getElementById(`${tipo}-id`).value = dados._id || '';

    if (tipo === 'curso') {
        set('curso-tipo', dados.TIPO); set('curso-nome', dados.NOME);
        set('curso-inicio', dados.DATA_INICIO); set('curso-termino', dados.DATA_TERMINO);
        set('curso-local', dados.LOCAL); set('curso-instituicao', dados.INSTITUICAO);
        set('curso-carga', dados.CARGA_HORARIA); set('curso-vagas', dados.VAGAS);
        set('curso-np', dados.NP_SEI); set('curso-objetivo', dados.OBJETIVO);
        set('curso-status', dados.STATUS);
    } else if (tipo === 'instrutor') {
        set('instrutor-grad', dados.GRADUACAO); set('instrutor-nome', dados.NOME);
        set('instrutor-ordem', dados.NUM_ORDEM); set('instrutor-mat', dados.MATRICULA);
        set('instrutor-especialidade', dados.ESPECIALIDADE);
        set('instrutor-curriculo', dados.CURRICULO);
        set('instrutor-tel', dados.TELEFONE); set('instrutor-email', dados.EMAIL);
    } else if (tipo === 'aluno') {
        set('aluno-grad', dados.GRADUACAO); set('aluno-nome', dados.NOME);
        set('aluno-ordem', dados.NUM_ORDEM); set('aluno-mat', dados.MATRICULA);
        set('aluno-cpf', dados.CPF);
        set('aluno-opm', dados.OPM); set('aluno-situacao', dados.SITUACAO);
        setTimeout(() => set('aluno-curso', dados.CURSO_ID), 100);
    } else if (tipo === 'plano') {
        set('plano-np', dados.NP_SEI); set('plano-numero', dados.NUMERO_PLANO);
        set('plano-evento', dados.NOME_EVENTO); set('plano-justificativa', dados.JUSTIFICATIVA);
        set('plano-obj-geral', dados.OBJ_GERAL); set('plano-obj-especificos', dados.OBJ_ESPECIFICOS);
        set('plano-publico', dados.PUBLICO_ALVO); set('plano-vagas', dados.VAGAS);
        set('plano-carga', dados.CARGA_TOTAL); set('plano-metodologia', dados.METODOLOGIA);
        set('plano-periodo', dados.PERIODO); set('plano-local', dados.LOCAL);
        set('plano-material', dados.MATERIAL); set('plano-avaliacao', dados.AVALIACAO);
        set('plano-proporcao', dados.PROPORCAO);
        set('plano-tel', dados.TEL_P3); set('plano-email', dados.EMAIL_P3);
        set('plano-equipe', dados.EQUIPE_TECNICA);
        set('plano-intercorrencia', dados.INTERCORRENCIA);
        set('plano-observacoes', dados.OBSERVACOES);
        setTimeout(() => {
            set('plano-curso', dados.CURSO_ID);

            // Restaura linhas do conteúdo programático salvo
            if (dados.CONTEUDO && dados.CONTEUDO.length > 0) {
                const tbody = document.getElementById('corpo-conteudo');
                tbody.innerHTML = '';
                dados.CONTEUDO.forEach(linha => {
                    adicionarLinhaConteudo();
                    const tr = tbody.lastElementChild;
                    const inputs = tr.querySelectorAll('input');
                    const sel = tr.querySelector('.select-instrutor-conteudo');
                    if (inputs[0]) inputs[0].value = linha.tema || '';
                    if (inputs[1]) inputs[1].value = linha.ha || '';
                    if (sel) sel.value = linha.instrutor || '';
                });
            }
        }, 100);
    } else if (tipo === 'tiro') {
        set('tiro-data', dados.DATA); set('tiro-horario', dados.HORARIO);
        set('tiro-local', dados.LOCAL); set('tiro-armamento', dados.ARMAMENTO);
        set('tiro-calibre', dados.CALIBRE); set('tiro-municao', dados.MUNICAO);
        set('tiro-modalidade', dados.MODALIDADE); set('tiro-exercicios', dados.EXERCICIOS);
        set('tiro-criterio', dados.CRITERIO); set('tiro-status', dados.STATUS);
        setTimeout(() => { set('tiro-curso', dados.CURSO_ID); set('tiro-instrutor', dados.INSTRUTOR_ID); }, 150);
    }
}

function popularSelectCursos(tipo) {
    const prefix = tipo === 'aluno' ? 'aluno' : tipo === 'tiro' ? 'tiro' : 'plano';
    const sel = document.getElementById(`${prefix}-curso`);
    sel.innerHTML = '<option value="">Selecione...</option>';
    Object.entries(cache.cursos).forEach(([id, c]) => {
        sel.innerHTML += `<option value="${id}">${c.NOME || ''} (${c.TIPO || ''})</option>`;
    });
    // Também o filtro de alunos
    const filtroAluno = document.getElementById('filtro-aluno-curso');
    if (filtroAluno) {
        filtroAluno.innerHTML = '<option value="">Todos os cursos</option>';
        Object.entries(cache.cursos).forEach(([id, c]) => {
            filtroAluno.innerHTML += `<option value="${id}">${c.NOME || ''}</option>`;
        });
    }
}

function popularSelectInstrutores() {
    const sel = document.getElementById('tiro-instrutor');
    sel.innerHTML = '<option value="">Selecione...</option>';
    Object.entries(cache.instrutores).forEach(([id, inst]) => {
        sel.innerHTML += `<option value="${id}">${inst.GRADUACAO || ''} ${inst.NOME || ''}</option>`;
    });
}

// Popula instrutores no contexto correto (plano ou tiro)
function popularSelectInstrutoresPlano(tipo) {
    if (tipo === 'tiro') {
        popularSelectInstrutores();
        return;
    }
    // Para o plano: popula os selects de instrutor dentro das linhas do conteúdo programático
    // e registra o listener de auto-preenchimento no select de curso do plano
    const selCurso = document.getElementById('plano-curso');
    // Evita duplicar listener
    selCurso.removeEventListener('change', autoPrecherPlano);
    selCurso.addEventListener('change', autoPrecherPlano);
}

// Preenche automaticamente campos do plano com dados do curso selecionado
function autoPrecherPlano() {
    const cursoId = document.getElementById('plano-curso').value;
    if (!cursoId || !cache.cursos[cursoId]) return;

    const c = cache.cursos[cursoId];
    const set = (id, val) => {
        const el = document.getElementById(id);
        // Só preenche se o campo estiver vazio (não sobrescreve edição manual)
        if (el && !el.value && val) el.value = val;
    };

    set('plano-evento', c.NOME);
    set('plano-np', c.NP_SEI);
    set('plano-vagas', c.VAGAS);
    set('plano-carga', c.CARGA_HORARIA ? c.CARGA_HORARIA + ' h/a' : '');
    set('plano-obj-geral', c.OBJETIVO);
    set('plano-local', c.LOCAL);
    set('plano-publico', c.PUBLICO_ALVO || '');

    // Preenche período com datas do curso, se existirem
    if (!document.getElementById('plano-periodo').value && c.DATA_INICIO && c.DATA_TERMINO) {
        const di = formatarData(c.DATA_INICIO);
        const df = formatarData(c.DATA_TERMINO);
        document.getElementById('plano-periodo').value = `${di} a ${df}`;
    }

    // Popula selects de instrutor nas linhas do conteúdo programático existentes
    atualizarSelectsInstrutoresConteudo();
}

// Atualiza os <select> de instrutor dentro da tabela de conteúdo programático
function atualizarSelectsInstrutoresConteudo() {
    document.querySelectorAll('#corpo-conteudo .select-instrutor-conteudo').forEach(sel => {
        const valorAtual = sel.value;
        sel.innerHTML = '<option value="">Selecione...</option>';
        Object.entries(cache.instrutores).forEach(([id, inst]) => {
            sel.innerHTML += `<option value="${id}">${inst.GRADUACAO || ''} ${inst.NOME || ''}</option>`;
        });
        if (valorAtual) sel.value = valorAtual;
    });
}

// ====================================================================
// CONTEÚDO PROGRAMÁTICO (linhas dinâmicas no plano)
// ====================================================================
function adicionarLinhaConteudo() {
    const tbody = document.getElementById('corpo-conteudo');
    const tr = document.createElement('tr');

    // Monta options dos instrutores cadastrados
    const opts = Object.entries(cache.instrutores)
        .map(([id, inst]) => `<option value="${inst.GRADUACAO || ''} ${inst.NOME || ''}">${inst.GRADUACAO || ''} ${inst.NOME || ''}</option>`)
        .join('');

    tr.innerHTML = `
        <td><input type="text" placeholder="Tema abordado"></td>
        <td><input type="text" style="width:50px" placeholder="2h/a"></td>
        <td>
            <select class="select-instrutor-conteudo" style="width:100%;padding:3px;border:1px solid #ddd;border-radius:3px;font-size:0.78rem;">
                <option value="">Selecione...</option>
                ${opts}
            </select>
        </td>
        <td><button type="button" onclick="removerLinha(this)" style="background:red;color:white;border:none;border-radius:3px;cursor:pointer;padding:2px 6px;">✕</button></td>
    `;
    tbody.appendChild(tr);
}
function removerLinha(btn) {
    btn.closest('tr').remove();
}
function coletarConteudoProgramatico() {
    const linhas = [];
    document.querySelectorAll('#corpo-conteudo tr').forEach(tr => {
        const inputs = tr.querySelectorAll('input');
        const selInst = tr.querySelector('.select-instrutor-conteudo');
        const tema = inputs[0]?.value || '';
        const ha = inputs[1]?.value || '';
        const inst = selInst ? selInst.value : (inputs[2]?.value || '');
        if (tema || inst) linhas.push({ tema, ha, instrutor: inst });
    });
    return linhas;
}

// ====================================================================
// CARREGAMENTO DE DADOS
// ====================================================================
async function carregarTodos() {
    document.getElementById('msg-carregamento').textContent = 'Carregando...';
    const [cursos, instrutores, alunos, planos, tiro] = await Promise.all([
        fbGet(NODES.cursos), fbGet(NODES.instrutores),
        fbGet(NODES.alunos), fbGet(NODES.planos), fbGet(NODES.tiro)
    ]);
    cache.cursos = cursos || {};
    cache.instrutores = instrutores || {};
    cache.alunos = alunos || {};
    cache.planos = planos || {};
    cache.tiro = tiro || {};

    renderCursos(); renderInstrutores(); renderAlunos(); renderPlanos(); renderTiro();
    atualizarContadores();
    document.getElementById('msg-carregamento').textContent = '';
    popularSelectCursos('aluno');
}

// ====================================================================
// RENDERIZAÇÕES
// ====================================================================
function statusBadge(s) {
    const m = {
        'PLANEJADO': 'badge-amarelo', 'EM ANDAMENTO': 'badge-azul', 'CONCLUÍDO': 'badge-verde',
        'CANCELADO': 'badge-vermelho', 'INSCRITO': 'badge-azul', 'APROVADO': 'badge-verde',
        'REPROVADO': 'badge-vermelho', 'DESISTENTE': 'badge-amarelo', 'REALIZADO': 'badge-verde'
    };
    return `<span class="badge ${m[s] || 'badge-azul'}">${s || '-'}</span>`;
}

function renderCursos(dados = null) {
    const tbody = document.getElementById('corpo-cursos');
    const d = dados || cache.cursos;
    const entries = Object.entries(d);
    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:2rem;">Nenhum registro encontrado.</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(([id, c]) => `
        <tr>
            <td>${statusBadge(c.TIPO)}</td>
            <td><strong>${c.NOME || '-'}</strong></td>
            <td>${formatarData(c.DATA_INICIO)}</td>
            <td>${formatarData(c.DATA_TERMINO)}</td>
            <td>${c.LOCAL || '-'}</td>
            <td>${c.CARGA_HORARIA || '-'} h/a</td>
            <td>${c.VAGAS || '-'}</td>
            <td>${statusBadge(c.STATUS)}</td>
            <td>
                <button class="btn-acao btn-editar" onclick='editarRegistro("curso","${id}")'>✏️</button>
                <button class="btn-acao btn-excluir" onclick='excluirRegistro("cursos","${id}")'>🗑️</button>
            </td>
        </tr>`).join('');
}

function renderInstrutores(dados = null) {
    const tbody = document.getElementById('corpo-instrutores');
    const d = dados || cache.instrutores;
    const entries = Object.entries(d);
    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:2rem;">Nenhum instrutor cadastrado.</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(([id, inst]) => `
        <tr>
            <td>${inst.GRADUACAO || '-'}</td>
            <td><strong>${inst.NOME || '-'}</strong></td>
            <td>${inst.NUM_ORDEM || '-'}</td>
            <td>${inst.MATRICULA || '-'}</td>
            <td>${inst.ESPECIALIDADE || '-'}</td>
            <td>${inst.TELEFONE || '-'}</td>
            <td>
                <button class="btn-acao btn-editar" onclick='editarRegistro("instrutor","${id}")'>✏️</button>
                <button class="btn-acao btn-excluir" onclick='excluirRegistro("instrutores","${id}")'>🗑️</button>
            </td>
        </tr>`).join('');
}

function renderAlunos(dados = null) {
    const tbody = document.getElementById('corpo-alunos');
    const d = dados || cache.alunos;
    const entries = Object.entries(d);
    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:#999;padding:2rem;">Nenhum aluno cadastrado.</td></tr>';
        limparSelecaoAlunos();
        return;
    }
    let ord = 1;
    tbody.innerHTML = entries.map(([id, a]) => {
        const nomeCurso = cache.cursos[a.CURSO_ID]?.NOME || '-';
        return `<tr data-aluno-id="${id}">
            <td class="td-cb"><input type="checkbox" class="cb-aluno cb-linha" value="${id}" onchange="atualizarBarraLote()"></td>
            <td>${ord++}</td>
            <td>${a.GRADUACAO || '-'}</td>
            <td><strong>${a.NOME || '-'}</strong></td>
            <td>${a.NUM_ORDEM || '-'}</td>
            <td>${a.MATRICULA || '-'}</td>
            <td>${a.CPF || '-'}</td>
            <td>${a.OPM || '-'}</td>
            <td>${nomeCurso}</td>
            <td>${statusBadge(a.SITUACAO)}</td>
            <td>
                <button class="btn-acao btn-editar" onclick='editarRegistro("aluno","${id}")'>✏️</button>
                <button class="btn-acao btn-excluir" onclick='excluirRegistro("alunos","${id}")'>🗑️</button>
            </td>
        </tr>`;
    }).join('');
    // Resetar checkbox "selecionar todos"
    const cbTodos = document.getElementById('cb-todos-alunos');
    if (cbTodos) cbTodos.checked = false;
    limparSelecaoAlunos();
}

function renderPlanos(dados = null) {
    const tbody = document.getElementById('corpo-planos');
    const d = dados || cache.planos;
    const entries = Object.entries(d);
    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#999;padding:2rem;">Nenhum plano cadastrado.</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(([id, p]) => `
        <tr>
            <td><strong>${p.NP_SEI || '-'}</strong><br><small>${p.NUMERO_PLANO || ''}</small></td>
            <td>${p.NOME_EVENTO || '-'}</td>
            <td>${p.PERIODO || '-'}</td>
            <td>${p.LOCAL || '-'}</td>
            <td>${p.CARGA_TOTAL || '-'}</td>
            <td>${p.VAGAS || '-'}</td>
            <td>
                <button class="btn-acao btn-editar" onclick='editarRegistro("plano","${id}")'>✏️</button>
                <button class="btn-acao btn-doc" onclick='gerarDocPlano("${id}")'>🖨️ Plano</button>
                <button class="btn-acao btn-relatorio" onclick='gerarDocxPlano("${id}")'>📄 Plano .docx</button>
                <button class="btn-acao btn-doc" style="background:#6c3483;" onclick='imprimirRelatorio("${id}")'>🖨️ Relatório</button>
                <button class="btn-acao btn-relatorio" style="background:#1a5276;" onclick='gerarDocxRelatorio("${id}")'>📄 Rel. .docx</button>
                <button class="btn-acao btn-excluir" onclick='excluirRegistro("planos","${id}")'>🗑️</button>
            </td>
        </tr>`).join('');
}

function renderTiro(dados = null) {
    const tbody = document.getElementById('corpo-tiro');
    const d = dados || cache.tiro;
    const entries = Object.entries(d);
    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#999;padding:2rem;">Nenhum plano de tiro cadastrado.</td></tr>';
        return;
    }
    tbody.innerHTML = entries.map(([id, t]) => {
        const nomeInstrutor = cache.instrutores[t.INSTRUTOR_ID]
            ? `${cache.instrutores[t.INSTRUTOR_ID].GRADUACAO} ${cache.instrutores[t.INSTRUTOR_ID].NOME}`
            : '-';
        return `<tr>
            <td>${formatarData(t.DATA)}</td>
            <td>${t.HORARIO || '-'}</td>
            <td>${t.LOCAL || '-'}</td>
            <td>${t.ARMAMENTO || '-'}</td>
            <td>${t.MODALIDADE || '-'}</td>
            <td>${nomeInstrutor}</td>
            <td>${t.MUNICAO || '-'} mun.</td>
            <td>${statusBadge(t.STATUS)}</td>
            <td>
                <button class="btn-acao btn-editar" onclick='editarRegistro("tiro","${id}")'>✏️</button>
                <button class="btn-acao btn-excluir" onclick='excluirRegistro("tiro","${id}")'>🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

// ====================================================================
// EDITAR / EXCLUIR
// ====================================================================
window.editarRegistro = function (tipo, id) {
    const nodeMap = { curso: 'cursos', instrutor: 'instrutores', aluno: 'alunos', plano: 'planos', tiro: 'tiro' };
    const dados = { ...cache[nodeMap[tipo]][id], _id: id };
    abrirSidebar(tipo, dados);
};

window.excluirRegistro = async function (node, id) {
    if (!confirm('Confirmar exclusão deste registro?')) return;
    await fbDelete(NODES[node], id);
    delete cache[node][id];
    const renders = { cursos: renderCursos, instrutores: renderInstrutores, alunos: renderAlunos, planos: renderPlanos, tiro: renderTiro };
    renders[node]();
    atualizarContadores();
};

// ====================================================================
// SUBMITS DOS FORMS
// ====================================================================
async function handleSubmit(tipo, extraData = {}) {
    const nodeMap = { curso: 'cursos', instrutor: 'instrutores', aluno: 'alunos', plano: 'planos', tiro: 'tiro' };
    const node = nodeMap[tipo];
    const id = document.getElementById(`${tipo}-id`).value;

    const getData = {
        curso: () => ({
            TIPO: document.getElementById('curso-tipo').value,
            NOME: document.getElementById('curso-nome').value,
            DATA_INICIO: document.getElementById('curso-inicio').value,
            DATA_TERMINO: document.getElementById('curso-termino').value,
            LOCAL: document.getElementById('curso-local').value,
            INSTITUICAO: document.getElementById('curso-instituicao').value,
            CARGA_HORARIA: document.getElementById('curso-carga').value,
            VAGAS: document.getElementById('curso-vagas').value,
            NP_SEI: document.getElementById('curso-np').value,
            OBJETIVO: document.getElementById('curso-objetivo').value,
            STATUS: document.getElementById('curso-status').value
        }),
        instrutor: () => ({
            GRADUACAO: document.getElementById('instrutor-grad').value,
            NOME: document.getElementById('instrutor-nome').value,
            NUM_ORDEM: document.getElementById('instrutor-ordem').value,
            MATRICULA: document.getElementById('instrutor-mat').value,
            ESPECIALIDADE: document.getElementById('instrutor-especialidade').value,
            CURRICULO: document.getElementById('instrutor-curriculo').value,
            TELEFONE: document.getElementById('instrutor-tel').value,
            EMAIL: document.getElementById('instrutor-email').value
        }),
        aluno: () => ({
            GRADUACAO: document.getElementById('aluno-grad').value,
            NOME: document.getElementById('aluno-nome').value,
            NUM_ORDEM: document.getElementById('aluno-ordem').value,
            MATRICULA: document.getElementById('aluno-mat').value,
            CPF: (document.getElementById('aluno-cpf') || { value: '' }).value,
            OPM: document.getElementById('aluno-opm').value,
            SITUACAO: document.getElementById('aluno-situacao').value,
            CURSO_ID: document.getElementById('aluno-curso').value
        }),
        plano: () => ({
            CURSO_ID: document.getElementById('plano-curso').value,
            NP_SEI: document.getElementById('plano-np').value,
            NUMERO_PLANO: document.getElementById('plano-numero').value,
            NOME_EVENTO: document.getElementById('plano-evento').value,
            JUSTIFICATIVA: document.getElementById('plano-justificativa').value,
            OBJ_GERAL: document.getElementById('plano-obj-geral').value,
            OBJ_ESPECIFICOS: document.getElementById('plano-obj-especificos').value,
            PUBLICO_ALVO: document.getElementById('plano-publico').value,
            VAGAS: document.getElementById('plano-vagas').value,
            CARGA_TOTAL: document.getElementById('plano-carga').value,
            CONTEUDO: coletarConteudoProgramatico(),
            METODOLOGIA: document.getElementById('plano-metodologia').value,
            PERIODO: document.getElementById('plano-periodo').value,
            LOCAL: document.getElementById('plano-local').value,
            MATERIAL: document.getElementById('plano-material').value,
            AVALIACAO: document.getElementById('plano-avaliacao').value,
            PROPORCAO: document.getElementById('plano-proporcao').value,
            TEL_P3: document.getElementById('plano-tel').value,
            EMAIL_P3: document.getElementById('plano-email').value,
            EQUIPE_TECNICA: (document.getElementById('plano-equipe')||{value:''}).value,
            INTERCORRENCIA: (document.getElementById('plano-intercorrencia')||{value:''}).value,
            OBSERVACOES: (document.getElementById('plano-observacoes')||{value:''}).value
        }),
        tiro: () => ({
            CURSO_ID: document.getElementById('tiro-curso').value,
            DATA: document.getElementById('tiro-data').value,
            HORARIO: document.getElementById('tiro-horario').value,
            LOCAL: document.getElementById('tiro-local').value,
            ARMAMENTO: document.getElementById('tiro-armamento').value,
            CALIBRE: document.getElementById('tiro-calibre').value,
            MUNICAO: document.getElementById('tiro-municao').value,
            MODALIDADE: document.getElementById('tiro-modalidade').value,
            INSTRUTOR_ID: document.getElementById('tiro-instrutor').value,
            EXERCICIOS: document.getElementById('tiro-exercicios').value,
            CRITERIO: document.getElementById('tiro-criterio').value,
            STATUS: document.getElementById('tiro-status').value
        })
    };

    const dados = getData[tipo]();

    try {
        if (id) {
            await fbPatch(NODES[node], id, dados);
            cache[node][id] = dados;
        } else {
            const res = await fbPost(NODES[node], dados);
            cache[node][res.name] = dados;
        }
        fecharTodasSidebars();
        const renders = { cursos: renderCursos, instrutores: renderInstrutores, alunos: renderAlunos, planos: renderPlanos, tiro: renderTiro };
        renders[node]();
        atualizarContadores();
    } catch (err) {
        alert('Erro ao salvar: ' + err.message);
    }
}

// form submit listeners movidos para DOMContentLoaded

// ====================================================================
// FILTROS
// ====================================================================
function filtrarTabela(tipo) {
    if (tipo === 'cursos') {
        const campo = document.getElementById('filtro-curso-campo').value;
        const valor = document.getElementById('filtro-curso-valor').value.toLowerCase();
        if (!campo || !valor) { renderCursos(); return; }
        const filtrado = {};
        Object.entries(cache.cursos).forEach(([id, c]) => {
            if ((c[campo] || '').toLowerCase().includes(valor)) filtrado[id] = c;
        });
        renderCursos(filtrado);
    }
}
function limparFiltro(tipo) {
    if (tipo === 'cursos') {
        document.getElementById('filtro-curso-campo').value = '';
        document.getElementById('filtro-curso-valor').value = '';
        renderCursos();
    }
}
function carregarAlunos() {
    const cursoid = document.getElementById('filtro-aluno-curso').value;
    if (!cursoid) { renderAlunos(); return; }
    const filtrado = {};
    Object.entries(cache.alunos).forEach(([id, a]) => {
        if (a.CURSO_ID === cursoid) filtrado[id] = a;
    });
    renderAlunos(filtrado);
}

// ====================================================================
// GERAR PLANO DE INSTRUÇÃO (abre janela de impressão)
// ====================================================================
window.gerarDocPlano = function (id) {
    const p = cache.planos[id];
    if (!p) return;
    const alunos = Object.values(cache.alunos).filter(a => a.CURSO_ID === p.CURSO_ID);

    // ── helpers ──────────────────────────────────────────────────────
    // Converte texto separado por \n ou ; em lista de bullets HTML
    const bullets = texto => {
        if (!texto) return '';
        const itens = texto.split(/\n|;\s*/).map(s => s.trim()).filter(Boolean);
        if (itens.length <= 1) return escHtml(texto);
        return '<ul style="margin:2px 0 2px 18px;padding:0;">' +
            itens.map(i => `<li>${escHtml(i)}</li>`).join('') +
            '</ul>';
    };
    const escHtml = s => String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const val = s => escHtml(s);

    // ── linhas do conteúdo programático ──────────────────────────────
    const getCurriculo = nome => {
        if (!nome) return '';
        const inst = Object.values(cache.instrutores || {}).find(i =>
            (`${i.GRADUACAO||''} ${i.NOME||''}`).trim() === nome.trim() ||
            (i.NOME||'').trim() === nome.trim()
        );
        return (inst && inst.CURRICULO) ? inst.CURRICULO : '';
    };
    const conteudoLinhas = (p.CONTEUDO && p.CONTEUDO.length)
        ? p.CONTEUDO.map(c => {
            const cur = getCurriculo(c.instrutor);
            return `
            <tr>
                <td>${val(c.tema)}</td>
                <td style="text-align:center">${val(c.ha)}</td>
                <td>${val(c.instrutor)}${cur
                    ? `<br><span style="font-size:9pt;color:#333;">${val(cur)}</span>`
                    : ''}</td>
            </tr>`;
          }).join('')
        : `<tr>
                <td>Detalhar programa</td>
                <td style="text-align:center">h/a</td>
                <td>Nome e currículo resumido</td>
           </tr>
           <tr>
                <td>Detalhar programa</td>
                <td style="text-align:center">h/a</td>
                <td>Nome e currículo resumido</td>
           </tr>`;

    // ── linhas da relação de inscritos ────────────────────────────────
    const inscritosLinhas = alunos.length
        ? alunos.map((a, i) => `
            <tr>
                <td style="text-align:center;width:6%">${i + 1}</td>
                <td style="width:18%">${val(a.GRADUACAO)}</td>
                <td>${val(a.NOME)}</td>
                <td style="text-align:center;width:14%">${val(a.NUM_ORDEM)}</td>
            </tr>`).join('')
        : `<tr>
                <td style="text-align:center;width:6%">1</td>
                <td style="width:18%"></td><td></td>
                <td style="text-align:center;width:14%"></td>
           </tr>
           <tr>
                <td style="text-align:center;width:6%">2</td>
                <td style="width:18%"></td><td></td>
                <td style="text-align:center;width:14%"></td>
           </tr>`;

    // ── período + local combinados ────────────────────────────────────
    const periodoLocal = [p.PERIODO, p.LOCAL].filter(Boolean).join(', ');

    const html = `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="UTF-8">
<title>Plano de Instrução</title>
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; }
    @media print { @page { size: A4; margin: 15mm 15mm 15mm 15mm; } body { margin: 0; } }
    @media screen { body { margin: 15mm; } }

    table { width: 100%; border-collapse: collapse; }
    td, th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; font-size: 11pt; }

    /* Cabeçalho principal */
    .th-principal {
        font-weight: bold; text-transform: uppercase; text-align: center;
        font-size: 11pt; padding: 5px;
    }
    /* Cabeçalho de seção (cinza) */
    .th-secao {
        background: #d9d9d9; font-weight: bold; text-transform: uppercase;
        text-align: center; font-size: 11pt; padding: 4px;
    }
    /* Sub-cabeçalho de coluna */
    .th-col {
        font-weight: bold; text-transform: uppercase;
        text-align: center; font-size: 10pt; padding: 3px 5px;
    }
    /* Células label (coluna esquerda) */
    .td-label { font-weight: normal; width: 27%; }

    .titulo-plano { font-weight:bold; text-transform:uppercase; text-align:center; font-size:11pt; margin-bottom:5px; line-height:1.4; }
    ul { margin: 2px 0 2px 16px; padding: 0; }
    li { margin: 1px 0; }
</style>
</head>
<body>
<p class="titulo-plano">NP Nº ${val(p.NP_SEI)||('(Nº GERADO PELO SEI)')} - PLANO DE INSTRUÇÃO Nº ${val(p.NUMERO_PLANO)||('/ANO')} - OPM - PROCESSO DE REFERÊNCIA Nº (Nº GERADO PELO SEI INCLUÍDO COMO LINK)</p>
<table>
    <!-- ── DADOS GERAIS ── -->
    <tr>
        <td class="td-label" colspan="1">Nome do evento</td>
        <td colspan="3">${val(p.NOME_EVENTO)}</td>
    </tr>
    <tr>
        <td class="td-label">Justificativa</td>
        <td colspan="3">${val(p.JUSTIFICATIVA)}</td>
    </tr>
    <tr>
        <td class="td-label">Objetivo Geral</td>
        <td colspan="3">${val(p.OBJ_GERAL)}</td>
    </tr>
    <tr>
        <td class="td-label">Objetivos Específicos</td>
        <td colspan="3">${bullets(p.OBJ_ESPECIFICOS)}</td>
    </tr>
    <tr>
        <td class="td-label">Público-alvo</td>
        <td colspan="3">${val(p.PUBLICO_ALVO)}</td>
    </tr>
    <tr>
        <td class="td-label">Quantidade de vagas ofertadas</td>
        <td colspan="3">${val(p.VAGAS)}</td>
    </tr>

    <!-- ── CONTEÚDO PROGRAMÁTICO ── -->
    <tr>
        <td colspan="4" class="th-secao">Conteúdo Programático</td>
    </tr>
    <tr>
        <td class="th-col" style="width:36%">Temas Bordados</td>
        <td class="th-col" style="width:20%">Quantidade de Hora-Aula</td>
        <td class="th-col" colspan="2">Instrutor</td>
    </tr>
    ${conteudoLinhas}
    <tr>
        <td>Total de hora/aula</td>
        <td style="text-align:center">${val(p.CARGA_TOTAL) || 'Soma de todas horas/aulas'}</td>
        <td colspan="2">${val(p.PROPORCAO) || 'Proporção de Teoria e Prática'}</td>
    </tr>

    <!-- ── DETALHAMENTO ── -->
    <tr>
        <td class="td-label">Metodologia</td>
        <td colspan="3">${val(p.METODOLOGIA) || 'Qual a forma a instrução será ministrada? Elementos didáticos?'}</td>
    </tr>
    <tr>
        <td class="td-label">Período e local de realização da instrução</td>
        <td colspan="3">${val(periodoLocal) || 'Período, local e horário, conforme carga horária estabelecida'}</td>
    </tr>
    <tr>
        <td class="td-label">Material Didático Necessário</td>
        <td colspan="3">${val(p.MATERIAL) || 'Especificar o que precisa para a ministração da instrução'}</td>
    </tr>
    <tr>
        <td class="td-label">Critério de Avaliação dos discentes</td>
        <td colspan="3">${val(p.AVALIACAO) || 'Prova objetiva/subjetiva/conceito.'}</td>
    </tr>

    <!-- ── RELAÇÃO DE INSCRITOS ── -->
    <tr>
        <td colspan="4" class="th-secao">Relação de Inscritos</td>
    </tr>
    <tr>
        <td class="th-col" style="width:6%">Ord.</td>
        <td class="th-col" style="width:18%">Posto/Graduação</td>
        <td class="th-col">Nome</td>
        <td class="th-col" style="width:14%">Número de Ordem</td>
    </tr>
    ${inscritosLinhas}

    <!-- ── CONTATO P3 ── -->
    <tr>
        <td colspan="4" class="th-secao">Contato da P3 da OPM</td>
    </tr>
    <tr>
        <td class="td-label">Telefone celular (Whatsapp)</td>
        <td colspan="3">${val(p.TEL_P3)}</td>
    </tr>
    <tr>
        <td class="td-label">Email (Gmail)</td>
        <td colspan="3">${val(p.EMAIL_P3)}</td>
    </tr>
</table>
</' + 'body>
</' + 'html>`;

    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    const s = w.document.createElement('script');
    s.textContent = 'window.onload = () => window.print();';
    w.document.head.appendChild(s);
};

// ====================================================================
// GERAR PLANO DE INSTRUÇÃO — .DOCX (client-side via docx.js CDN)
// ====================================================================
window.gerarDocxPlano = async function (id) {
    const docxLib = window.docx;
    if (!docxLib) { alert('Biblioteca docx.js não carregada. Verifique a conexão.'); return; }

    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign } = docxLib;

    const p = cache.planos[id];
    if (!p) { alert('Plano não encontrado.'); return; }
    const alunos = Object.values(cache.alunos).filter(a => a.CURSO_ID === p.CURSO_ID);

    // ── Layout A4 margens 15mm ────────────────────────────────────────
    // 1 polegada = 1440 DXA | 1mm ≈ 56.7 DXA
    const W = 11906;          // largura A4
    const MRG = 851;            // 15 mm
    const CONT = W - MRG * 2;   // 10204 DXA

    // 4 colunas-base (somam CONT):
    //   B1=ORD(612)  B2=POSTO/GRAD(2040)  B3=NOME(5512)  B4=Nº ORDEM(2040)
    //   B1+B2 = 2652 ≈ label(27%)  |  B3+B4 = 7552 ≈ valor(73%)
    const B1 = 612;
    const B2 = 2040;
    const B3 = 5512;
    const B4 = CONT - B1 - B2 - B3;  // 2040

    const fnt = 'Times New Roman';
    const SZ = 20;   // 10pt
    const SZh = 22;   // 11pt

    const brd = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
    const bordas = { top: brd, bottom: brd, left: brd, right: brd };
    const marg = { top: 50, bottom: 50, left: 80, right: 80 };

    // ── Helpers de texto ──────────────────────────────────────────────
    const run = (text, opts = {}) => new TextRun({
        text: String(text ?? ''), font: fnt,
        size: opts.sz || SZ, bold: opts.bold || false,
        italics: opts.italic || false, allCaps: opts.caps || false,
    });

    const par = (runs, opts = {}) => new Paragraph({
        alignment: opts.align || AlignmentType.LEFT,
        spacing: { before: opts.before || 0, after: opts.after || 0 },
        children: Array.isArray(runs) ? runs : [runs],
    });

    // Texto simples → parágrafos (split por \n)
    const parMulti = texto => {
        if (!texto) return [par(run(''))];
        return texto.split('\n').filter(l => l.trim())
            .map(l => par(run(l.trim(), { sz: SZ })));
    };

    // Texto → lista de bullets (detecta \n ou ;)
    const parBullets = texto => {
        if (!texto) return [par(run(''))];
        const itens = texto.split(/\n|;\s*/).map(s => s.trim()).filter(Boolean);
        if (itens.length <= 1) return parMulti(texto);
        return itens.map(item => par(run('• ' + item, { sz: SZ })));
    };

    // ── Helpers de célula ─────────────────────────────────────────────
    const cel = (texto, w, opts = {}) => new TableCell({
        borders: bordas, margins: marg,
        width: { size: w, type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
        columnSpan: opts.span || 1,
        children: [par(run(String(texto ?? ''), { bold: opts.bold, sz: opts.sz || SZ, caps: opts.caps }),
            { align: opts.align || AlignmentType.LEFT })]
    });

    const celM = (paragrafos, w, opts = {}) => new TableCell({
        borders: bordas, margins: marg,
        width: { size: w, type: WidthType.DXA },
        verticalAlign: VerticalAlign.TOP,
        shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
        columnSpan: opts.span || 1,
        children: paragrafos,
    });

    const row = (...cells) => new TableRow({ children: cells });

    // Helpers de linha frequentes
    // label(B1+B2) | valor(B3+B4) — 2 colunas com span
    const linhaDados = (label, valor) => row(
        cel(label, B1 + B2, { span: 2 }),
        cel(valor, B3 + B4, { span: 2 })
    );
    const linhaDadosM = (label, paragrafos) => row(
        cel(label, B1 + B2, { span: 2 }),
        celM(paragrafos, B3 + B4, { span: 2 })
    );
    // Linha de seção (cinza, 4 colunas mescladas)
    const linhaSecao = titulo => row(
        cel(titulo, CONT, {
            bold: true, caps: true, span: 4,
            fill: 'D9D9D9', align: AlignmentType.CENTER, sz: SZh
        })
    );

    const parCabecalho = new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 0, after: 100 },
        children: [new TextRun({
            text: `NP Nº ${p.NP_SEI || '(Nº GERADO PELO SEI)'} - PLANO DE INSTRUÇÃO` +
                  ` Nº ${p.NUMERO_PLANO || '/ANO'} - OPM - PROCESSO DE REFERÊNCIA` +
                  ` Nº (Nº GERADO PELO SEI INCLUÍDO COMO LINK)`,
            font: fnt, size: SZh, bold: true, allCaps: true,
        })],
    });

    // ── Monta as linhas ───────────────────────────────────────────────
    const rows = [];

    // 1. DADOS GERAIS
    rows.push(linhaDados('Nome do evento', p.NOME_EVENTO || ''));
    rows.push(linhaDadosM('Justificativa', parMulti(p.JUSTIFICATIVA || '')));
    rows.push(linhaDadosM('Objetivo Geral', parMulti(p.OBJ_GERAL || '')));
    rows.push(linhaDadosM('Objetivos Específicos', parBullets(p.OBJ_ESPECIFICOS || '')));
    rows.push(linhaDados('Público-alvo', p.PUBLICO_ALVO || ''));
    rows.push(linhaDados('Quantidade de vagas ofertadas', String(p.VAGAS || '')));

    // 3. CONTEÚDO PROGRAMÁTICO
    rows.push(linhaSecao('Conteúdo Programático'));
    // sub-cabeçalho: TEMAS(B1+B2) | H/A(B3 parcial≈37%) | INSTRUTOR(B4+resto)
    // Usamos: TEMAS=B1+B2=2652 | H/A=B3=5512 (largo) → melhor repartir
    // Temas(~36%) = 3672 | H/A(~20%) = 2040 | Instrutor(~44%) = resto
    // Mas precisamos que somem CONT com span correto sobre 4 cols base
    // Mais simples: TEMAS span(B1+B2)=2652 | H/A span(B3 parte) — usa 3 células
    // Célula 1: span=2 (B1+B2=2652) | Célula 2: sem span (B3=5512→usamos como H/A) | Célula3: B4
    // Isso dá H/A muito largo. Melhor: proporção fiel à imagem:
    // Col TEMAS ≈ 36% CONT = 3673  Col H/A ≈ 20% CONT = 2040  Col INSTRUTOR = restante
    // Mapear sobre cols base: span2(B1+B2)=2652 | B3 dividido internamente não possível com span
    // Solução limpa: usar 3 células com larguras explícitas e a tabela com 4 cols base,
    // deixando TEMAS=span2, H/A e INSTRUTOR cada com colSpan=1, ajustando B3 e B4
    // B3=5512 vai ser H/A e INSTRUTOR mesclados → melhor deixar H/A=B4=2040 e INSTRUTOR=B3=5512
    rows.push(row(
        cel('Temas Bordados', B1 + B2, { bold: true, span: 2, align: AlignmentType.CENTER, sz: SZh }),
        cel('Instrutor', B3, { bold: true, align: AlignmentType.CENTER, sz: SZh }),
        cel('Quantidade de Hora-Aula', B4, { bold: true, align: AlignmentType.CENTER, sz: SZh })
    ));
    // Nota: invertemos B3 e B4 na posição: col3=H/A(B4=2040) col4=INSTRUTOR(B3=5512)
    // Precisamos declarar columnWidths como [B1, B2, B4, B3] para isso funcionar
    // → vamos guardar essa inversão e declarar no final

    const getCurriculoDocx = nome => {
        if (!nome) return '';
        const inst = Object.values(cache.instrutores || {}).find(i =>
            (`${i.GRADUACAO||''} ${i.NOME||''}`).trim() === nome.trim() ||
            (i.NOME||'').trim() === nome.trim()
        );
        return (inst && inst.CURRICULO) ? inst.CURRICULO : '';
    };
    const celInstrutor = (nome, larg) => {
        const cur = getCurriculoDocx(nome);
        const children = [par(run(nome || '', { sz: SZ }))];
        if (cur) children.push(par(run(cur, { sz: 18, italic: true })));
        return new TableCell({
            borders: bordas, margins: marg,
            width: { size: larg, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            children,
        });
    };
    const conteudoArr = (p.CONTEUDO && p.CONTEUDO.length) ? p.CONTEUDO : [
        { tema: 'Detalhar programa', ha: 'h/a', instrutor: 'Nome e currículo resumido' },
        { tema: 'Detalhar programa', ha: 'h/a', instrutor: 'Nome e currículo resumido' },
    ];
    conteudoArr.forEach(c => {
        rows.push(row(
            cel(c.tema || '', B1 + B2, { span: 2 }),
            celInstrutor(c.instrutor || '', B3),
            cel(c.ha   || '', B4, { align: AlignmentType.CENTER })
        ));
    });
    const periodoLocal = [p.PERIODO, p.LOCAL].filter(Boolean).join(', ');
    rows.push(row(
        cel('Total de hora/aula', B1 + B2, { span: 2 }),
        cel(p.PROPORCAO || 'Proporção de Teoria e Prática', B3),
        cel(p.CARGA_TOTAL || 'Soma de todas horas/aulas', B4, { align: AlignmentType.CENTER })
    ));

    // 4. DETALHAMENTO
    rows.push(linhaDadosM('Metodologia',
        parMulti(p.METODOLOGIA || 'Qual a forma a instrução será ministrada? Elementos didáticos?')));
    rows.push(linhaDadosM('Período e local de realização da instrução',
        parMulti(periodoLocal || 'Período, local e horário, conforme carga horária estabelecida')));
    rows.push(linhaDadosM('Material Didático Necessário',
        parMulti(p.MATERIAL || 'Especificar o que precisa para a ministração da instrução')));
    rows.push(linhaDadosM('Critério de Avaliação dos discentes',
        parMulti(p.AVALIACAO || 'Prova objetiva/subjetiva/conceito.')));

    // 5. RELAÇÃO DE INSCRITOS
    rows.push(linhaSecao('Relação de Inscritos'));
    rows.push(row(
        cel('Ord.', B1, { bold: true, align: AlignmentType.CENTER, sz: SZh }),
        cel('Posto/Graduação', B2, { bold: true, align: AlignmentType.CENTER, sz: SZh }),
        cel('Nome', B3, { bold: true, align: AlignmentType.CENTER, sz: SZh }),
        cel('Número de Ordem', B4, { bold: true, align: AlignmentType.CENTER, sz: SZh })
    ));
    const inscritosArr = alunos.length ? alunos : [
        { GRADUACAO: '', NOME: '', NUM_ORDEM: '' }, { GRADUACAO: '', NOME: '', NUM_ORDEM: '' },
    ];
    inscritosArr.forEach((a, i) => {
        rows.push(row(
            cel(String(i + 1), B1, { align: AlignmentType.CENTER }),
            cel(a.GRADUACAO || '', B2),
            cel(a.NOME || '', B3),
            cel(a.NUM_ORDEM || '', B4, { align: AlignmentType.CENTER })
        ));
    });

    // 6. CONTATO P3
    rows.push(linhaSecao('Contato da P3 da OPM'));
    rows.push(linhaDados('Telefone celular (Whatsapp)', p.TEL_P3 || ''));
    rows.push(linhaDados('Email (Gmail)', p.EMAIL_P3 || ''));

    // ── Tabela única ──────────────────────────────────────────────────
    // columnWidths na ordem real das células: B1, B2, B4(H/A), B3(Instrutor/Nome)
    const tabelaUnica = new Table({
        width: { size: CONT, type: WidthType.DXA },
        columnWidths: [B1, B2, B3, B4],
        rows,
    });

    const doc = new Document({
        sections: [{
            properties: {
                page: {
                    size: { width: W, height: 16838 },
                    margin: { top: MRG, right: MRG, bottom: MRG, left: MRG }
                }
            },
            children: [parCabecalho, tabelaUnica]
        }]
    });

    const blob = await Packer.toBlob(doc);
    const nomeArq = `Plano_Instrucao_${(p.NUMERO_PLANO || 'sem_numero').replace(/\//g, '-')}.docx`;
    if (window.saveAs) {
        window.saveAs(blob, nomeArq);
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = nomeArq; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
};


// ====================================================================
// EFETIVO DA UNIDADE — Upload XLS + Autocomplete (Alunos e Instrutores)
// ====================================================================

let efetivo = [];

// ── Persistência na sessão ────────────────────────────────────────────
function carregarEfetivoSessao() {
    try {
        const salvo = sessionStorage.getItem('efetivo_unidade');
        if (salvo) { efetivo = JSON.parse(salvo); atualizarStatusEfetivo(); }
    } catch (e) { efetivo = []; }
}
function salvarEfetivoSessao() {
    try { sessionStorage.setItem('efetivo_unidade', JSON.stringify(efetivo)); } catch (e) { }
}

// ── Painel de status ──────────────────────────────────────────────────
function atualizarStatusEfetivo() {
    const el = document.getElementById('efetivo-status');
    const btnVer = document.getElementById('btn-ver-efetivo');
    if (!el) return;
    if (efetivo.length > 0) {
        el.innerHTML = `<span>Efetivo carregado:</span>
            <span class="badge-count">${efetivo.length} militares</span>`;
        if (btnVer) btnVer.style.display = '';
    } else {
        el.innerHTML = '<span>Nenhum efetivo carregado.</span>';
        if (btnVer) btnVer.style.display = 'none';
    }
}

function toggleTabelaEfetivo() {
    const wrap = document.getElementById('tabela-efetivo-wrap');
    const btn = document.getElementById('btn-ver-efetivo');
    if (!wrap) return;
    const visivel = wrap.style.display !== 'none';
    wrap.style.display = visivel ? 'none' : 'block';
    if (btn) btn.textContent = visivel ? '👁️ Ver Efetivo' : '🙈 Ocultar';
    if (!visivel) renderPreviewEfetivo();
}

function renderPreviewEfetivo() {
    const tbody = document.getElementById('corpo-efetivo-preview');
    if (!tbody) return;
    tbody.innerHTML = efetivo.map(m => `
        <tr>
            <td>${m.pg || ''}</td><td>${m.nome || ''}</td><td>${m.nomeGuerra || ''}</td>
            <td>${m.matricula || ''}</td><td>${m.numOrdem || ''}</td>
            <td>${m.cpf || ''}</td><td>${m.opm || ''}</td><td>${m.situacao || ''}</td>
        </tr>`).join('');
}

// ── Parser SpreadsheetML (.xls exportado do sistema) ──────────────────
function parseXlsEfetivo(fileText) {
    const idx = fileText.indexOf('<?xml');
    const clean = (idx > 0 ? fileText.slice(idx) : fileText)
        .replace(/<\?mso-application[^?]*\?>/g, '');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(clean, 'application/xml');
    const NS = 'urn:schemas-microsoft-com:office:spreadsheet';
    const rows = xmlDoc.getElementsByTagNameNS(NS, 'Row');
    if (!rows.length) return [];

    const headers = Array.from(rows[0].getElementsByTagNameNS(NS, 'Data'))
        .map(c => (c.textContent || '').trim());

    const col = name => headers.findIndex(h => h === name);
    const pg = col('P/G'), nome = col('Nome'), cpf = col('Cpf'), mat = col('Matrícula'),
        ord = col('Nº Ordem'), opm = col('Opm'), sit = col('Situação'),
        ng = col('Nome Guerra'), tel = col('Telefone'), eml = col('E-mail');

    const resultado = [];
    for (let r = 1; r < rows.length; r++) {
        const cells = rows[r].getElementsByTagNameNS(NS, 'Data');
        const get = i => i >= 0 && cells[i] ? (cells[i].textContent || '').trim() : '';
        const n = get(nome);
        if (!n) continue;
        resultado.push({
            pg: get(pg), nome: n, nomeGuerra: get(ng),
            cpf: get(cpf), matricula: get(mat), numOrdem: get(ord),
            opm: get(opm), situacao: get(sit),
            telefone: get(tel), email: get(eml),
        });
    }
    return resultado;
}

// ── Evento de upload ──────────────────────────────────────────────────
function iniciarUploadEfetivo() {
    const input = document.getElementById('input-efetivo-xls');
    if (!input) return;
    input.addEventListener('change', function () {
        const file = this.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            const parsed = parseXlsEfetivo(e.target.result);
            if (!parsed.length) {
                alert('Não foi possível ler o efetivo.\nVerifique se o arquivo é o XLS correto do sistema.');
                return;
            }
            efetivo = parsed;
            salvarEfetivoSessao();
            atualizarStatusEfetivo();
            alert(`✅ Efetivo carregado!\n${efetivo.length} militares importados.`);
        };
        reader.readAsText(file, 'UTF-8');
        this.value = ''; // permite re-upload do mesmo arquivo
    });
}

// ── Autocomplete genérico ─────────────────────────────────────────────
// Cria uma instância de autocomplete para qualquer par input/lista.
// onSelect(militar) é chamado quando o usuário clica num resultado.
function criarAutocomplete({ inputId, listaId, btnLimparId, avisoId, onSelect }) {
    const input = document.getElementById(inputId);
    const lista = document.getElementById(listaId);
    const btnLimpar = document.getElementById(btnLimparId);
    if (!input || !lista) return;

    let indiceSel = -1;
    const fechar = () => { lista.style.display = 'none'; indiceSel = -1; };

    input.addEventListener('input', function () {
        const termo = this.value.trim().toLowerCase();
        if (btnLimpar) btnLimpar.style.display = termo ? '' : 'none';
        indiceSel = -1;

        if (!termo || termo.length < 2) { fechar(); return; }

        if (!efetivo.length) {
            const av = document.getElementById(avisoId);
            if (av) av.style.display = '';
            fechar(); return;
        }
        const av = document.getElementById(avisoId);
        if (av) av.style.display = 'none';

        const filtrados = efetivo.filter(m =>
            m.nome.toLowerCase().includes(termo) ||
            m.nomeGuerra.toLowerCase().includes(termo) ||
            m.matricula.includes(termo) ||
            m.cpf.includes(termo)
        ).slice(0, 12);

        if (!filtrados.length) {
            lista.innerHTML = '<div class="autocomplete-vazio">Nenhum militar encontrado.</div>';
            lista.style.display = ''; return;
        }

        lista.innerHTML = filtrados.map(m => {
            const idx = efetivo.indexOf(m);
            return `<div class="autocomplete-item" data-efidx="${idx}">
                <div class="ac-linha1">
                    <span class="ac-grad">${m.pg}</span>
                    <span class="ac-nome">${m.nome}</span>
                </div>
                <div class="ac-meta">Mat: ${m.matricula} &nbsp;|&nbsp; Nº Ord: ${m.numOrdem} &nbsp;|&nbsp; CPF: ${m.cpf}</div>
            </div>`;
        }).join('');

        lista.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault(); // evita blur no input antes do click
                const m = efetivo[parseInt(item.dataset.efidx)];
                onSelect(m);
                input.value = `${m.pg} ${m.nome}`;
                if (btnLimpar) btnLimpar.style.display = '';
                fechar();
            });
        });
        lista.style.display = '';
    });

    input.addEventListener('keydown', function (e) {
        const itens = lista.querySelectorAll('.autocomplete-item');
        if (!itens.length || lista.style.display === 'none') return;
        if (e.key === 'ArrowDown') { e.preventDefault(); indiceSel = Math.min(indiceSel + 1, itens.length - 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); indiceSel = Math.max(indiceSel - 1, 0); }
        else if (e.key === 'Enter' && indiceSel >= 0) { e.preventDefault(); itens[indiceSel].dispatchEvent(new Event('mousedown')); return; }
        else if (e.key === 'Escape') { fechar(); return; }
        itens.forEach((it, i) => it.classList.toggle('selecionado', i === indiceSel));
        if (indiceSel >= 0) itens[indiceSel].scrollIntoView({ block: 'nearest' });
    });

    document.addEventListener('click', e => {
        if (!input.contains(e.target) && !lista.contains(e.target)) fechar();
    });

    if (btnLimpar) {
        btnLimpar.addEventListener('click', () => {
            input.value = '';
            btnLimpar.style.display = 'none';
            fechar();
        });
    }
}

// ── Converte P/G da planilha para o padrão do sistema ─────────────────
function normalizarGraduacao(pg) {
    if (!pg) return '';
    const map = [
        [/^cel/i, 'CEL PM'], [/^tc/i, 'TC PM'], [/^maj/i, 'MAJ PM'], [/^cap/i, 'CAP PM'],
        [/^1.?\s*ten/i, '1º TEN PM'], [/^2.?\s*ten/i, '2º TEN PM'],
        [/^sub\s*ten/i, 'SUBTEN PM'], [/^1.?\s*sgt/i, '1º SGT PM'],
        [/^2.?\s*sgt/i, '2º SGT PM'], [/^3.?\s*sgt/i, '3º SGT PM'],
        [/^cb/i, 'CB PM'], [/^sd/i, 'SD PM'],
    ];
    for (const [re, label] of map) if (re.test(pg.trim())) return label;
    return pg.trim().toUpperCase();
}

// ── Inicializa os dois autocompletes ──────────────────────────────────
function iniciarAutocompletes() {
    criarAutocomplete({
        inputId: 'busca-efetivo-input',
        listaId: 'autocomplete-lista',
        btnLimparId: 'btn-limpar-busca-efetivo',
        avisoId: 'aviso-sem-efetivo',
        onSelect: m => {
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
            set('aluno-grad', normalizarGraduacao(m.pg));
            set('aluno-nome', m.nome);
            set('aluno-ordem', m.numOrdem);
            set('aluno-mat', m.matricula);
            set('aluno-cpf', m.cpf);
            set('aluno-opm', m.opm);
        }
    });

    criarAutocomplete({
        inputId: 'busca-efetivo-instrutor',
        listaId: 'autocomplete-lista-instrutor',
        btnLimparId: 'btn-limpar-busca-instrutor',
        avisoId: 'aviso-sem-efetivo-instrutor',
        onSelect: m => {
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
            set('instrutor-grad', normalizarGraduacao(m.pg));
            set('instrutor-nome', m.nome);
            set('instrutor-ordem', m.numOrdem);
            set('instrutor-mat', m.matricula);
            set('instrutor-tel', m.telefone);
            set('instrutor-email', m.email);
        }
    });
}

// ── Verifica efetivo ao abrir sidebar de aluno ou instrutor ───────────
function verificarEfetivo(tipo) {
    const avisoMap = { aluno: 'aviso-sem-efetivo', instrutor: 'aviso-sem-efetivo-instrutor' };
    const inputMap = { aluno: 'busca-efetivo-input', instrutor: 'busca-efetivo-instrutor' };
    const listaMap = { aluno: 'autocomplete-lista', instrutor: 'autocomplete-lista-instrutor' };
    const btnMap = { aluno: 'btn-limpar-busca-efetivo', instrutor: 'btn-limpar-busca-instrutor' };

    const aviso = document.getElementById(avisoMap[tipo]);
    if (aviso) aviso.style.display = efetivo.length === 0 ? '' : 'none';

    const inputEl = document.getElementById(inputMap[tipo]);
    if (inputEl) inputEl.value = '';
    const listaEl = document.getElementById(listaMap[tipo]);
    if (listaEl) listaEl.style.display = 'none';
    const btnEl = document.getElementById(btnMap[tipo]);
    if (btnEl) btnEl.style.display = 'none';
}
// ====================================================================
// AÇÃO EM LOTE — ALUNOS
// ====================================================================
function atualizarBarraLote() {
    const selecionados = document.querySelectorAll('.cb-linha:checked');
    const barra = document.getElementById('barra-lote-alunos');
    const contador = document.getElementById('lote-contador');
    const cbTodos = document.getElementById('cb-todos-alunos');
    const total = document.querySelectorAll('.cb-linha').length;

    if (selecionados.length > 0) {
        barra.classList.add('ativa');
        contador.textContent = `${selecionados.length} selecionado${selecionados.length > 1 ? 's' : ''}`;
    } else {
        barra.classList.remove('ativa');
    }
    // Atualiza estado do "selecionar todos"
    if (cbTodos) {
        cbTodos.checked = selecionados.length === total && total > 0;
        cbTodos.indeterminate = selecionados.length > 0 && selecionados.length < total;
    }
}

function selecionarTodosAlunos(checked) {
    document.querySelectorAll('.cb-linha').forEach(cb => cb.checked = checked);
    atualizarBarraLote();
}

function limparSelecaoAlunos() {
    document.querySelectorAll('.cb-linha').forEach(cb => cb.checked = false);
    const barra = document.getElementById('barra-lote-alunos');
    if (barra) barra.classList.remove('ativa');
    const cbTodos = document.getElementById('cb-todos-alunos');
    if (cbTodos) { cbTodos.checked = false; cbTodos.indeterminate = false; }
}

async function aplicarStatusEmLote() {
    const selecionados = [...document.querySelectorAll('.cb-linha:checked')];
    if (!selecionados.length) return;

    const novoStatus = document.getElementById('lote-status-select').value;
    const total = selecionados.length;

    if (!confirm(`Alterar ${total} aluno${total > 1 ? 's' : ''} para "${novoStatus}"?`)) return;

    const barra = document.getElementById('barra-lote-alunos');
    barra.querySelector('.btn-lote-aplicar').textContent = '⏳ Salvando...';
    barra.querySelector('.btn-lote-aplicar').disabled = true;

    // Salva em paralelo no Firebase
    const promises = selecionados.map(cb => {
        const id = cb.value;
        cache.alunos[id].SITUACAO = novoStatus;
        return fbPatch(NODES.alunos, id, { SITUACAO: novoStatus });
    });
    await Promise.all(promises);

    // Re-renderiza mantendo o filtro de curso ativo
    const cursoid = document.getElementById('filtro-aluno-curso').value;
    if (cursoid) {
        const filtrado = {};
        Object.entries(cache.alunos).forEach(([id, a]) => {
            if (a.CURSO_ID === cursoid) filtrado[id] = a;
        });
        renderAlunos(filtrado);
    } else {
        renderAlunos();
    }
    limparSelecaoAlunos();
}

// ====================================================================
// UTILITÁRIOS
// ====================================================================
function formatarData(d) {
    if (!d) return '-';
    const [a, m, dia] = d.split('-');
    return dia ? `${dia}/${m}/${a}` : d;
}

function atualizarRelogio() {
    const agora = new Date();
    const data  = agora.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long', year: 'numeric' });
    const hora  = agora.toLocaleTimeString('pt-BR');
    const el    = document.getElementById('relogio');
    if (el) el.innerHTML = `${data}<br>${hora}`;
}

function atualizarContadores() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('count-cursos',      Object.keys(cache.cursos      || {}).length);
    set('count-instrutores', Object.keys(cache.instrutores || {}).length);
    set('count-alunos',      Object.keys(cache.alunos      || {}).length);
    set('count-planos',      Object.keys(cache.planos      || {}).length);
    set('count-tiro',        Object.keys(cache.tiro        || {}).length);
}

function checkLogin() {
    const grad = localStorage.getItem('userGraduacao');
    const nome = localStorage.getItem('userNomeGuerra');
    const el   = document.getElementById('user-info');
    if (grad && nome) {
        if (el) el.innerHTML = `<p>Bem Vindo(a):</p><p class="user-nome">${grad} ${nome}</p>`;
    } else {
        window.location.href = '../page/login.html';
    }
}

function logout() {
    localStorage.removeItem('userGraduacao');
    localStorage.removeItem('userNomeGuerra');
    window.location.href = '../page/login.html';
}

// ====================================================================
// INICIALIZAÇÃO — tudo dentro do DOMContentLoaded
// ====================================================================
document.addEventListener('DOMContentLoaded', () => {
    checkLogin();
    atualizarRelogio();
    setInterval(atualizarRelogio, 1000);

    // Botões fechar sidebar
    ['curso', 'instrutor', 'aluno', 'plano', 'tiro'].forEach(tipo => {
        const btn = document.getElementById(`btn-fechar-${tipo}`);
        if (btn) btn.addEventListener('click', fecharTodasSidebars);
    });
    const overlayEl = document.getElementById('overlay-sidebar');
    if (overlayEl) overlayEl.addEventListener('click', fecharTodasSidebars);

    // Submits dos formulários
    ['curso', 'instrutor', 'aluno', 'plano', 'tiro'].forEach(tipo => {
        const frm = document.getElementById(`form-${tipo}`);
        if (frm) frm.addEventListener('submit', e => { e.preventDefault(); handleSubmit(tipo); });
    });

    // Logout
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.onclick = logout;

    // Carrega dados do Firebase
    carregarTodos();

    // Efetivo (upload XLS + autocomplete)
    carregarEfetivoSessao();
    iniciarUploadEfetivo();
    iniciarAutocompletes();
});
// ====================================================================
// RELATÓRIO DE INSTRUÇÃO — Imprimir (abre relatorio_instrucao.html)
// ====================================================================
window.imprimirRelatorio = function(id) {
    const p = cache.planos[id];
    if (!p) return;

    const todosAlunos = Object.values(cache.alunos).filter(a => a.CURSO_ID === p.CURSO_ID);
    const concluintes = todosAlunos
        .filter(a => a.SITUACAO === 'APROVADO')
        .sort((a, b) => (a.NUM_ORDEM || '').localeCompare(b.NUM_ORDEM || ''));
    const totalOPM = todosAlunos.length;

    const instMap = new Map();
    (p.CONTEUDO || []).forEach(c => {
        if (!c.instrutor) return;
        const inst = Object.values(cache.instrutores).find(i =>
            (`${i.GRADUACAO || ''} ${i.NOME || ''}`).trim() === c.instrutor.trim() ||
            (i.NOME || '').trim() === c.instrutor.trim()
        );
        if (!instMap.has(c.instrutor)) {
            instMap.set(c.instrutor, {
                grad: inst?.GRADUACAO || '',
                nome: inst?.NOME || c.instrutor,
                temas: [c.tema || ''],
                ha: c.ha || ''
            });
        } else {
            instMap.get(c.instrutor).temas.push(c.tema || '');
        }
    });

    sessionStorage.setItem('relatorio_instrucao', JSON.stringify({
        plano: p,
        instrutores: [...instMap.values()],
        concluintes: concluintes,
        totalOPM: totalOPM
    }));

    window.open('../relatorios/relatorioinstrucoes.html', '_blank');
};

// ====================================================================
// RELATÓRIO DE INSTRUÇÃO — .DOCX
// ====================================================================
window.gerarDocxRelatorio = async function(id) {
    const docxLib = window.docx;
    if (!docxLib) { alert('Biblioteca docx.js não carregada.'); return; }

    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            AlignmentType, BorderStyle, WidthType, ShadingType, VerticalAlign } = docxLib;

    const p = cache.planos[id];
    if (!p) return;

    const todosAlunos = Object.values(cache.alunos).filter(a => a.CURSO_ID === p.CURSO_ID);
    const concluintes = todosAlunos
        .filter(a => a.SITUACAO === 'APROVADO')
        .sort((a, b) => (a.NUM_ORDEM || '').localeCompare(b.NUM_ORDEM || ''));
    const totalOPM = todosAlunos.length;

    const instMap = new Map();
    (p.CONTEUDO || []).forEach(c => {
        if (!c.instrutor) return;
        const inst = Object.values(cache.instrutores).find(i =>
            (`${i.GRADUACAO || ''} ${i.NOME || ''}`).trim() === c.instrutor.trim() ||
            (i.NOME || '').trim() === c.instrutor.trim()
        );
        if (!instMap.has(c.instrutor)) {
            instMap.set(c.instrutor, { grad: inst?.GRADUACAO || '', nome: inst?.NOME || c.instrutor, temas: [c.tema || ''], ha: c.ha || '' });
        } else {
            instMap.get(c.instrutor).temas.push(c.tema || '');
        }
    });

    // A4 útil: 11906 - 2×851 = 10204 DXA — 7 colunas
    const CONT=10204;
    const D1=2244, D2=612, D3=816, D4=1122, D5=816, D6=714, D7=CONT-D1-D2-D3-D4-D5-D6; // D7=3880

    const fnt='Times New Roman', SZ=20, SZh=22;
    const bS={style:BorderStyle.SINGLE,size:4,color:'000000'};
    const bN={style:BorderStyle.NONE,  size:0,color:'FFFFFF'};
    const bAll={top:bS,bottom:bS,left:bS,right:bS};
    const bTop={top:bS,bottom:bN,left:bS,right:bS};
    const bMid={top:bN,bottom:bN,left:bS,right:bS};
    const bBot={top:bN,bottom:bS,left:bS,right:bS};

    const marg={top:50,bottom:50,left:80,right:80};
    const marg0={top:0,bottom:0,left:80,right:80};

    const run=(t,o={})=>new TextRun({text:String(t??''),font:fnt,size:o.sz||SZ,
        bold:!!o.bold,italics:!!o.italic,allCaps:!!o.caps});
    const par=(r,o={})=>new Paragraph({alignment:o.align||AlignmentType.LEFT,
        spacing:{before:0,after:0},children:Array.isArray(r)?r:[r]});
    const cel=(t,w,o={})=>new TableCell({
        borders:o.borders||bAll, margins:o.m||marg,
        width:{size:w,type:WidthType.DXA},
        verticalAlign:o.vAlign||VerticalAlign.TOP,
        shading:o.fill?{fill:o.fill,type:ShadingType.CLEAR}:undefined,
        columnSpan:o.span||1,
        children:[par(run(String(t??''),{bold:o.bold,sz:o.sz||SZ,caps:o.caps}),
                     {align:o.align||AlignmentType.LEFT})]
    });
    const row=(...cells)=>new TableRow({children:cells});
    const secao=t=>row(new TableCell({
        borders:bAll,margins:marg,columnSpan:7,
        width:{size:CONT,type:WidthType.DXA},
        shading:{fill:'D9D9D9',type:ShadingType.CLEAR},
        children:[par(run(t,{bold:true,sz:SZh,caps:true}),{align:AlignmentType.CENTER})]
    }));

    // BGO simulado com bordas seletivas (rowspan não suportado pelo docx.js)
    const celBGO1=new TableCell({borders:bTop,margins:marg,width:{size:D7,type:WidthType.DXA},
        children:[par(run('BGO DO PLANO',{bold:true,sz:SZh,caps:true}),{align:AlignmentType.CENTER})]});
    const celBGO2=new TableCell({borders:bMid,margins:marg0,width:{size:D7,type:WidthType.DXA},
        children:[par(run(''))]});
    const celBGO3=new TableCell({borders:bBot,margins:marg,width:{size:D7,type:WidthType.DXA},
        verticalAlign:VerticalAlign.BOTTOM,
        children:[par(run(p.NP_SEI||''),{align:AlignmentType.CENTER})]});

    const rows=[];

    const parCab=new Paragraph({
        alignment:AlignmentType.CENTER, spacing:{before:0,after:100},
        children:[new TextRun({
            text:`NP Nº ${p.NP_SEI||'(Nº GERADO PELO SEI)'} - RELATÓRIO DE INSTRUÇÃO`+
                 ` Nº ${p.NUMERO_PLANO||'/ANO'} – OPM - PROCESSO DE REFERÊNCIA`+
                 ` Nº (Nº GERADO PELO SEI INCLUÍDO COMO LINK)`,
            font:fnt,size:SZh,bold:true,allCaps:true
        })]
    });

    rows.push(row(
        cel('Nome do Evento',D1,{bold:true,align:AlignmentType.CENTER,sz:SZh}),
        cel('C/H',D2,{bold:true,align:AlignmentType.CENTER,sz:SZh}),
        cel('Número de Participantes',D3+D4+D5+D6,{bold:true,align:AlignmentType.CENTER,sz:SZh,span:4}),
        celBGO1
    ));
    rows.push(row(
        cel(p.NOME_EVENTO||'',D1,{vAlign:VerticalAlign.CENTER}),
        cel(p.CARGA_TOTAL||'',D2,{align:AlignmentType.CENTER,vAlign:VerticalAlign.CENTER}),
        cel('OPM',D3,{bold:true,align:AlignmentType.CENTER,sz:18}),
        cel('Outras OPM',D4,{bold:true,align:AlignmentType.CENTER,sz:18}),
        cel('Externo',D5,{bold:true,align:AlignmentType.CENTER,sz:18}),
        cel('Total',D6,{bold:true,align:AlignmentType.CENTER,sz:18}),
        celBGO2
    ));
    rows.push(row(
        cel('',D1),cel('',D2),
        cel(String(totalOPM),D3,{align:AlignmentType.CENTER}),
        cel('-',D4,{align:AlignmentType.CENTER}),
        cel('-',D5,{align:AlignmentType.CENTER}),
        cel(String(totalOPM),D6,{align:AlignmentType.CENTER}),
        celBGO3
    ));
    rows.push(row(
        cel('Da Equipe Técnica Responsável',D1,{bold:true}),
        cel(p.EQUIPE_TECNICA||'Citar todos os envolvidos que possibilitaram a realização do evento.',D2+D3+D4+D5+D6+D7,{span:6})
    ));
    rows.push(row(
        cel('Intercorrência envolvendo policiais',D1),
        cel(p.INTERCORRENCIA||'Ex: disciplina, acidente com policial, entre outros.',D2+D3+D4+D5+D6+D7,{span:6})
    ));
    rows.push(row(
        cel('Observações/Sugestões',D1),
        cel(p.OBSERVACOES||'Outras informações a critério.',D2+D3+D4+D5+D6+D7,{span:6})
    ));

    rows.push(secao('RELAÇÃO DO(S) INSTRUTOR(ES)'));
    rows.push(row(
        cel('Ord',D2,{bold:true,align:AlignmentType.CENTER,sz:SZh}),
        cel('Posto/Graduação',D3+D4,{bold:true,align:AlignmentType.CENTER,sz:SZh,span:2}),
        cel('Nome',D1,{bold:true,align:AlignmentType.CENTER,sz:SZh}),
        cel('Tema Ministrado',D5+D6,{bold:true,align:AlignmentType.CENTER,sz:SZh,span:2}),
        cel('Carga Horária',D7,{bold:true,align:AlignmentType.CENTER,sz:SZh})
    ));
    const instArr=[...instMap.values()];
    (instArr.length>0?instArr:[{grad:'',nome:'',temas:[''],ha:''},{grad:'',nome:'',temas:[''],ha:''}])
    .forEach((inst,i)=>{
        rows.push(row(
            cel(String(i+1),D2,{align:AlignmentType.CENTER}),
            cel(inst.grad,D3+D4,{span:2}),
            cel(inst.nome,D1),
            cel(inst.temas.join('; '),D5+D6,{span:2}),
            cel(inst.ha,D7,{align:AlignmentType.CENTER})
        ));
    });

    rows.push(secao('RELAÇÃO DOS CONCLUINTES'));
    rows.push(row(
        cel('Ord',D2,{bold:true,align:AlignmentType.CENTER,sz:SZh}),
        cel('Posto/Graduação',D3+D4,{bold:true,align:AlignmentType.CENTER,sz:SZh,span:2}),
        cel('Nome',D1+D5+D6,{bold:true,align:AlignmentType.CENTER,sz:SZh,span:3}),
        cel('Número de Ordem',D7,{bold:true,align:AlignmentType.CENTER,sz:SZh})
    ));
    const concArr=concluintes.length>0?concluintes:[{GRADUACAO:'',NOME:'',NUM_ORDEM:''},{GRADUACAO:'',NOME:'',NUM_ORDEM:''}];
    concArr.forEach((a,i)=>{
        rows.push(row(
            cel(String(i+1),D2,{align:AlignmentType.CENTER}),
            cel(a.GRADUACAO||'',D3+D4,{span:2}),
            cel(a.NOME||'',D1+D5+D6,{span:3}),
            cel(a.NUM_ORDEM||'',D7,{align:AlignmentType.CENTER})
        ));
    });

    const tabela=new Table({width:{size:CONT,type:WidthType.DXA},columnWidths:[D1,D2,D3,D4,D5,D6,D7],rows});
    const doc=new Document({sections:[{properties:{
        page:{size:{width:11906,height:16838},margin:{top:851,right:851,bottom:851,left:851}}
    },children:[parCab,tabela]}]});

    const blob=await Packer.toBlob(doc);
    const nome=`Relatorio_Instrucao_${(p.NUMERO_PLANO||'sem_numero').replace(/\//g,'-')}.docx`;
    if(window.saveAs){window.saveAs(blob,nome);}
    else{
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;a.download=nome;a.click();
        setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
};