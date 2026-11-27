/* ====================================================================
   P2 · Controle de Operações da P2
   --------------------------------------------------------------------
   • CRUD de operações (tb_p2_operacoes).
   • Vínculos (tb_p2_operacao_vinculos), com MULTISSELEÇÃO:
       - Ocorrência do CAD: por PERÍODO da unidade (Firebase /geral),
         detalhe completo e snapshot salvo no banco.
       - RELINT / Ficha Alvo (com foto) / Denúncia / Mandado: lista
         completa já no modal + busca + seleção múltipla.
   • Auto-preenchimento: ao vincular uma Ficha Alvo, puxa automaticamente
     as denúncias, RELINTs, mandados e endereços já ligados àquela pessoa.
   • RELOP com análise inicial do Xerife (só no exe) + editável/imprimível.
   Requer as tabelas de tools/p2-operacoes.sql no Supabase.
   ==================================================================== */
(function () {
    'use strict';
    const alvo = P2.iniciar({ active: 'controle-operacoes-p2', titulo: 'Controle de Operações', sub: 'Operações da P2' });
    if (!alvo) return;
    const esc = P2.esc, sb = P2.sb;
    const BACKEND = (window.P3AtualizadorLocal && P3AtualizadorLocal.URL_BASE) || 'http://127.0.0.1:5057';
    const dataBr = v => { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : (v || ''); };
    const plain = h => { const t = document.createElement('div'); t.innerHTML = String(h || ''); return (t.textContent || '').replace(/\s+/g, ' ').trim(); };
    const isoHoje = () => new Date().toISOString().slice(0, 10);

    const STATUS = { planejamento: { lab: 'Planejamento', cls: 'azul' }, em_andamento: { lab: 'Em andamento', cls: 'verde' }, concluida: { lab: 'Concluída', cls: 'cinza' }, cancelada: { lab: 'Cancelada', cls: 'verm' } };
    const TIPOS = {
        ocorrencia_cad: { lab: 'Ocorrências (CAD)', ic: '🚓' },
        ficha_alvo: { lab: 'Fichas Alvo', ic: '🪪' },
        denuncia: { lab: 'Denúncias', ic: '📞' },
        relint: { lab: 'RELINTs', ic: '📄' },
        mandado: { lab: 'Mandados', ic: '⚖️' },
    };

    let OPS = [], EQUIPES = {}, CIDADES = {}, filtro = { q: '', status: 'todas' };
    let OP = null, VINC = [], DBURL = null;
    let RELOPS = [];                    // RELOPs já produzidos (tb_relops do Echelon)
    let prefRelop = null;              // RELOP de origem ao criar operação (provisão p/ salvar)
    let vista = 'calendario';           // 'calendario' (padrão) | 'lista'
    let calRef = new Date();            // mês exibido no calendário
    const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const DIAS_SEM = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    // ── Modal genérico ────────────────────────────────────────────────
    function modal(titulo, corpoHtml, rodapeHtml, larg) {
        let m = document.getElementById('op-modal');
        if (!m) { m = document.createElement('div'); m.id = 'op-modal'; m.className = 'pd-modal'; document.body.appendChild(m); }
        m.innerHTML = `<div class="pd-modal-box" style="width:min(${larg || 720}px,100%)">
            <div class="pd-modal-h"><h2>${titulo}</h2><button class="fechar" id="op-modal-x">✕</button></div>
            <div class="pd-modal-b" id="op-modal-b">${corpoHtml}</div>
            <div class="pd-modal-f" id="op-modal-f">${rodapeHtml || ''}</div></div>`;
        m.classList.add('aberto');
        m.querySelector('#op-modal-x').onclick = fecharModal;
        return m;
    }
    const fecharModal = () => { const m = document.getElementById('op-modal'); if (m) m.classList.remove('aberto'); };

    // ── Lightbox de imagem (abre a imagem ampliada em modal) ──────────
    function abrirImagem(url, legenda) {
        if (!url) return;
        let lb = document.getElementById('p2-lightbox');
        if (!lb) {
            lb = document.createElement('div'); lb.id = 'p2-lightbox'; lb.className = 'p2-lightbox';
            document.body.appendChild(lb);
            lb.addEventListener('click', () => lb.classList.remove('aberto'));
            document.addEventListener('keydown', e => { if (e.key === 'Escape') lb.classList.remove('aberto'); });
        }
        lb.innerHTML = `<div class="p2-lb-box"><button class="p2-lb-x" title="Fechar (Esc)">✕</button>
            <img src="${esc(url)}" alt="${esc(legenda || '')}">${legenda ? `<div class="p2-lb-cap">${esc(legenda)}</div>` : ''}</div>`;
        lb.querySelector('.p2-lb-box').onclick = e => e.stopPropagation();
        lb.querySelector('.p2-lb-x').onclick = () => lb.classList.remove('aberto');
        lb.classList.add('aberto');
    }

    // ── Carregamento ──────────────────────────────────────────────────
    carregar();
    async function carregar() {
        try { DBURL = (await P3.loadUnidadeConfig()).firebase.databaseURL; } catch (e) { DBURL = null; }
        try {
            const [eqs, cids] = await Promise.all([
                sb.get('tb_equipes', 'select=id,nome').catch(() => []),
                sb.get('tb_cidades', 'select=id,nome&ativo=eq.true&order=nome').catch(() => []),
            ]);
            (eqs || []).forEach(e => EQUIPES[e.id] = e.nome); (cids || []).forEach(c => CIDADES[c.id] = c.nome);
            try { RELOPS = await sb.get('tb_relops', 'select=id,numero,data_documento,operacao,assunto,referente,narrativa,observacoes,status,arquivo_path&order=data_documento.desc.nullslast&limit=300'); } catch (e) { RELOPS = []; }
            await carregarOps();
        } catch (e) { erroFatal(e); }
    }
    async function carregarOps() {
        try { OPS = await sb.get('tb_p2_operacoes', 'select=*&order=criado_em.desc.nullslast&limit=300'); }
        catch (e) { if (/HTTP 40|not exist|relation|does not/i.test(e.message)) return semTabelas(); return erroFatal(e); }
        const op = new URLSearchParams(location.search).get('op');
        if (op) { const o = OPS.find(x => String(x.id) === op); if (o) return abrirWorkspace(o); }
        renderLista();
    }
    function semTabelas() {
        alvo.innerHTML = `<div class="p2-page-head"><h1><i class="fa-solid fa-calendar-check"></i> Controle de Operações</h1></div>
            <div class="p2-card"><div class="p2-empty"><div class="ic">🗄️</div><h3>Tabelas ainda não criadas</h3>
            <p>Rode uma vez o arquivo <b>tools/p2-operacoes.sql</b> no Supabase (SQL Editor) para criar
               <code>tb_p2_operacoes</code> e <code>tb_p2_operacao_vinculos</code>. Depois recarregue.</p></div></div>`;
    }
    function erroFatal(e) { alvo.innerHTML = `<div class="p2-empty"><div class="ic">⚠️</div><h3>Erro</h3><p>${esc(e.message)}</p></div>`; }

    // ── LISTA / CALENDÁRIO de operações ───────────────────────────────
    function renderLista() {
        history.replaceState(null, '', location.pathname); OP = null; VINC = [];
        alvo.innerHTML = `
            <div class="p2-page-head"><h1><i class="fa-solid fa-calendar-check"></i> Controle de Operações da P2</h1>
                <p>Crie operações, vincule ocorrências do CAD, RELINTs, fichas de alvo, denúncias e mandados, e gere o RELOP com análise do Xerife.</p></div>
            <div class="pd-filtros">
                <div class="op-vista-tabs" role="tablist">
                    <button class="op-vtab${vista === 'calendario' ? ' on' : ''}" data-vista="calendario"><i class="fa-solid fa-calendar-days"></i> Calendário</button>
                    <button class="op-vtab${vista === 'lista' ? ' on' : ''}" data-vista="lista"><i class="fa-solid fa-table-cells-large"></i> Lista</button>
                </div>
                <input class="pd-sel" id="op-q" placeholder="🔍 código, título, objetivo…" style="min-width:180px" value="${esc(filtro.q)}">
                <select class="pd-sel" id="op-fstatus"><option value="todas">Todos os status</option>${Object.keys(STATUS).map(k => `<option value="${k}"${filtro.status === k ? ' selected' : ''}>${STATUS[k].lab}</option>`).join('')}</select>
                <button class="p2-btn pri" id="op-nova" style="margin-left:auto"><i class="fa-solid fa-plus"></i> Nova operação</button>
            </div><div id="op-vista"></div>`;
        document.getElementById('op-q').oninput = e => { filtro.q = e.target.value.toLowerCase(); renderVista(); };
        document.getElementById('op-fstatus').onchange = e => { filtro.status = e.target.value; renderVista(); };
        document.getElementById('op-nova').onclick = () => formOperacao(null);
        alvo.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => { vista = b.dataset.vista; alvo.querySelectorAll('[data-vista]').forEach(x => x.classList.toggle('on', x.dataset.vista === vista)); renderVista(); });
        renderVista();
    }
    function opsFiltradas() {
        let lista = OPS.slice();
        if (filtro.status !== 'todas') lista = lista.filter(o => (o.status || 'planejamento') === filtro.status);
        if (filtro.q) lista = lista.filter(o => [o.codigo, o.titulo, plain(o.objetivo), o.area].join(' ').toLowerCase().includes(filtro.q));
        return lista;
    }
    function renderVista() { vista === 'lista' ? renderListaGrade() : renderCalendario(); }
    function bindOps(box) { box.querySelectorAll('[data-op]').forEach(c => c.onclick = () => { const o = OPS.find(x => String(x.id) === c.dataset.op); if (o) abrirWorkspace(o); }); }

    function renderListaGrade() {
        const lista = opsFiltradas(), box = document.getElementById('op-vista');
        if (!lista.length) { box.innerHTML = `<div class="p2-empty"><div class="ic">📁</div><h3>Nenhuma operação</h3><p>Clique em “Nova operação”.</p></div>`; return; }
        box.innerHTML = '<div class="op-grid">' + lista.map(cardOp).join('') + '</div>';
        bindOps(box);
    }

    // Converte "AAAA-MM-DD" → Date local (sem fuso); null se inválida.
    function dStr(v) { const m = String(v || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
    const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

    // Operação já criada a partir de um RELOP (dedup por código == número do RELOP).
    function opDoRelop(r) {
        const num = String(r.numero || '').trim();
        return num ? OPS.find(o => String(o.codigo || '').trim() === num) : null;
    }
    function relopsFiltrados() {
        let l = RELOPS.slice();
        if (filtro.q) l = l.filter(r => [r.numero, r.operacao, r.assunto, r.referente].join(' ').toLowerCase().includes(filtro.q));
        return l;
    }
    function renderCalendario() {
        const lista = opsFiltradas(), box = document.getElementById('op-vista');
        const ref = calRef, ano = ref.getFullYear(), mes = ref.getMonth();
        const hoje = ymd(new Date());
        // mapa dia(YYYY-MM-DD) → operações que ocorrem nele (span início..fim)
        const porDia = {}, relopDia = {}; const semData = [];
        lista.forEach(o => {
            const ini = dStr(o.data_inicio), fim = dStr(o.data_fim) || ini;
            if (!ini) { semData.push(o); return; }
            const a = ini, b = (fim && fim >= ini) ? fim : ini;
            for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) { (porDia[ymd(d)] = porDia[ymd(d)] || []).push(o); }
        });
        // RELOPs já produzidos — só os que ainda NÃO viraram operação (os já
        // importados aparecem como a própria operação). Posicionados em data_documento.
        const relopsPend = relopsFiltrados().filter(r => !opDoRelop(r));
        relopsPend.forEach(r => { const d = dStr(r.data_documento); if (d) (relopDia[ymd(d)] = relopDia[ymd(d)] || []).push(r); });
        const primeiro = new Date(ano, mes, 1), obrigado = new Date(ano, mes + 1, 0).getDate();
        const offset = primeiro.getDay();
        let celulas = '';
        for (let i = 0; i < offset; i++) celulas += '<div class="op-cal-cel vazio"></div>';
        for (let dia = 1; dia <= obrigado; dia++) {
            const key = ano + '-' + String(mes + 1).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
            const ops = porDia[key] || [], rls = relopDia[key] || [];
            const chipsOp = ops.slice(0, 4).map(o => `<span class="op-cal-chip st-${esc(o.status || 'planejamento')}" data-op="${esc(o.id)}" title="${esc(o.titulo || '')}">${esc(o.titulo || 'Operação')}</span>`).join('');
            const chipsRl = rls.slice(0, 3).map(r => `<span class="op-cal-chip relop" data-relop="${esc(r.id)}" title="RELOP ${esc(r.numero || '')} — clique para criar a operação">📄 ${esc(r.operacao || r.assunto || ('RELOP ' + (r.numero || '')))}</span>`).join('');
            const tot = ops.length + rls.length;
            const mais = tot > 7 ? `<span class="op-cal-mais">+${tot - 7}</span>` : '';
            celulas += `<div class="op-cal-cel${key === hoje ? ' hoje' : ''}${tot ? ' tem' : ''}"><div class="op-cal-num">${dia}</div>${chipsOp}${chipsRl}${mais}</div>`;
        }
        box.innerHTML = `
            <div class="op-cal-bar">
                <button class="p2-btn" id="cal-prev"><i class="fa-solid fa-chevron-left"></i></button>
                <div class="op-cal-titulo">${MESES[mes]} <b>${ano}</b></div>
                <button class="p2-btn" id="cal-next"><i class="fa-solid fa-chevron-right"></i></button>
                <button class="p2-btn" id="cal-hoje" style="margin-left:8px">Hoje</button>
                ${relopsPend.length ? `<button class="p2-btn" id="cal-import" title="Criar operações a partir dos RELOPs já produzidos"><i class="fa-solid fa-file-import"></i> Importar RELOPs (${relopsPend.length})</button>` : ''}
                <span class="op-cal-leg" style="margin-left:auto">
                    <span><i class="dot st-planejamento"></i>Planejamento</span><span><i class="dot st-em_andamento"></i>Em andamento</span>
                    <span><i class="dot st-concluida"></i>Concluída</span><span><i class="dot st-cancelada"></i>Cancelada</span>
                    <span><i class="dot relop"></i>RELOP produzido</span>
                </span>
            </div>
            <div class="op-cal-grade">
                ${DIAS_SEM.map(d => `<div class="op-cal-dow">${d}</div>`).join('')}
                ${celulas}
            </div>
            ${semData.length ? `<div class="op-cal-semdata"><h3><i class="fa-regular fa-calendar-xmark"></i> Sem data definida (${semData.length})</h3><div class="op-grid">${semData.map(cardOp).join('')}</div></div>` : ''}
            ${!lista.length && !relopsPend.length ? `<div class="p2-empty"><div class="ic">📁</div><h3>Nenhuma operação</h3><p>Clique em “Nova operação”.</p></div>` : ''}`;
        document.getElementById('cal-prev').onclick = () => { calRef = new Date(ano, mes - 1, 1); renderCalendario(); };
        document.getElementById('cal-next').onclick = () => { calRef = new Date(ano, mes + 1, 1); renderCalendario(); };
        document.getElementById('cal-hoje').onclick = () => { calRef = new Date(); renderCalendario(); };
        const bi = document.getElementById('cal-import'); if (bi) bi.onclick = () => importarRelops(relopsPend);
        box.querySelectorAll('[data-relop]').forEach(c => c.onclick = () => { const r = RELOPS.find(x => String(x.id) === c.dataset.relop); if (r) verRelop(r); });
        bindOps(box);
    }
    // Mapeia um RELOP (tb_relops) → campos da operação da P2.
    function prefillDeRelop(r) {
        return {
            codigo: r.numero || '',
            titulo: r.operacao || r.assunto || ('RELOP ' + (r.numero || '')),
            status: (r.status === 'finalizado' || r.finalizado_em) ? 'concluida' : 'em_andamento',
            data_inicio: String(r.data_documento || '').slice(0, 10),
            data_fim: String(r.data_documento || '').slice(0, 10),
            objetivo: [r.assunto, r.referente].filter(Boolean).join(' — '),
            observacoes: r.observacoes || '',
            relop_texto: r.narrativa || '',
        };
    }
    // Importa em lote: cria uma operação para cada RELOP ainda não importado.
    async function importarRelops(pend) {
        if (!pend || !pend.length) return;
        if (!confirm(`Criar ${pend.length} operação(ões) a partir dos RELOPs já produzidos?\nOs RELOPs já importados são ignorados.`)) return;
        let ok = 0, erros = 0;
        for (const r of pend) {
            const p = prefillDeRelop(r);
            try {
                await sb.insert('tb_p2_operacoes', { codigo: p.codigo || null, titulo: p.titulo, status: p.status, data_inicio: p.data_inicio || null, data_fim: p.data_fim || null, objetivo: p.objetivo || null, observacoes: p.observacoes || null, relop_texto: p.relop_texto || null, relop_ia: { origem_relop_id: r.id, numero: r.numero }, atualizado_em: new Date().toISOString() });
                ok++;
            } catch (e) { erros++; }
        }
        alert(`Importação concluída: ${ok} criada(s)${erros ? ', ' + erros + ' com erro' : ''}.`);
        await carregarOps();
    }

    // ── RELOP: dados, prévia e impressão no MODELO do Echelon ─────────
    const SEL_CUMP = 'id,data_hora,situacao,resultado,relato,pessoa_id,endereco_id,mandado_id,tb_pessoas(nome_completo,cpf),tb_enderecos(tipo_logradouro,logradouro,numero,complemento,tb_bairros(nome),tb_cidades(nome),tb_estados(sigla)),tb_mandados(id,numero_mandado,tipo_mandado,processo,vara_comarca)';
    const PROD_SEL = 'id,cumprimento_id,destino_materiais,destino_pessoas,tb_produtividade_armas(tipo,calibre,quantidade),tb_produtividade_armas_brancas(tipo,quantidade),tb_produtividade_municoes(calibre,quantidade),tb_produtividade_drogas(tipo,quantidade,unidade),tb_produtividade_veiculos(classificacao,modelo,placa),tb_produtividade_aparelhos(marca,modelo,situacao),tb_produtividade_valores(moeda,valor,observacao),tb_produtividade_outros_materiais(descricao,quantidade,unidade,observacao),tb_produtividade_pessoas(is_conduzido,is_preso,tb_pessoas(nome_completo))';
    const INST_LINES = ['ESTADO DE ALAGOAS', 'SECRETARIA DE SEGURANÇA PÚBLICA', 'POLÍCIA MILITAR DE ALAGOAS', 'COMANDO DE POLICIAMENTO DA REGIÃO DO AGRESTE (CPRA)', 'CISP II – 10º BATALHÃO DE POLÍCIA MILITAR (10º BPM)', 'p2.10bpm@pm.al.gov.br'];
    const WARN_TOP = 'Conhecimento para assessoramento do processo decisório, não tendo finalidade probatória. Conforme previsto na DNISP, este documento e seus anexos não devem ser inseridos em procedimentos e/ou processos de qualquer natureza.';
    const WARN_BOT = 'O sigilo deste documento é protegido e controlado pela Lei n.º 12.527/11. A divulgação, o fornecimento, a utilização ou a reprodução desautorizada do seu conteúdo, a qualquer tempo ou por qualquer meio ou modo, inclusive mediante acesso ou facilitação de acesso indevidos, constituem condutas ilícitas que ensejam responsabilidades penais, civis e administrativas.';
    const TIPO_ANEXO = { mandado_assinado: 'MANDADO CUMPRIDO/ASSINADO', auto_busca_apreensao: 'AUTO DE BUSCA E APREENSÃO', auto_exibicao_apreensao: 'AUTO DE EXIBIÇÃO E APREENSÃO', bo_cop: 'BO/COP', relatorio_cumprimento_busca_apreensao: 'RELATÓRIO DE CUMPRIMENTO DE BUSCA E APREENSÃO', foto: 'FOTO', outro: 'OUTRO DOCUMENTO' };
    const tipoAnexoLabel = t => !t ? 'OUTRO DOCUMENTO' : (TIPO_ANEXO[t] || String(t).replace(/_/g, ' ').toUpperCase());
    function vR(v) { if (v === null || v === undefined) return 'X-X-X-X'; const t = String(v).trim(); return (!t || t === '-' || t === '—' || /^(null|undefined)$/i.test(t)) ? 'X-X-X-X' : t; }
    const uniq = a => Array.from(new Set((a || []).filter(x => x && x !== '—')));
    function listaNatural(a) { const u = uniq(a); return u.length <= 1 ? (u[0] || '—') : (u.slice(0, -1).join(', ') + ' e ' + u[u.length - 1]); }
    const seqRelop = n => { const p = String(n || '').split('/'); return (p[0] || 'SEM_NUMERO').padStart(3, '0'); };
    const cabNum = n => seqRelop(n) + '/10ºBPM/PM-2';
    const tituloAnexoA = q => q > 1 ? 'ANEXO A — MANDADOS CUMPRIDOS' : 'ANEXO A — MANDADO CUMPRIDO';
    function fmtDataBR(v) { if (!v) return '—'; const s = String(v); const d = new Date(s.length <= 10 ? s + 'T12:00:00' : s); return isNaN(d) ? s : d.toLocaleDateString('pt-BR'); }
    function endRelop(e) {
        if (!e) return '—';
        const base = [e.tipo_logradouro, e.logradouro].filter(Boolean).join(' ') + (e.numero ? (', ' + e.numero) : '') + (e.complemento ? (' — ' + e.complemento) : '');
        const b = e.tb_bairros && e.tb_bairros.nome ? (' — ' + e.tb_bairros.nome) : '';
        const c = e.tb_cidades && e.tb_cidades.nome ? (' — ' + e.tb_cidades.nome) : '';
        const uf = e.tb_estados && e.tb_estados.sigla ? ('/' + e.tb_estados.sigla) : '';
        return (base + b + c + uf).trim() || '—';
    }
    function fmtDataExt(d) { return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }); }
    function montarPeriodo(datas) {
        const arr = Array.from(new Map((datas || []).map(v => { const d = v ? new Date(v) : null; return (d && !isNaN(d)) ? d : null; }).filter(Boolean).sort((a, b) => a - b).map(d => [d.toISOString().slice(0, 10), d])).values());
        if (!arr.length) return '—';
        if (arr.length === 1) return fmtDataExt(arr[0]);
        const p = arr[0], u = arr[arr.length - 1];
        if (p.getMonth() === u.getMonth() && p.getFullYear() === u.getFullYear()) return p.toLocaleDateString('pt-BR', { day: '2-digit' }) + ' e ' + fmtDataExt(u);
        return fmtDataExt(p) + ' e ' + fmtDataExt(u);
    }
    function narrativaPadrao(itens) {
        if (!itens.length) return [];
        const periodo = montarPeriodo(itens.map(i => i.dataHora));
        const tipos = new Set(itens.map(i => (i.mandadoTipo || '').toUpperCase()));
        const mandados = tipos.size === 1 && tipos.has('MP') ? 'MANDADOS DE PRISÃO' : tipos.size === 1 && tipos.has('MB') ? 'MANDADOS DE BUSCA E APREENSÃO' : 'MANDADOS JUDICIAIS';
        const varas = listaNatural(itens.map(i => i.varaComarca));
        const processos = listaNatural(itens.map(i => i.processo));
        const cidadesV = Array.from(new Set(itens.map(i => (!i.cidade || i.cidade === '—') ? '' : (i.cidade + '/' + (i.uf || 'AL'))).filter(Boolean)));
        const loc = cidadesV.length > 1 ? ('nas cidades de ' + listaNatural(cidadesV)) : ('na cidade de ' + listaNatural(cidadesV));
        return [
            `Nos dias ${periodo}, foram devidamente cumpridos ${mandados} expedidos pela ${varas}, com origem nos Autos nº ${processos}, ${loc}.`,
            'O cumprimento dos mandados ocorreu mediante diligências realizadas pelas equipes policiais nos endereços determinados judicialmente. Foram efetuadas buscas nos limites das residências vinculadas aos alvos, em estrita observância às determinações constantes nas respectivas ordens judiciais.',
            'Segue a relação detalhada dos alvos, endereços e das apreensões realizadas nos respectivos limites das residências:',
        ];
    }
    function narrToParas(html) {
        if (!html || !String(html).trim()) return [];
        const host = document.createElement('div'); host.innerHTML = String(html);
        const blocos = Array.from(host.querySelectorAll('p,div,li'));
        if (blocos.length) return blocos.map(b => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
        const t = (host.textContent || '').replace(/\r/g, '').trim();
        return t ? t.split(/\n+/).map(s => s.trim()).filter(Boolean) : [];
    }
    // Monta o documento completo do RELOP (igual ao carregarRelopDocumento do Echelon).
    async function carregarRelopDoc(r) {
        let relop = r;
        try { const full = await sb.get('tb_relops', 'select=*&id=eq.' + r.id); if (full && full[0]) relop = full[0]; } catch (e) { }
        let itensRaw = [];
        try { itensRaw = await sb.get('tb_relop_cumprimentos', 'select=id,ordem,observacao,cumprimento_id,tb_mandado_cumprimentos(' + SEL_CUMP + ')&relop_id=eq.' + r.id + '&order=ordem'); } catch (e) { itensRaw = []; }
        const base = (itensRaw || []).filter(i => i.tb_mandado_cumprimentos);
        const cumpIds = base.map(i => i.tb_mandado_cumprimentos.id);
        const pessoaIds = Array.from(new Set(base.map(i => i.tb_mandado_cumprimentos.pessoa_id).filter(Boolean)));
        const apelidos = {};
        if (pessoaIds.length) { try { (await sb.get('tb_pessoa_apelidos', 'select=pessoa_id,apelido&pessoa_id=in.(' + pessoaIds.join(',') + ')')).forEach(a => { (apelidos[a.pessoa_id] = apelidos[a.pessoa_id] || []).push(a.apelido); }); } catch (e) { } }
        let anexos = [];
        if (cumpIds.length) { try { anexos = await sb.get('tb_missao_anexos', 'select=id,arquivo_nome,arquivo_path,arquivo_mime,legenda,tipo_documento,cumprimento_id,bucket_id,ordem&cumprimento_id=in.(' + cumpIds.join(',') + ')&order=cumprimento_id,ordem'); } catch (e) { anexos = []; } }
        const prodPor = {};
        if (cumpIds.length) {
            try {
                const prods = await sb.get('tb_produtividade', 'select=' + PROD_SEL + '&cumprimento_id=in.(' + cumpIds.join(',') + ')');
                for (const p of prods || []) {
                    const mats = [];
                    for (const a of p.tb_produtividade_armas || []) mats.push(`${a.quantidade} ARMA DE FOGO ${a.tipo}${a.calibre ? ` CAL. ${a.calibre}` : ''}`);
                    for (const a of p.tb_produtividade_armas_brancas || []) mats.push(`${a.quantidade} ARMA BRANCA ${a.tipo}`);
                    for (const m of p.tb_produtividade_municoes || []) mats.push(`${m.quantidade} MUNIÇÃO CAL. ${m.calibre}`);
                    for (const d of p.tb_produtividade_drogas || []) mats.push(`${d.quantidade}${d.unidade ? ` ${d.unidade}` : ''} DE ${d.tipo}`);
                    for (const v of p.tb_produtividade_veiculos || []) mats.push(`VEÍCULO ${v.classificacao}${v.modelo ? ` ${v.modelo}` : ''}${v.placa ? ` — ${v.placa}` : ''}`);
                    for (const ap of p.tb_produtividade_aparelhos || []) mats.push(`APARELHO ${ap.marca}${ap.modelo ? ` ${ap.modelo}` : ''} (${ap.situacao})`);
                    for (const val of p.tb_produtividade_valores || []) { const moeda = (val.moeda || 'BRL').toUpperCase(); const valor = Number(val.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); mats.push(`DINHEIRO ${moeda} ${valor}${val.observacao ? ` — ${val.observacao}` : ''}`); }
                    for (const o of p.tb_produtividade_outros_materiais || []) mats.push(`${o.quantidade || 1}${o.unidade ? ` ${o.unidade}` : ''} DE ${o.descricao}${o.observacao ? ` — ${o.observacao}` : ''}`);
                    const pes = (p.tb_produtividade_pessoas || []).map(pp => { const nome = ((pp.tb_pessoas && pp.tb_pessoas.nome_completo) || '—').toUpperCase(); return `${nome} (${pp.is_preso ? 'PRESO' : pp.is_conduzido ? 'CONDUZIDO' : 'ENVOLVIDO'})`; });
                    const alvo = prodPor[p.cumprimento_id] || (prodPor[p.cumprimento_id] = { materiais: [], pessoas: [] });
                    alvo.materiais.push(...mats); alvo.pessoas.push(...pes);
                }
            } catch (e) { }
        }
        const itens = base.map(it => {
            const c = it.tb_mandado_cumprimentos, p = c.tb_pessoas || {}, man = c.tb_mandados || {}, prod = prodPor[c.id] || { materiais: [], pessoas: [] };
            return {
                ordem: it.ordem, observacao: it.observacao || null,
                pessoaNome: (p.nome_completo || '—').toUpperCase(), vulgos: (apelidos[c.pessoa_id] || []).join(', '), cpf: p.cpf || null,
                enderecoLabel: endRelop(c.tb_enderecos), dataHora: c.data_hora, situacao: (c.situacao || '—').toUpperCase(),
                resultado: (c.resultado || '—').replace(/_/g, ' ').toUpperCase(), relato: c.relato || null,
                mandadoNumero: man.numero_mandado || '—', mandadoTipo: man.tipo_mandado || '—', processo: man.processo || '—', varaComarca: man.vara_comarca || '—',
                cidade: (c.tb_enderecos && c.tb_enderecos.tb_cidades && c.tb_enderecos.tb_cidades.nome) || '—', uf: (c.tb_enderecos && c.tb_enderecos.tb_estados && c.tb_enderecos.tb_estados.sigla) || 'AL',
                materiais: prod.materiais, pessoasConduzidas: prod.pessoas, anexos: anexos.filter(a => a.cumprimento_id === c.id),
            };
        });
        return { relop, itens, anexos: anexos || [] };
    }
    // Prévia na tela (mesmas informações do PDF, em layout de leitura).
    function relopHtml(rl, itens, imgs, docs, jaOp) {
        const campo = (l, v) => v ? `<div class="rl-f"><b>${l}</b><span>${esc(v)}</span></div>` : '';
        const lv = (l, v) => `<div class="rl-lv"><b>${esc(l)}:</b> ${esc(vR(v))}</div>`;
        const processos = uniq(itens.map(i => i.processo)).join(' / ');
        const itensHtml = itens.map(it => `<div class="rl-item"><div class="rl-item-h">${it.ordem}. ${esc(vR(it.pessoaNome))}${it.vulgos ? ` — VULGO: ${esc(it.vulgos.toUpperCase())}` : ''}${it.cpf ? ` · CPF ${esc(it.cpf)}` : ''}</div>
            ${lv('ENDEREÇO DO CUMPRIMENTO', it.enderecoLabel)}${lv('DATA DO CUMPRIMENTO', it.dataHora ? fmtDataBR(it.dataHora) : null)}${lv('AUTOS Nº', it.processo)}
            ${lv('MATERIAL APREENDIDO', it.materiais.length ? it.materiais.join('; ') : 'NADA ENCONTRADO.')}${lv('PESSOAS CONDUZIDAS/PRESAS', it.pessoasConduzidas.length ? it.pessoasConduzidas.join('; ') : null)}
            ${it.relato ? `<div class="rl-relato">${esc(it.relato)}</div>` : ''}${it.observacao ? `<div class="rl-relato"><i>Obs.: ${esc(plain(it.observacao))}</i></div>` : ''}</div>`).join('');
        const paras = narrToParas(rl.narrativa).length ? narrToParas(rl.narrativa) : narrativaPadrao(itens);
        return `<div class="rl-doc">
            <div class="rl-head"><div class="rl-num">RELOP Nº ${esc(cabNum(rl.numero))}</div>${jaOp ? '<span class="p2-badge verde" style="font-size:.62rem">Operação já criada</span>' : ''}</div>
            <div class="rl-grid">${campo('Data', fmtDataBR(rl.data_documento))}${campo('Operação', rl.operacao)}${campo('Assunto', rl.assunto)}${campo('Referente aos autos nº', rl.referente || processos)}${campo('Origem', rl.origem)}${campo('Difusão', rl.difusao)}${campo('Anexos', doc.anexos && doc.anexos.length ? tituloAnexoA(itens.length) : 'SEM ANEXOS')}</div>
            ${paras.length ? `<div class="rl-sec"><h4>Narrativa</h4><div class="rl-text">${paras.map(p => `<p>${esc(p)}</p>`).join('')}</div></div>` : ''}
            ${itensHtml ? `<div class="rl-sec"><h4>Relação de alvos (${itens.length})</h4>${itensHtml}</div>` : ''}
            ${rl.observacoes ? `<div class="rl-sec"><h4>Resumo / Observações</h4><div class="rl-text">${esc(rl.observacoes)}</div></div>` : ''}
            ${imgs.length ? `<div class="rl-sec"><h4>Imagens (${imgs.length})</h4><div class="rl-imgs">${imgs.map(a => `<figure class="rl-img"><img data-apath="${esc(a.arquivo_path)}" data-abucket="${esc(a.bucket_id || 'midia')}" alt="${esc(a.legenda || tipoAnexoLabel(a.tipo_documento))}">${a.legenda ? `<figcaption>${esc(a.legenda)}</figcaption>` : ''}</figure>`).join('')}</div></div>` : ''}
            ${docs.length ? `<div class="rl-sec"><h4>Documentos anexados (${docs.length})</h4>${docs.map(a => `<div class="op-anexo"><span class="fic">📄</span><span class="nm"><b>${esc(a.arquivo_nome || tipoAnexoLabel(a.tipo_documento))}</b><a href="#" data-adoc="${esc(a.id)}">abrir</a></span></div>`).join('')}</div>` : ''}
            ${!itensHtml && !paras.length && !imgs.length && !docs.length ? '<div class="fa-vazio" style="color:var(--p2-txt-dim2)">Este RELOP ainda não tem conteúdo detalhado (narrativa, cumprimentos ou anexos).</div>' : ''}
        </div>`;
    }
    let doc = null; // documento RELOP atualmente aberto na prévia
    async function verRelop(r) {
        modal('RELOP ' + (r.numero || ''), '<div class="fa-vazio">⏳ Carregando RELOP…</div>', '', 920);
        const box = document.getElementById('op-modal-b');
        try { doc = await carregarRelopDoc(r); } catch (e) { box.innerHTML = `<div class="fa-vazio" style="color:var(--p2-amber)">Erro ao carregar RELOP: ${esc(e.message)}</div>`; return; }
        const rl = doc.relop, jaOp = opDoRelop(r);
        const imgs = doc.anexos.filter(a => /^image\//.test(a.arquivo_mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(a.arquivo_nome || ''));
        const docs = doc.anexos.filter(a => !(imgs.indexOf(a) >= 0));
        box.innerHTML = relopHtml(rl, doc.itens, imgs, docs, jaOp);
        box.querySelectorAll('img[data-apath]').forEach(async im => { im.onclick = () => { if (im.src) abrirImagem(im.src, im.alt); }; const u = await sb.signUrl(im.dataset.abucket || 'midia', im.dataset.apath, 1800).catch(() => null); if (u) im.src = u; else im.outerHTML = '<div class="rl-imgfail">imagem indisponível</div>'; });
        box.querySelectorAll('[data-adoc]').forEach(a => a.onclick = async ev => { ev.preventDefault(); const an = doc.anexos.find(x => String(x.id) === a.dataset.adoc); if (!an) return; const u = await sb.signUrl(an.bucket_id || 'midia', an.arquivo_path, 600).catch(() => null); if (u) window.open(u, '_blank'); else alert('Não foi possível abrir o anexo.'); });
        const f = document.getElementById('op-modal-f');
        f.innerHTML = `<button class="p2-btn" onclick="document.getElementById('op-modal').classList.remove('aberto')">Fechar</button>
            <button class="p2-btn" id="rl-print"><i class="fa-solid fa-print"></i> Imprimir (modelo oficial)</button>
            <button class="p2-btn pri" id="rl-op">${jaOp ? '<i class="fa-solid fa-folder-open"></i> Abrir operação' : '<i class="fa-solid fa-plus"></i> Criar operação'}</button>`;
        document.getElementById('rl-print').onclick = () => imprimirRelopDoc(doc);
        document.getElementById('rl-op').onclick = () => { if (jaOp) { fecharModal(); abrirWorkspace(jaOp); } else formOperacao(null, r); };
    }
    // Impressão fiel ao modelo oficial do Echelon (cabeçalho institucional,
    // avisos ACESSO RESTRITO em cada página, campos, RELAÇÃO DE ALVOS e ANEXO A).
    async function imprimirRelopDoc(documento) {
        const rl = documento.relop, itens = documento.itens;
        const btn = document.getElementById('rl-print'); if (btn) { btn.disabled = true; btn.textContent = 'Preparando impressão…'; }
        const qtd = itens.length;
        const tituloCumpr = qtd === 1 ? 'CUMPRIMENTO DE MANDADO' : 'CUMPRIMENTO DE MANDADOS';
        const processos = uniq(itens.map(i => i.processo)).join(' / ');
        const cp = (l, v) => `<div class="cp"><b>${esc(l)}:</b> ${esc(vR(v))}</div>`;
        const lv = (l, v) => `<div class="lv"><b>${esc(l)}:</b> ${esc(vR(v))}</div>`;
        const matHtml = m => { const v = (m || []).map(x => (x || '').trim()).filter(Boolean); if (!v.length) return lv('MATERIAL APREENDIDO', 'NADA ENCONTRADO.'); if (v.length === 1) return lv('MATERIAL APREENDIDO', v[0]); return `<div class="lv"><b>MATERIAL APREENDIDO:</b></div>` + v.map((x, i) => `<div class="ml">${esc(x.replace(/[;.]$/, ''))}${i === v.length - 1 ? '.' : ';'}</div>`).join(''); };
        const paras = narrToParas(rl.narrativa).length ? narrToParas(rl.narrativa) : narrativaPadrao(itens);
        const alvos = itens.map(it => `<div class="alvo"><div class="alvo-id">${it.ordem}. ${esc(vR(it.pessoaNome))}${it.vulgos ? ` — VULGO: ${esc(it.vulgos.toUpperCase())}` : ''}</div>
            ${lv('ENDEREÇO DO CUMPRIMENTO', it.enderecoLabel)}${lv('DATA DO CUMPRIMENTO', it.dataHora ? fmtDataBR(it.dataHora) : null)}${lv('AUTOS Nº', it.processo)}${matHtml(it.materiais)}${lv('PESSOAS CONDUZIDAS/PRESAS', it.pessoasConduzidas.length ? it.pessoasConduzidas.join('; ') : null)}${it.observacao ? lv('OBSERVAÇÃO', plain(it.observacao)) : ''}</div>`).join('');
        // ANEXO A (assina URLs; imagens incorporadas, PDFs com link)
        let anexosHtml = '', primeiro = true;
        for (const it of itens.filter(i => i.anexos.length)) {
            for (const an of it.anexos) {
                const u = await sb.signUrl(an.bucket_id || 'midia', an.arquivo_path, 1800).catch(() => null);
                if (!u) continue;
                const nome = tipoAnexoLabel(an.tipo_documento);
                const autos = (it.processo && it.processo !== '—') ? it.processo : 'X-X-X-X';
                const ident = `${esc(it.pessoaNome)} — AUTOS Nº ${esc(autos)} — ${esc(nome)}`;
                const isImg = /^image\//.test(an.arquivo_mime || '') || /\.(png|jpe?g|gif|webp)$/i.test(an.arquivo_nome || '');
                const corpo = isImg ? `<div class="anexo-img"><img src="${esc(u)}"></div>`
                    : `<div class="anexo-note">Documento anexado ao RELOP (${esc(nome)}). <a href="${esc(u)}" target="_blank">Abrir arquivo original</a>.<br><small>Formato preservado no arquivo original; não incorporado a esta impressão.</small></div>`;
                anexosHtml += `<tr class="anexo-row"><td class="rof-body">${primeiro ? `<div class="anexo-tit">${esc(tituloAnexoA(qtd))}</div>` : ''}<div class="anexo-id">${ident}</div>${corpo}</td></tr>`;
                primeiro = false;
            }
        }
        const xsep = 'X' + '-X'.repeat(110);
        // Tabela com <thead>/<tfoot>: o cabeçalho de aviso e o rodapé repetem
        // em cada página sem sobrepor o conteúdo (o position:fixed na impressão
        // se ancora na área de conteúdo e sobrepunha o cabeçalho institucional).
        const html = `<table class="relop-of">
            <thead><tr><td class="rof-h"><div class="wbox">${esc(WARN_TOP)}</div><div class="restrito">ACESSO RESTRITO</div></td></tr></thead>
            <tfoot><tr><td class="rof-f"><div class="wbox wsmall">${esc(WARN_BOT)}</div><div class="restrito rsmall">ACESSO RESTRITO</div><div class="ts">Gerado em: ${esc(new Date().toLocaleString('pt-BR'))} — SISTEMA P3 / 10º BPM</div></td></tr></tfoot>
            <tbody>
                <tr><td class="rof-body">
                    <div class="inst"><img class="brasao" src="../img/brasao-pmal.png" onerror="this.style.display='none'"><img class="chancela" src="../img/chancela-direita.jfif" onerror="this.style.display='none'"><div class="inst-lines">${INST_LINES.map((l, i) => `<div class="${i < 3 ? 'b' : ''}${i === 5 ? ' em' : ''}">${esc(l)}</div>`).join('')}</div><hr></div>
                    <div class="titulo">RELOP - ${esc(tituloCumpr)} - Nº ${esc(cabNum(rl.numero))} - ${esc(fmtDataBR(rl.data_documento))}</div>
                    <div class="campos">${cp('DATA', fmtDataBR(rl.data_documento))}${cp('ASSUNTO', rl.assunto)}${cp('REFERENTE AOS AUTOS Nº', rl.referente || processos)}${cp('ORIGEM', rl.origem)}${cp('DIFUSÃO', rl.difusao)}${cp('DIFUSÃO ANTERIOR', rl.difusao_anterior)}${cp('REFERÊNCIA', rl.referencia)}${cp('OPERAÇÃO', rl.operacao)}${cp('ANEXOS', documento.anexos.length ? tituloAnexoA(qtd) : 'SEM ANEXOS')}</div>
                    ${paras.length ? `<div class="narr">${paras.map(p => `<p>${esc(p)}</p>`).join('')}</div>` : ''}
                    ${itens.length ? `<hr class="sep"><div class="sec-h">RELAÇÃO DE ALVOS</div>${alvos}` : ''}
                    ${rl.observacoes ? `<div class="sec-h">RESUMO / OBSERVAÇÕES</div><div class="obs">${esc(rl.observacoes)}</div>` : ''}
                    <div class="xsep">${xsep}</div>
                </td></tr>
                ${anexosHtml}
            </tbody>
        </table>
        <style>
        @page{ size:A4; margin:11mm 13mm; }
        .relop-of{ width:100%; border-collapse:collapse; font-family:Arial,Helvetica,sans-serif; color:#000; font-size:11px; }
        .relop-of td{ vertical-align:top; }
        .relop-of thead td.rof-h{ padding:0 0 5px; }
        .relop-of tfoot td.rof-f{ padding:5px 0 0; }
        .relop-of .rof-body{ padding:0; }
        .relop-of .wbox{ border:1px solid #b40000; color:#b40000; font-style:italic; font-size:6px; line-height:1.3; padding:3px 6px; text-align:center; }
        .relop-of .wbox.wsmall{ font-size:5px; }
        .relop-of .restrito{ background:#b40000; color:#fff; font-weight:bold; font-size:7px; text-align:center; width:52mm; margin:3px auto 0; padding:1.5px 0; }
        .relop-of .restrito.rsmall{ width:44mm; font-size:6px; margin:3px auto 2px; }
        .relop-of .ts{ text-align:center; color:#777; font-size:6px; margin-top:2px; }
        .relop-of .inst{ position:relative; text-align:center; margin:4px 0; min-height:22mm; }
        .relop-of .inst .brasao{ position:absolute; left:0; top:0; width:17mm; }
        .relop-of .inst .chancela{ position:absolute; right:0; top:0; width:15mm; }
        .relop-of .inst-lines div{ font-size:8px; line-height:1.55; }
        .relop-of .inst-lines div.b{ font-weight:bold; }
        .relop-of .inst-lines div.em{ font-size:7px; color:#333; }
        .relop-of .inst hr{ border:0; border-top:1px solid #000; margin:5px 0 0; }
        .relop-of .titulo{ text-align:center; font-weight:bold; font-size:11px; margin:8px 0; }
        .relop-of .campos .cp{ font-size:9px; margin:1.6px 0; }
        .relop-of .narr{ margin:8px 0; }
        .relop-of .narr p{ font-size:11px; line-height:1.5; text-align:justify; text-indent:10mm; margin:0 0 4px; }
        .relop-of .sep{ border:0; border-top:1px solid #aaa; margin:8px 0 4px; }
        .relop-of .sec-h{ font-weight:bold; font-size:10px; margin:9px 0 4px; }
        .relop-of .alvo{ margin-bottom:6px; page-break-inside:avoid; }
        .relop-of .alvo-id{ font-weight:bold; font-size:9px; margin-bottom:1px; }
        .relop-of .lv,.relop-of .ml{ font-size:9px; line-height:1.45; }
        .relop-of .obs{ font-size:9px; line-height:1.5; white-space:pre-wrap; }
        .relop-of .xsep{ font-weight:bold; font-size:9px; overflow:hidden; white-space:nowrap; margin:6px 0; }
        .relop-of .anexo-row{ page-break-before:always; }
        .relop-of .anexo-tit{ text-align:center; font-weight:bold; font-size:12px; margin-bottom:6px; }
        .relop-of .anexo-id{ font-weight:bold; font-size:8.5px; margin-bottom:5px; }
        .relop-of .anexo-img{ text-align:center; } .relop-of .anexo-img img{ max-width:100%; max-height:215mm; object-fit:contain; }
        .relop-of .anexo-note{ font-size:9px; border:1px solid #bbb; padding:8px; }
        </style>`;
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-print"></i> Imprimir (modelo oficial)'; }
        P2.imprimirDoc(html);
    }

    function cardOp(o) {
        const st = STATUS[o.status] || STATUS.planejamento;
        const per = [dataBr(o.data_inicio), dataBr(o.data_fim)].filter(Boolean).join(' – ');
        return `<div class="op-card st-${esc(o.status || 'planejamento')}" data-op="${esc(o.id)}">
            ${o.codigo ? `<div class="cod">${esc(o.codigo)}</div>` : ''}<h3>${esc(o.titulo || 'Operação')}</h3>
            <span class="p2-badge ${st.cls}">${st.lab}</span>
            ${o.objetivo ? `<div class="obj">${esc(plain(o.objetivo))}</div>` : ''}
            <div class="meta">${per ? `<span>📅 ${esc(per)}</span>` : ''}${o.equipe_id && EQUIPES[o.equipe_id] ? `<span>👥 ${esc(EQUIPES[o.equipe_id])}</span>` : ''}${o.cidade_id && CIDADES[o.cidade_id] ? `<span>📍 ${esc(CIDADES[o.cidade_id])}</span>` : ''}</div></div>`;
    }

    // ── FORM de operação ──────────────────────────────────────────────
    function formOperacao(o, relopPre) {
        prefRelop = (!o && relopPre) ? relopPre : null;
        const v = o || (prefRelop ? prefillDeRelop(prefRelop) : {});
        const optsEq = '<option value="">—</option>' + Object.keys(EQUIPES).map(id => `<option value="${esc(id)}"${v.equipe_id === id ? ' selected' : ''}>${esc(EQUIPES[id])}</option>`).join('');
        const optsCid = '<option value="">—</option>' + Object.keys(CIDADES).map(id => `<option value="${esc(id)}"${v.cidade_id === id ? ' selected' : ''}>${esc(CIDADES[id])}</option>`).join('');
        modal(o ? 'Editar operação' : 'Nova operação', `
            <div class="op-form">
                <div class="f"><label>Código</label><input id="f-cod" placeholder="Ex.: OP-2026/001" value="${esc(v.codigo || '')}"></div>
                <div class="f"><label>Status</label><select id="f-status">${Object.keys(STATUS).map(k => `<option value="${k}"${(v.status || 'planejamento') === k ? ' selected' : ''}>${STATUS[k].lab}</option>`).join('')}</select></div>
                <div class="f full"><label>Título <span class="req">*</span></label><input id="f-tit" placeholder="Nome da operação" value="${esc(v.titulo || '')}"></div>
                <div class="f"><label>Equipe</label><select id="f-eq">${optsEq}</select></div>
                <div class="f"><label>Cidade</label><select id="f-cid">${optsCid}</select></div>
                <div class="f"><label>Início</label><input type="date" id="f-ini" value="${esc(v.data_inicio || '')}"></div>
                <div class="f"><label>Fim</label><input type="date" id="f-fim" value="${esc(v.data_fim || '')}"></div>
                <div class="f full"><label>Área</label><input id="f-area" placeholder="Bairro, setor ou região de atuação" value="${esc(v.area || '')}"></div>
                <div class="f full"><label>Objetivo operacional</label><textarea id="f-obj" placeholder="O que a operação pretende alcançar…">${esc(v.objetivo || '')}</textarea></div>
                <div class="f full"><label>Observações</label><textarea id="f-obs">${esc(v.observacoes || '')}</textarea></div>
            </div><div class="pm-msg" id="f-msg" style="margin-top:12px"></div>`,
            `<button class="p2-btn" onclick="document.getElementById('op-modal').classList.remove('aberto')">Cancelar</button>
             <button class="p2-btn pri" id="f-salvar">💾 Salvar</button>`);
        document.getElementById('f-salvar').onclick = () => salvarOperacao(o);
    }
    async function salvarOperacao(o) {
        const g = id => document.getElementById(id).value;
        const titulo = g('f-tit').trim(), msg = document.getElementById('f-msg');
        if (!titulo) { msg.className = 'pm-msg erro'; msg.textContent = 'O título é obrigatório.'; return; }
        const payload = { codigo: g('f-cod').trim() || null, titulo, status: g('f-status'), equipe_id: g('f-eq') || null, cidade_id: g('f-cid') || null, data_inicio: g('f-ini') || null, data_fim: g('f-fim') || null, area: g('f-area').trim() || null, objetivo: g('f-obj').trim() || null, observacoes: g('f-obs').trim() || null, atualizado_em: new Date().toISOString() };
        // Criando a partir de um RELOP já produzido: leva a narrativa e a proveniência.
        if (!o && prefRelop) { payload.relop_texto = prefRelop.narrativa || null; payload.relop_ia = { origem_relop_id: prefRelop.id, numero: prefRelop.numero }; }
        try {
            const nova = o ? (await sb.patch('tb_p2_operacoes', 'id=eq.' + o.id, payload))[0] : (await sb.insert('tb_p2_operacoes', payload))[0];
            prefRelop = null;
            fecharModal(); await carregarOps();
            const o2 = OPS.find(x => String(x.id) === String(nova.id)); if (o2) abrirWorkspace(o2);
        } catch (e) { msg.className = 'pm-msg erro'; msg.textContent = 'Erro ao salvar: ' + e.message; }
    }

    // ── WORKSPACE ─────────────────────────────────────────────────────
    async function abrirWorkspace(o) {
        OP = o; history.replaceState(null, '', location.pathname + '?op=' + o.id);
        alvo.innerHTML = `<div class="p2-empty"><div class="ic">⏳</div><p>Abrindo operação…</p></div>`;
        try { VINC = await sb.get('tb_p2_operacao_vinculos', 'select=*&operacao_id=eq.' + o.id + '&order=criado_em'); } catch (e) { VINC = []; }
        renderWorkspace();
    }
    function renderWorkspace() {
        const o = OP, st = STATUS[o.status] || STATUS.planejamento;
        const porTipo = t => VINC.filter(v => v.tipo === t);
        const per = [dataBr(o.data_inicio), dataBr(o.data_fim)].filter(Boolean).join(' – ');
        alvo.innerHTML = `
            <div style="margin-bottom:12px"><a class="p2-btn" href="#" id="ws-voltar"><i class="fa-solid fa-arrow-left"></i> Operações</a></div>
            <div class="ws-top"><div class="ws-dados">
                ${o.codigo ? `<div style="font-size:.72rem;color:var(--p2-txt-dim2);font-weight:700">${esc(o.codigo)}</div>` : ''}
                <h1>${esc(o.titulo)}</h1><span class="p2-badge ${st.cls}">${st.lab}</span>
                <div class="ws-meta">${per ? `<span>📅 ${esc(per)}</span>` : ''}${o.equipe_id && EQUIPES[o.equipe_id] ? `<span>👥 ${esc(EQUIPES[o.equipe_id])}</span>` : ''}${o.cidade_id && CIDADES[o.cidade_id] ? `<span>📍 ${esc(CIDADES[o.cidade_id])}</span>` : ''}${o.area ? `<span>🗺️ ${esc(o.area)}</span>` : ''}</div>
                ${o.objetivo ? `<div style="margin-top:10px;font-size:.85rem;color:var(--p2-txt-dim)"><b style="color:var(--p2-txt-dim2)">Objetivo:</b> ${esc(plain(o.objetivo))}</div>` : ''}
            </div><div class="ws-acoes"><button class="p2-btn" id="ws-editar"><i class="fa-solid fa-pen"></i> Editar</button>
                <button class="p2-btn pri" id="ws-relop"><i class="fa-solid fa-file-contract"></i> Gerar RELOP (Xerife)</button></div></div>
            <div class="ws-cols">
                <div style="display:flex;flex-direction:column;gap:16px">${secVinc('ocorrencia_cad', porTipo('ocorrencia_cad'))}${secVinc('ficha_alvo', porTipo('ficha_alvo'))}${secVinc('mandado', porTipo('mandado'))}</div>
                <div style="display:flex;flex-direction:column;gap:16px">${secVinc('denuncia', porTipo('denuncia'))}${secVinc('relint', porTipo('relint'))}</div>
            </div>
            ${secInfo(porTipo('info'))}
            ${secAnexos(porTipo('anexo'))}
            <div class="ws-sec" style="margin-top:16px"><h2>🖼️ Imagens vinculadas <span class="cont" id="ws-img-cont"></span></h2>
                <div id="ws-imgs"><div class="fa-vazio" style="color:var(--p2-txt-dim2)">Carregando imagens…</div></div></div>
            ${o.relop_texto ? `<div class="ws-sec" style="margin-top:16px"><h2>📑 RELOP salvo</h2><div class="relop-ia">${esc(o.relop_texto)}</div>
                <div style="margin-top:10px"><button class="p2-btn" id="ws-imprimir-salvo"><i class="fa-solid fa-print"></i> Imprimir RELOP</button></div></div>` : ''}`;
        document.getElementById('ws-voltar').onclick = e => { e.preventDefault(); renderLista(); };
        document.getElementById('ws-editar').onclick = () => formOperacao(OP);
        document.getElementById('ws-relop').onclick = gerarRELOP;
        const imp = document.getElementById('ws-imprimir-salvo'); if (imp) imp.onclick = () => imprimirRelop(OP.relop_texto);
        alvo.querySelectorAll('[data-add]').forEach(b => b.onclick = () => abrirVincular(b.dataset.add));
        alvo.querySelectorAll('[data-desvinc]').forEach(b => b.onclick = () => desvincular(b.dataset.desvinc));
        const bInfo = document.getElementById('ws-add-info'); if (bInfo) bInfo.onclick = adicionarInfo;
        const bAnx = document.getElementById('ws-anexar'); if (bAnx) bAnx.onclick = () => { const f = document.getElementById('ws-anexo-file'); if (f) f.click(); };
        const fAnx = document.getElementById('ws-anexo-file'); if (fAnx) fAnx.onchange = () => anexarArquivos(fAnx.files);
        alvo.querySelectorAll('.op-anexo .fic[data-fimg]').forEach(async el => {
            try { const u = await sb.signUrl('midia', el.dataset.fimg, 1800); el.innerHTML = u ? '<img src="' + esc(u) + '">' : '🖼️'; } catch (e) { el.textContent = '🖼️'; }
        });
        alvo.querySelectorAll('[data-abrir]').forEach(a => a.onclick = async ev => {
            ev.preventDefault(); const v = VINC.find(x => String(x.id) === a.dataset.abrir); if (!v || !v.dados) return;
            try { const u = await sb.signUrl(v.dados.bucket || 'midia', v.dados.path, 600); if (u) window.open(u, '_blank'); else alert('Não foi possível abrir o arquivo.'); }
            catch (e) { alert('Erro ao abrir: ' + e.message); }
        });
        carregarImagens();
    }
    function secVinc(tipo, itens) {
        const t = TIPOS[tipo];
        return `<div class="ws-sec"><h2>${t.ic} ${t.lab} <span class="cont">${itens.length}</span><span class="add" data-add="${tipo}">+ vincular</span></h2>
            ${itens.length ? itens.map(v => `<div class="vinc"><span class="vinc-ic">${t.ic}</span>
                <span class="vinc-tx"><b>${esc(v.rotulo || v.ref_id)}${v.dados && v.dados.auto ? ' <span style="font-size:.62rem;color:var(--p2-accent)">(auto)</span>' : ''}</b>${v.dados && v.dados.sub ? `<small>${esc(v.dados.sub)}</small>` : ''}</span>
                ${tipo === 'ficha_alvo' ? `<a class="p2-btn" style="padding:4px 8px;font-size:.72rem" href="p2-ficha-alvo.html?pessoa_id=${esc(v.ref_id)}">ver</a>` : ''}
                <button class="vinc-x" data-desvinc="${esc(v.id)}" title="Desvincular">✕</button></div>`).join('')
            : '<div class="fa-vazio" style="color:var(--p2-txt-dim2);font-size:.8rem">Nada vinculado.</div>'}</div>`;
    }

    // ── Informações complementares (texto livre da operação) ──────────
    function secInfo(itens) {
        return `<div class="ws-sec" style="margin-top:16px"><h2>➕ Informações complementares <span class="cont">${itens.length}</span><span class="add" id="ws-add-info">+ adicionar</span></h2>
            ${itens.length ? itens.map(v => `<div class="op-info-item"><div class="ct"><b>${esc((v.dados && v.dados.titulo) || v.rotulo || 'Nota')}</b><div class="txt">${esc((v.dados && v.dados.texto) || '')}</div></div><button class="vinc-x" data-desvinc="${esc(v.id)}" title="Remover">✕</button></div>`).join('')
            : '<div class="fa-vazio" style="color:var(--p2-txt-dim2);font-size:.8rem">Nenhuma informação adicionada.</div>'}</div>`;
    }
    function adicionarInfo() {
        modal('Nova informação complementar', `<div class="op-form"><div class="f full"><label>Título</label><input id="info-tit" placeholder="Ex.: Observação de campo"></div>
            <div class="f full"><label>Informação</label><textarea id="info-txt" style="min-height:150px" placeholder="Descreva a informação complementar…"></textarea></div></div><div class="pm-msg" id="info-msg" style="margin-top:12px"></div>`,
            `<button class="p2-btn" onclick="document.getElementById('op-modal').classList.remove('aberto')">Cancelar</button><button class="p2-btn pri" id="info-salvar">💾 Salvar</button>`);
        document.getElementById('info-salvar').onclick = async () => {
            const tit = document.getElementById('info-tit').value.trim(), txt = document.getElementById('info-txt').value.trim(), msg = document.getElementById('info-msg');
            if (!txt) { msg.className = 'pm-msg erro'; msg.textContent = 'Escreva a informação.'; return; }
            try { await salvarVinculoRaw({ tipo: 'info', ref_id: 'info-' + Date.now().toString(36), rotulo: tit || 'Nota', dados: { titulo: tit || 'Nota', texto: txt } }); fecharModal(); renderWorkspace(); }
            catch (e) { msg.className = 'pm-msg erro'; msg.textContent = 'Erro: ' + e.message; }
        };
    }

    // ── Documentos e imagens anexados (upload no bucket midia) ────────
    function secAnexos(itens) {
        return `<div class="ws-sec" style="margin-top:16px"><h2>📎 Documentos e imagens <span class="cont">${itens.length}</span><span class="add" id="ws-anexar">+ anexar</span></h2>
            <input type="file" id="ws-anexo-file" multiple accept="image/*,application/pdf" hidden>
            ${itens.length ? itens.map(v => { const d = v.dados || {}; const img = /^image\//.test(d.mime || ''); return `<div class="op-anexo"><span class="fic" ${img ? 'data-fimg="' + esc(d.path) + '"' : ''}>${img ? '' : '📄'}</span>
                <span class="nm"><b>${esc(d.nome || v.rotulo || 'arquivo')}</b><a href="#" data-abrir="${esc(v.id)}">abrir</a></span>
                <button class="vinc-x" data-desvinc="${esc(v.id)}" title="Remover">✕</button></div>`; }).join('')
            : '<div class="fa-vazio" style="color:var(--p2-txt-dim2);font-size:.8rem">Nenhum documento/imagem anexado.</div>'}</div>`;
    }
    async function anexarArquivos(files) {
        if (!files || !files.length) return;
        for (const f of files) {
            try {
                const base = (P2.slugify(f.name) || 'arquivo').slice(0, 60);
                const path = 'p2-operacoes/' + OP.id + '/' + Date.now().toString(36) + '-' + base;
                await sb.upload('midia', path, f, false);
                await salvarVinculoRaw({ tipo: 'anexo', ref_id: 'anx-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), rotulo: f.name, dados: { nome: f.name, path, mime: f.type || '', bucket: 'midia' } });
            } catch (e) { alert('Falha ao anexar ' + f.name + ': ' + e.message); }
        }
        renderWorkspace();
    }

    // ── Vínculo (persistência) ────────────────────────────────────────
    async function salvarVinculoRaw(v) {
        if (VINC.some(x => x.tipo === v.tipo && String(x.ref_id) === String(v.ref_id))) return null;
        v.operacao_id = OP.id;
        try { const novo = (await sb.insert('tb_p2_operacao_vinculos', v))[0]; VINC.push(novo); return novo; }
        catch (e) { if (/409|duplicate|unique/i.test(e.message)) return null; throw e; }
    }
    async function desvincular(id) {
        if (!confirm('Desvincular este registro da operação?')) return;
        try { await sb.del('tb_p2_operacao_vinculos', 'id=eq.' + id); VINC = VINC.filter(v => String(v.id) !== String(id)); renderWorkspace(); }
        catch (e) { alert('Erro: ' + e.message); }
    }

    // ── Picker genérico com MULTISSELEÇÃO (Supabase) ──────────────────
    const PICKERS = {
        ficha_alvo: { ph: 'nome ou CPF…', comFoto: true, carregar: carFicha },
        denuncia: { ph: 'número, tipo ou local…', carregar: carDenuncia },
        relint: { ph: 'número ou assunto…', carregar: carRelint },
        mandado: { ph: 'número, tipo ou crime…', carregar: carMandado },
    };
    function abrirVincular(tipo) {
        if (tipo === 'ocorrencia_cad') return vincularCad();
        const cfg = PICKERS[tipo];
        modal('Vincular ' + TIPOS[tipo].lab, `<input class="pm-input" id="pk-q" placeholder="🔍 ${cfg.ph}">
            <div id="pk-lista" style="margin-top:12px;max-height:50vh;overflow:auto"><div class="fa-vazio">Carregando…</div></div>`,
            `<span id="pk-cont" style="margin-right:auto;align-self:center;color:var(--p2-txt-dim2);font-size:.82rem">0 selecionado(s)</span>
             <button class="p2-btn" onclick="document.getElementById('op-modal').classList.remove('aberto')">Cancelar</button>
             <button class="p2-btn pri" id="pk-vincular">Vincular selecionados</button>`);
        let ITENS = [], SEL = new Set();
        const jaVinc = new Set(VINC.filter(v => v.tipo === tipo).map(v => String(v.ref_id)));
        async function buscar(termo) {
            const box = document.getElementById('pk-lista'); box.innerHTML = '<div class="fa-vazio">Carregando…</div>';
            try { ITENS = await cfg.carregar(termo); render(); } catch (e) { box.innerHTML = `<div class="fa-vazio">Erro: ${esc(e.message)}</div>`; }
        }
        function render() {
            const box = document.getElementById('pk-lista');
            if (!ITENS.length) { box.innerHTML = '<div class="fa-vazio" style="color:var(--p2-txt-dim2)">Nada encontrado.</div>'; return; }
            box.innerHTML = ITENS.map((it, i) => {
                const jv = jaVinc.has(String(it.ref_id));
                const foto = cfg.comFoto ? (it.fotoPath ? `<img class="pk-foto" data-foto="${esc(it.fotoPath)}" alt="">` : `<span class="pk-foto ph">👤</span>`) : '';
                return `<label class="pk-item ${jv ? 'vinc' : ''}"><input type="checkbox" data-i="${i}" ${SEL.has(String(it.ref_id)) ? 'checked' : ''} ${jv ? 'disabled' : ''}>
                    ${foto}<span class="pk-tx"><b>${esc(it.titulo)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>${jv ? '<span class="pk-ja">já vinculado</span>' : ''}</label>`;
            }).join('');
            box.querySelectorAll('input[data-i]').forEach(ch => ch.onchange = () => { const it = ITENS[+ch.dataset.i]; ch.checked ? SEL.add(String(it.ref_id)) : SEL.delete(String(it.ref_id)); att(); });
            if (cfg.comFoto) assinarFotos(box);
            att();
        }
        const att = () => { document.getElementById('pk-cont').textContent = SEL.size + ' selecionado(s)'; };
        let t = null; document.getElementById('pk-q').oninput = e => { clearTimeout(t); t = setTimeout(() => buscar(e.target.value.trim()), 300); };
        document.getElementById('pk-vincular').onclick = async () => {
            const escolhidos = ITENS.filter(it => SEL.has(String(it.ref_id)));
            if (!escolhidos.length) return;
            const btn = document.getElementById('pk-vincular'); btn.disabled = true; btn.textContent = 'Vinculando…';
            try {
                for (const it of escolhidos) {
                    await salvarVinculoRaw({ tipo, ref_id: String(it.ref_id), rotulo: it.rotulo, dados: it.dados || null });
                    if (tipo === 'ficha_alvo') await autoPreencher(it.ref_id);
                }
                fecharModal(); renderWorkspace();
            } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; btn.textContent = 'Vincular selecionados'; }
        };
        buscar('');
    }
    async function assinarFotos(box) {
        const imgs = [...box.querySelectorAll('img.pk-foto[data-foto]')].slice(0, 30);
        for (const img of imgs) { const p = img.dataset.foto; delete img.dataset.foto; const u = await sb.signUrl('midia', p, 1800).catch(() => null); if (u) img.src = u; else { img.outerHTML = '<span class="pk-foto ph">👤</span>'; } }
    }

    // Carregadores por tipo (retornam {ref_id, titulo, sub, rotulo, dados, fotoPath?})
    async function carFicha(termo) {
        let q = 'select=id,nome_completo,cpf&order=nome_completo&limit=60';
        if (termo && termo.length >= 2) { const dig = termo.replace(/\D/g, ''); q = 'select=id,nome_completo,cpf&' + (dig.length >= 3 ? 'cpf=ilike.*' + encodeURIComponent(dig) + '*' : 'nome_completo=ilike.*' + encodeURIComponent(termo) + '*') + '&limit=60'; }
        const pes = await sb.get('tb_pessoas', q);
        const ids = pes.map(p => p.id);
        const fotos = {};
        if (ids.length) { try { (await sb.get('tb_imagens', 'select=pessoa_id,thumb_path,arquivo_path,is_principal&entidade_tipo=eq.pessoa&pessoa_id=in.(' + ids.join(',') + ')')).forEach(im => { if (!fotos[im.pessoa_id] || im.is_principal) fotos[im.pessoa_id] = im.thumb_path || im.arquivo_path; }); } catch (e) { } }
        return pes.map(p => ({ ref_id: p.id, titulo: p.nome_completo || 'Sem nome', sub: p.cpf || '', rotulo: p.nome_completo, dados: { sub: p.cpf || '' }, fotoPath: fotos[p.id] || null }));
    }
    async function carDenuncia(termo) {
        let f = 'order=data_denuncia.desc.nullslast&limit=80';
        if (termo && termo.length >= 2) f = 'or=(numero.ilike.*' + encodeURIComponent(termo) + '*,tipo.ilike.*' + encodeURIComponent(termo) + '*)&limit=80';
        const r = await sb.get('tb_denuncias', 'select=id,numero,tipo,resumo_breve,data_denuncia,cidade:tb_cidades(nome)&' + f);
        return r.map(d => ({ ref_id: d.id, titulo: 'Nº ' + (d.numero || '—') + ' · ' + (d.tipo || ''), sub: [d.cidade && d.cidade.nome, dataBr(d.data_denuncia), (plain(d.resumo_breve) || '').slice(0, 50)].filter(Boolean).join(' · '), rotulo: 'Nº ' + (d.numero || '—'), dados: { sub: [d.tipo, d.cidade && d.cidade.nome].filter(Boolean).join(' · ') } }));
    }
    async function carRelint(termo) {
        let f = 'order=data_producao.desc.nullslast&limit=80';
        if (termo && termo.length >= 2) f = 'or=(numero.ilike.*' + encodeURIComponent(termo) + '*,assunto.ilike.*' + encodeURIComponent(termo) + '*)&limit=80';
        const r = await sb.get('tb_relints', 'select=id,numero,assunto,modalidade,data_producao&' + f);
        return r.map(x => ({ ref_id: x.id, titulo: (x.numero || 'RELINT') + ' · ' + (plain(x.assunto) || ''), sub: [x.modalidade, dataBr(x.data_producao)].filter(Boolean).join(' · '), rotulo: (x.numero || 'RELINT') + ' — ' + (plain(x.assunto) || ''), dados: { sub: x.modalidade || '' } }));
    }
    async function carMandado(termo) {
        let f = 'order=created_at.desc.nullslast&limit=80';
        if (termo && termo.length >= 2) f = 'or=(numero_mandado.ilike.*' + encodeURIComponent(termo) + '*,tipo_mandado.ilike.*' + encodeURIComponent(termo) + '*,tipo_crime.ilike.*' + encodeURIComponent(termo) + '*)&limit=80';
        const r = await sb.get('tb_mandados', 'select=id,numero_mandado,tipo_mandado,tipo_crime,situacao_judicial,status,vara_comarca&' + f);
        return r.map(m => ({ ref_id: m.id, titulo: (m.numero_mandado || 'Mandado') + ' · ' + (m.tipo_mandado || ''), sub: [m.tipo_crime, m.situacao_judicial || m.status, m.vara_comarca].filter(Boolean).join(' · '), rotulo: (m.numero_mandado || 'Mandado') + (m.tipo_mandado ? ' — ' + m.tipo_mandado : ''), dados: { sub: [m.tipo_crime, m.situacao_judicial || m.status].filter(Boolean).join(' · ') } }));
    }

    // ── Auto-preenchimento ao vincular uma FICHA ALVO ─────────────────
    async function autoPreencher(pessoaId) {
        const g = (t, q) => sb.get(t, q).catch(() => []);
        try {
            const [dp, mp, ra, res] = await Promise.all([
                g('tb_denuncia_pessoas', 'select=denuncia:tb_denuncias(id,numero,tipo)&pessoa_id=eq.' + pessoaId),
                g('tb_mandado_pessoas', 'select=mandado:tb_mandados(id,numero_mandado,tipo_mandado)&pessoa_id=eq.' + pessoaId),
                g('tb_relint_alvos', 'select=relint:tb_relints(id,numero,assunto)&pessoa_id=eq.' + pessoaId),
                g('tb_residencias', 'select=endereco:tb_enderecos(tipo_logradouro,logradouro,numero)&pessoa_id=eq.' + pessoaId),
            ]);
            for (const x of dp) if (x.denuncia) await salvarVinculoRaw({ tipo: 'denuncia', ref_id: String(x.denuncia.id), rotulo: 'Nº ' + (x.denuncia.numero || '—'), dados: { sub: x.denuncia.tipo || '', auto: true } });
            for (const x of mp) if (x.mandado) await salvarVinculoRaw({ tipo: 'mandado', ref_id: String(x.mandado.id), rotulo: (x.mandado.numero_mandado || 'Mandado'), dados: { sub: x.mandado.tipo_mandado || '', auto: true } });
            for (const x of ra) if (x.relint) await salvarVinculoRaw({ tipo: 'relint', ref_id: String(x.relint.id), rotulo: (x.relint.numero || 'RELINT') + (x.relint.assunto ? ' — ' + plain(x.relint.assunto) : ''), dados: { sub: '', auto: true } });
            // Endereços → guarda no vínculo da ficha (pro RELOP)
            const ends = (res || []).map(e => e.endereco && [e.endereco.tipo_logradouro, e.endereco.logradouro, e.endereco.numero].filter(Boolean).join(' ')).filter(Boolean);
            if (ends.length) { const vfa = VINC.find(v => v.tipo === 'ficha_alvo' && String(v.ref_id) === String(pessoaId)); if (vfa) { vfa.dados = Object.assign({}, vfa.dados, { enderecos: ends }); try { await sb.patch('tb_p2_operacao_vinculos', 'id=eq.' + vfa.id, { dados: vfa.dados }); } catch (e) { } } }
        } catch (e) { /* auto-preenchimento é best-effort */ }
    }

    // ── Vincular OCORRÊNCIAS direto do CAD por PERÍODO ────────────────
    // Fonte = CAD ao vivo (P3AtualizadorLocal.buscarGradeCad, só no app/exe),
    // NÃO o espelho do Firebase. Os dados só vão pro Supabase ao VINCULAR,
    // junto com as imagens anexadas ao COP (gerarRelopMandado individual).
    function toIso(d) {
        const s = String(d || '').trim();
        let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); if (m) return m[3] + '-' + m[2] + '-' + m[1];
        m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
        return '';
    }
    // Lê um valor da linha bruta do CAD por qualquer um dos rótulos (case-insensitive).
    function valLinha(linha, rotulos) {
        for (const r of rotulos) { const k = Object.keys(linha).find(c => c.trim().toLowerCase() === r.toLowerCase()); if (k && linha[k] != null && String(linha[k]).trim()) return String(linha[k]).trim(); }
        return '';
    }
    // Normaliza 1 linha da grade "ocorrencias" do CAD. O backend
    // (/cad/sincronizar-grade) JÁ devolve as chaves em MAIÚSCULAS
    // (BOLETIM, DATA='dd/mm/aaaa', HORA, TIPIFICACAO_GERAL, CIDADE…) — ver
    // cad_grades.py:_extrair_ocorrencias_geral. Lemos a chave direta e só
    // caímos nos rótulos em português como fallback (caminho Apps Script).
    function normOcorrencia(o) {
        const g = (chave, rotulos) => (o[chave] != null && String(o[chave]).trim()) ? String(o[chave]).trim() : valLinha(o, rotulos || []);
        let data = g('DATA', ['Data da Ocorrência', 'Dia da Ocorrência', 'Data']);
        let hora = g('HORA', ['Hora da Ocorrência', 'Hora', 'Horário']);
        if (data.includes(' ')) { const p = data.split(' '); data = p[0].trim(); if (!hora) hora = (p[1] || '').trim().substring(0, 5); }
        return {
            BOLETIM: g('BOLETIM', ['Nº Ocorrência', 'Boletim', 'Ocorrência', 'Nº Boletim']).replace(/\D/g, '').substring(0, 7),
            DATA: data || '', HORA: hora || '',
            TIPIFICACAO_GERAL: g('TIPIFICACAO_GERAL', ['Tipificação Geral']),
            TIPIFICACAO: g('TIPIFICACAO', ['Tipicidade no Despacho', 'Tipificação no Despacho', 'Tipificacao']),
            SITUACAO: g('SITUACAO', ['Situação', 'Status']),
            SOLUCAO: g('SOLUCAO', ['Solução', 'Solucao']),
            UNIDADE: g('UNIDADE', ['Unidade']),
            TIPO_DESPACHO: g('TIPO_DESPACHO', ['Tipo no Despacho']),
            CIDADE: g('CIDADE', ['Cidade', 'Município']),
            BAIRRO: g('BAIRRO', ['Bairro']),
            LOGRADOURO: g('LOGRADOURO', ['Logradouro', 'Endereço']),
            SOLICITANTE: g('SOLICITANTE', ['Solicitante']),
            ATENDENTE: g('ATENDENTE', ['Atendente']),
            LATITUDE: g('LATITUDE', ['Latitude (Abertura de Ocor.)', 'Latitude']),
            LONGITUDE: g('LONGITUDE', ['Longitude (Abertura de Ocor.)', 'Longitude']),
        };
    }
    // base64 (puro ou data URL) → Blob, pra subir imagem do COP no bucket.
    function b64ToBlob(b64, mime) {
        const limpo = String(b64 || '').replace(/^data:[^;]+;base64,/, '');
        const bin = atob(limpo); const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        return new Blob([buf], { type: mime || 'image/jpeg' });
    }
    // Baixa e salva no bucket as imagens anexadas ao COP de 1 boletim (best-effort).
    async function anexarImagensCop(boletim, dataIso) {
        if (!dataIso || !window.P3AtualizadorLocal || !P3AtualizadorLocal.gerarRelopMandado) return [];
        try {
            const alvos = await P3AtualizadorLocal.gerarRelopMandado('individual', { boletim: String(boletim), data: dataIso });
            const alvo = (alvos || []).find(a => String(a.BOLETIM || '').replace(/\D/g, '') === String(boletim).replace(/\D/g, '')) || (alvos || [])[0];
            const imgs = (alvo && alvo.IMAGENS) || [];
            const paths = [];
            for (let i = 0; i < imgs.length; i++) {
                const im = imgs[i]; if (!im || !im.base64) continue;
                const path = 'p2-operacoes/' + OP.id + '/cop/' + String(boletim).replace(/\D/g, '') + '-' + i + '-' + (P2.slugify(im.nome || 'cop') || 'img').slice(0, 40);
                try { await sb.upload('midia', path, b64ToBlob(im.base64, im.contentType), false); paths.push(path); } catch (e) { }
            }
            return paths;
        } catch (e) { return []; }
    }
    function vincularCad() {
        if (!window.P3AtualizadorLocal) {
            modal('Vincular ocorrências do CAD', `<div class="fa-vazio" style="color:var(--p2-amber)"><i class="fa-solid fa-triangle-exclamation"></i> A consulta direta ao CAD só funciona no aplicativo/EXE do Sistema (servidor local). Abra o P2 pelo aplicativo instalado para buscar e vincular ocorrências do CAD.</div>`, '');
            return;
        }
        const ano = new Date().getFullYear();
        modal('Vincular ocorrências do CAD (ao vivo)', `
            <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
                <div class="pm-field"><label>De</label><input class="pm-input" type="date" id="oc-ini" value="${ano}-01-01"></div>
                <div class="pm-field"><label>Até</label><input class="pm-input" type="date" id="oc-fim" value="${isoHoje()}"></div>
                <button class="p2-btn pri" id="oc-buscar"><i class="fa-solid fa-magnifying-glass"></i> Buscar no CAD</button>
            </div>
            <input class="pm-input" id="oc-q" placeholder="🔍 filtrar por cidade, bairro, tipificação, boletim…" style="margin-top:10px">
            <div id="oc-prog" style="margin-top:8px;font-size:.78rem;color:var(--p2-txt-dim2)"></div>
            <div id="oc-lista" style="margin-top:10px;max-height:46vh;overflow:auto"><div class="fa-vazio" style="color:var(--p2-txt-dim2)">Selecione o período e clique em <b>Buscar no CAD</b>.</div></div>`,
            `<span id="oc-cont" style="margin-right:auto;align-self:center;color:var(--p2-txt-dim2);font-size:.82rem">0 selecionada(s)</span>
             <button class="p2-btn" onclick="document.getElementById('op-modal').classList.remove('aberto')">Cancelar</button>
             <button class="p2-btn pri" id="oc-vincular">Vincular selecionadas</button>`);
        let OCS = [], SEL = new Set();
        const jaVinc = new Set(VINC.filter(v => v.tipo === 'ocorrencia_cad').map(v => String(v.ref_id)));
        const chave = o => 'bol-' + String(o.BOLETIM || '').replace(/[^\w-]/g, '');
        async function buscar() {
            const ini = document.getElementById('oc-ini').value, fim = document.getElementById('oc-fim').value;
            const box = document.getElementById('oc-lista'), prog = document.getElementById('oc-prog');
            if (!ini || !fim) { box.innerHTML = '<div class="fa-vazio" style="color:var(--p2-amber)">Informe o período (De/Até).</div>'; return; }
            box.innerHTML = '<div class="fa-vazio">⏳ Consultando o CAD ao vivo…</div>';
            const btn = document.getElementById('oc-buscar'); btn.disabled = true;
            try {
                if (!(await P3AtualizadorLocal.disponivel())) {
                    box.innerHTML = `<div class="fa-vazio" style="color:var(--p2-amber)"><i class="fa-solid fa-plug-circle-xmark"></i> Servidor local do Sistema (CAD) não está respondendo em <code>localhost:5057</code>.<br><small>Abra o <b>aplicativo/EXE do Sistema P3</b> (ele sobe esse servidor) e tente de novo. Pelo site/navegador sem o app, a consulta ao vivo do CAD não funciona.</small></div>`;
                    btn.disabled = false; return;
                }
                const res = await P3AtualizadorLocal.buscarGradeCad('ocorrencias', ini, fim, ev => {
                    if (prog && ev && ev.tipo === 'progresso') prog.textContent = `Página ${ev.pagina || '?'}/${ev.totalPaginas || '?'} · ${ev.totalReal || ev.registros || 0} registro(s)…`;
                });
                if (!res || !res.ok) throw new Error((res && res.motivoTruncamento) || 'o CAD não retornou dados.');
                OCS = (res.dados || []).map(normOcorrencia).filter(o => o.BOLETIM);
                OCS.sort((a, b) => toIso(b.DATA) < toIso(a.DATA) ? -1 : 1);
                if (prog) prog.textContent = res.truncado ? ('⚠️ ' + (res.motivoTruncamento || 'resultado truncado pelo CAD.')) : (OCS.length + ' ocorrência(s) carregada(s) do CAD.');
                render();
            } catch (e) { box.innerHTML = `<div class="fa-vazio" style="color:var(--p2-amber)">Erro ao consultar o CAD: ${esc(e.message)}<br><small>Verifique se o acesso ao CAD está configurado/válido na barra superior.</small></div>`; }
            finally { btn.disabled = false; }
        }
        function render() {
            const termo = (document.getElementById('oc-q').value || '').toLowerCase();
            let lista = OCS;
            if (termo) lista = OCS.filter(o => [o.BOLETIM, o.CIDADE, o.BAIRRO, o.LOGRADOURO, o.TIPIFICACAO_GERAL, o.TIPIFICACAO].join(' ').toLowerCase().includes(termo));
            const box = document.getElementById('oc-lista');
            if (!OCS.length) { box.innerHTML = '<div class="fa-vazio" style="color:var(--p2-txt-dim2)">Nenhuma ocorrência no período.</div>'; return; }
            box.innerHTML = '<div style="font-size:.76rem;color:var(--p2-txt-dim2);margin-bottom:6px">' + lista.length + ' ocorrência(s)</div>' + lista.slice(0, 400).map((o, i) => {
                const k = chave(o), jv = jaVinc.has(k);
                const tip = o.TIPIFICACAO_GERAL || o.TIPIFICACAO || 'Ocorrência';
                return `<label class="pk-item ${jv ? 'vinc' : ''}"><input type="checkbox" data-k="${esc(k)}" data-i="${OCS.indexOf(o)}" ${SEL.has(k) ? 'checked' : ''} ${jv ? 'disabled' : ''}>
                    <span class="pk-tx"><b>${esc(dataBr(toIso(o.DATA)))} · ${esc(tip)}</b><small>Bol ${esc(o.BOLETIM || '—')} · ${esc([o.CIDADE, o.BAIRRO, o.LOGRADOURO].filter(Boolean).join(', '))}</small></span>
                    <span class="pk-ver" data-ver="${OCS.indexOf(o)}">detalhes</span>${jv ? '<span class="pk-ja">vinc.</span>' : ''}</label><div class="pk-det" id="oc-det-${OCS.indexOf(o)}" style="display:none"></div>`;
            }).join('');
            box.querySelectorAll('input[data-k]').forEach(ch => ch.onchange = () => { ch.checked ? SEL.add(ch.dataset.k) : SEL.delete(ch.dataset.k); att(); });
            box.querySelectorAll('[data-ver]').forEach(s => s.onclick = ev => { ev.preventDefault(); const det = document.getElementById('oc-det-' + s.dataset.ver); if (det.style.display === 'none') { det.innerHTML = detOcor(OCS[+s.dataset.ver]); det.style.display = ''; } else det.style.display = 'none'; });
            att();
        }
        function detOcor(o) { return Object.keys(o).filter(k => k[0] !== '_' && o[k] != null && String(o[k]).trim()).map(k => `<div><b style="color:var(--p2-txt-dim2)">${esc(k)}:</b> ${esc(String(o[k]))}</div>`).join(''); }
        const att = () => { document.getElementById('oc-cont').textContent = SEL.size + ' selecionada(s)'; };
        document.getElementById('oc-buscar').onclick = buscar;
        document.getElementById('oc-q').oninput = render;
        document.getElementById('oc-vincular').onclick = async () => {
            const escolhidas = OCS.filter(o => SEL.has(chave(o)));
            if (!escolhidas.length) return;
            const btn = document.getElementById('oc-vincular'), prog = document.getElementById('oc-prog');
            btn.disabled = true; btn.textContent = 'Vinculando…';
            try {
                let n = 0;
                for (const o of escolhidas) {
                    n++;
                    const tip = o.TIPIFICACAO_GERAL || o.TIPIFICACAO || 'Ocorrência';
                    if (prog) prog.textContent = `Vinculando ${n}/${escolhidas.length} · buscando imagens do COP (Bol ${o.BOLETIM})…`;
                    const copImgPaths = await anexarImagensCop(o.BOLETIM, toIso(o.DATA));
                    await salvarVinculoRaw({ tipo: 'ocorrencia_cad', ref_id: chave(o), rotulo: tip + ' · ' + (o.CIDADE || ''), dados: { sub: dataBr(toIso(o.DATA)) + ' · Bol ' + (o.BOLETIM || '—'), snapshot: o, copImgPaths } });
                }
                fecharModal(); renderWorkspace();
            } catch (e) { alert('Erro: ' + e.message); btn.disabled = false; btn.textContent = 'Vincular selecionadas'; }
        };
    }

    // ── Imagens ───────────────────────────────────────────────────────
    async function carregarImagens() {
        const box = document.getElementById('ws-imgs'); if (!box) return;
        const imgs = [];
        const fichas = VINC.filter(v => v.tipo === 'ficha_alvo').map(v => v.ref_id);
        if (fichas.length) {
            try {
                const linhas = await sb.get('tb_imagens', 'select=pessoa_id,thumb_path,arquivo_path,legenda&entidade_tipo=eq.pessoa&pessoa_id=in.(' + fichas.join(',') + ')&limit=60');
                for (const im of linhas) { const p = im.thumb_path || im.arquivo_path; if (!p) continue; const url = await sb.signUrl('midia', p, 1800).catch(() => null); if (url) imgs.push({ url, origem: 'Ficha Alvo (sistema)', legenda: im.legenda }); }
            } catch (e) { }
        }
        for (const v of VINC.filter(v => v.tipo === 'ocorrencia_cad' && v.dados)) {
            for (const p of (v.dados.copImgPaths || [])) { const u = await sb.signUrl('midia', p, 1800).catch(() => null); if (u) imgs.push({ url: u, origem: 'CAD (COP)' }); }
            (v.dados.imagens || []).forEach(u => { if (u && /^https?:/.test(String(u))) imgs.push({ url: u, origem: 'CAD (COP)' }); });
            const o = v.dados.snapshot; if (o) ['FOTO', 'IMAGEM', 'FOTO_URL', 'ANEXO'].forEach(k => { if (o[k] && /^https?:/.test(String(o[k]))) imgs.push({ url: o[k], origem: 'CAD (ocorrência)' }); });
        }
        for (const v of VINC.filter(v => v.tipo === 'anexo' && v.dados && /^image\//.test(v.dados.mime || ''))) {
            const u = await sb.signUrl(v.dados.bucket || 'midia', v.dados.path, 1800).catch(() => null);
            if (u) imgs.push({ url: u, origem: 'Anexo da operação', legenda: v.dados.nome });
        }
        document.getElementById('ws-img-cont').textContent = imgs.length;
        if (!imgs.length) { box.innerHTML = '<div class="fa-vazio" style="color:var(--p2-txt-dim2)">Sem imagens nos registros vinculados.</div>'; return; }
        box.innerHTML = '<div class="op-imgs">' + imgs.map((im, i) => `<div class="op-img"><img src="${esc(im.url)}" alt="${esc(im.legenda || '')}" data-lb="${i}" onerror="this.outerHTML='<div class=&quot;falhou&quot;>imagem indisponível</div>'"><span class="origem">${esc(im.origem)}</span></div>`).join('') + '</div>';
        box.querySelectorAll('img[data-lb]').forEach(im => { im.onclick = () => { const d = imgs[+im.dataset.lb]; abrirImagem(d.url, d.legenda || d.origem); }; });
    }

    // ── RELOP + Xerife ────────────────────────────────────────────────
    function consolidarTexto() {
        const o = OP, L = [];
        L.push('OPERAÇÃO: ' + (o.codigo ? o.codigo + ' — ' : '') + (o.titulo || ''));
        L.push('STATUS: ' + (STATUS[o.status] || {}).lab);
        if (o.data_inicio || o.data_fim) L.push('PERÍODO: ' + [dataBr(o.data_inicio), dataBr(o.data_fim)].filter(Boolean).join(' a '));
        if (o.cidade_id && CIDADES[o.cidade_id]) L.push('CIDADE: ' + CIDADES[o.cidade_id]);
        if (o.equipe_id && EQUIPES[o.equipe_id]) L.push('EQUIPE: ' + EQUIPES[o.equipe_id]);
        if (o.area) L.push('ÁREA: ' + o.area);
        if (o.objetivo) L.push('OBJETIVO: ' + plain(o.objetivo));
        if (o.observacoes) L.push('OBSERVAÇÕES: ' + plain(o.observacoes));
        Object.keys(TIPOS).forEach(t => {
            const its = VINC.filter(v => v.tipo === t); if (!its.length) return;
            L.push('\n== ' + TIPOS[t].lab.toUpperCase() + ' (' + its.length + ') ==');
            its.forEach(v => { let l = '- ' + (v.rotulo || v.ref_id) + (v.dados && v.dados.sub ? ' (' + v.dados.sub + ')' : ''); if (v.dados && v.dados.enderecos) l += ' | Endereços: ' + v.dados.enderecos.join('; '); if (v.dados && v.dados.snapshot) l += ' | ' + JSON.stringify(v.dados.snapshot).slice(0, 500); L.push(l); });
        });
        const infos = VINC.filter(v => v.tipo === 'info');
        if (infos.length) { L.push('\n== INFORMAÇÕES COMPLEMENTARES (' + infos.length + ') =='); infos.forEach(v => L.push('- ' + ((v.dados && v.dados.titulo) || 'Nota') + ': ' + ((v.dados && v.dados.texto) || ''))); }
        const anexos = VINC.filter(v => v.tipo === 'anexo');
        if (anexos.length) L.push('\nANEXOS: ' + anexos.length + ' documento(s)/imagem(ns) anexado(s) à operação.');
        const nImg = document.getElementById('ws-img-cont');
        L.push('\nIMAGENS VINCULADAS: ' + (nImg ? nImg.textContent : '0'));
        return L.join('\n');
    }
    async function gerarRELOP() {
        const consolidado = consolidarTexto();
        const prompt = 'Você é um analista de inteligência da Seção P2 de um batalhão da Polícia Militar. Com base nos dados consolidados da operação abaixo '
            + '(ocorrências do CAD, RELINTs, fichas de alvo, denúncias, mandados e imagens), faça a ANÁLISE INICIAL de um RELOP (Relatório Operacional): '
            + '1) cruzamento das informações; 2) vínculos, padrões, alvos e locais recorrentes; 3) pontos de atenção/risco; '
            + '4) proposta de ESTRUTURA e redação inicial (introdução, desenvolvimento por eixos, conclusão e recomendações). '
            + 'Português formal e objetivo, pronto para o analista revisar.\n\n=== DADOS CONSOLIDADOS ===\n' + consolidado;
        modal('RELOP — Análise inicial do Xerife', `<div id="relop-area"><div class="fa-vazio">⏳ Enviando para o Xerife…</div></div>`, '');
        let analise = '';
        try {
            const c = new AbortController(); const to = setTimeout(() => c.abort(), 120000);
            const r = await fetch(BACKEND + '/xerife/ia/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensagens: [{ role: 'user', content: prompt }] }), signal: c.signal });
            clearTimeout(to); const j = await r.json().catch(() => ({}));
            if (!j.ok) throw new Error(j.erro || 'o Xerife não respondeu (disponível no app/exe).');
            analise = j.resposta || '';
        } catch (e) {
            document.getElementById('relop-area').innerHTML = `<div class="fa-vazio" style="color:var(--p2-amber)">Sem análise da IA: ${esc(e.message)}<br><br>Você ainda pode editar e salvar o RELOP abaixo.</div>${editorRelop(consolidado)}`;
            ligarEditorRelop(''); return;
        }
        document.getElementById('relop-area').innerHTML = `
            <div style="font-size:.78rem;font-weight:700;color:var(--p2-txt-dim2);margin-bottom:6px">ANÁLISE INICIAL DO XERIFE</div>
            <div class="relop-ia" style="margin-bottom:12px">${esc(analise)}</div>${editorRelop(analise + '\n\n=== DADOS CONSOLIDADOS ===\n' + consolidado)}`;
        ligarEditorRelop(analise);
    }
    function editorRelop(valor) {
        return `<div style="font-size:.78rem;font-weight:700;color:var(--p2-txt-dim2);margin:8px 0 6px">RELOP (editável)</div>
            <textarea class="relop-ed" id="relop-ed">${esc(valor)}</textarea>
            <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap">
                <button class="p2-btn" id="relop-imprimir"><i class="fa-solid fa-print"></i> Imprimir</button>
                <button class="p2-btn pri" id="relop-salvar"><i class="fa-solid fa-floppy-disk"></i> Salvar na operação</button></div><div class="pm-msg" id="relop-msg"></div>`;
    }
    function ligarEditorRelop(analise) {
        document.getElementById('relop-imprimir').onclick = () => imprimirRelop(document.getElementById('relop-ed').value);
        document.getElementById('relop-salvar').onclick = async () => {
            const texto = document.getElementById('relop-ed').value, msg = document.getElementById('relop-msg');
            try {
                await sb.patch('tb_p2_operacoes', 'id=eq.' + OP.id, { relop_texto: texto, relop_ia: { analise: analise || '', em: new Date().toISOString() }, relop_gerado_em: new Date().toISOString(), atualizado_em: new Date().toISOString() });
                OP.relop_texto = texto; msg.className = 'pm-msg ok'; msg.textContent = 'RELOP salvo.'; setTimeout(() => { fecharModal(); renderWorkspace(); }, 800);
            } catch (e) { msg.className = 'pm-msg erro'; msg.textContent = 'Erro ao salvar: ' + e.message; }
        };
    }
    function imprimirRelop(texto) {
        const o = OP;
        P2.imprimirDoc(`<div class="fa-doc">
            <div class="fa-doc-cab"><img src="../img/brasao.png" onerror="this.style.display='none'">
                <div><h1>POLÍCIA MILITAR DE ALAGOAS — 10º BPM</h1><h2>Seção de Inteligência (P2) — RELOP</h2></div></div>
            <div class="fa-doc-campo"><b>Operação:</b><span>${esc((o.codigo ? o.codigo + ' — ' : '') + o.titulo)}</span></div>
            ${o.data_inicio || o.data_fim ? `<div class="fa-doc-campo"><b>Período:</b><span>${esc([dataBr(o.data_inicio), dataBr(o.data_fim)].filter(Boolean).join(' a '))}</span></div>` : ''}
            <h3>RELATÓRIO</h3><div style="font-size:12px;white-space:pre-wrap;line-height:1.55">${esc(texto || '—')}</div>
            <div style="margin-top:18px;font-size:11px;color:#555;border-top:1px solid #ccc;padding-top:8px;text-align:center">Documento gerado pelo Sistema P3 — Módulo P2 · ${new Date().toLocaleString('pt-BR')}</div></div>`);
    }
})();
