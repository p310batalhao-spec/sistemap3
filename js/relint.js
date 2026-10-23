// ═══════════════════════════════════════════════════════════════════
// RELATÓRIO DE INTELIGÊNCIA (page/relint.html) — módulo P2
// ═══════════════════════════════════════════════════════════════════
// Pedido do usuário: RELINT no modelo "MODELO DE RELINT PARA BUSCA E
// APREENSÃO" preenchido com a FICHA ALVO do ExchelonX (Supabase da P2):
// dados, veículos, fotos, vínculos, mandados, endereços, informações e
// denúncias (+ ficha criminal). Um ou mais alvos, ou uma ORCRIM com seus
// integrantes. Acesso só P2/ADMIN.
//
// Dados: atualizador local (tools/atualizador-local/relint_exchelon.py,
// rotas /relint/*) — a chave do Supabase nunca vem para o navegador.
// Tela = Ficha Alvo moderna; impressão = modelo oficial (montarDocumento):
// tarjas "ACESSO RESTRITO", avisos DNISP / Lei 12.527, brasão PMAL, selo,
// marca d'água, numeração n/N, Anexo A (qualificação), registro fotográfico
// e histórico criminal. O rascunho fica só neste navegador (localStorage).
// ═══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const API = (window.P3AtualizadorLocal && P3AtualizadorLocal.URL_BASE) || 'http://localhost:5057';
    const LS_RASCUNHO = 'p3_relint_rascunho';
    const LS_CFG = 'p3_relint_config';
    const PAPEIS_AUTOR = ['suspeito', 'autor', 'investigado', 'indiciado', 'preso', 'conduzido', 'acusado'];
    const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

    let CFG_UNIDADE = null;
    const E = {           // estado do relatório
        alvos: [],        // [{ id, ficha, funcao, sel: { foto, imovel, registro:Set, endereco, fc:Set, info } }]
        grupo: null,      // { nome, tipo } quando o relatório é de uma ORCRIM
        ativo: 0, aba: 'dados',
        ocultos: new Set(), // blocos desmarcados na prévia (data-bloco)
    };

    // ── utilitários ─────────────────────────────────────────────────
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const val = v => { const s = (v == null ? '' : String(v)).trim(); return s && s !== '---' ? s : ''; };
    const up = s => val(s).toUpperCase();
    const dataBR = v => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : val(v); };
    const cpfFmt = v => { const d = String(v || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : val(v); };
    const hojeBR = () => new Date().toLocaleDateString('pt-BR');
    const vulgo = f => (f.apelidos || []).filter(Boolean)[0] || '';
    const vulgos = f => (f.apelidos || []).filter(Boolean).join(' / ');
    const fotoPrincipal = f => (f.fotos || []).find(x => x.tipo === 'pessoa' && x.principal) || (f.fotos || []).find(x => x.tipo === 'pessoa') || null;
    const listaE = arr => arr.length <= 1 ? (arr[0] || '') : arr.slice(0, -1).join(', ') + ' e ' + arr[arr.length - 1];
    const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* armazenamento opcional */ } };

    async function api(caminho) {
        const r = await fetch(API + caminho);
        const j = await r.json().catch(() => ({}));
        if (r.status === 503 || j.autorizado === false) throw new Error('acesso negado pelo atualizador local — faça login no Sistema P3 (exe) com nível P2 ou ADMIN');
        if (!r.ok || !j.ok) throw new Error(j.erro || ('HTTP ' + r.status));
        return j;
    }
    function status(tipo, txt) { const el = $('ri-status'); el.className = 'ri-status ' + tipo; el.querySelector('span').textContent = txt; }

    // ── configuração (cabeçalho institucional / marca d'água / selo) ──
    function cfgPadrao() {
        const e10 = !CFG_UNIDADE || /10/.test(CFG_UNIDADE.nome || '10');
        return {
            cabecalho: e10
                ? 'ESTADO DE ALAGOAS\nSECRETARIA DE SEGURANÇA PÚBLICA\nPOLÍCIA MILITAR DE ALAGOAS\nCOMANDO DE POLICIAMENTO DA REGIÃO DO AGRESTE (CPRA)\nCISP II – 10º BATALHÃO DE POLÍCIA MILITAR (10º BPM)\np2.10bpm@pm.al.gov.br'
                : `ESTADO DE ALAGOAS\nSECRETARIA DE SEGURANÇA PÚBLICA\nPOLÍCIA MILITAR DE ALAGOAS\n${(CFG_UNIDADE.nome || '').toUpperCase()}`,
            marca: e10 ? 'P2 - 10º BPM' : 'P2', selo: 'dint', assinatura: '',
        };
    }
    const cfg = () => Object.assign(cfgPadrao(), lsGet(LS_CFG, {}));
    function cabPadrao() {
        const d = new Date();
        return { numero: `Nº ___/${d.getFullYear()}/P2/10BPM/${hojeBR()}`, data: `${String(d.getDate()).padStart(2, '0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`,
            assunto: '', origem: 'P2/10º BPM', difusao: '', difusaoAnterior: 'X-X-X-X', referencia: 'X-X-X-X', operacao: '', anexo: 'ANEXO A – QUALIFICAÇÃO DOS ENVOLVIDOS' };
    }
    const lerCab = () => Object.fromEntries([...document.querySelectorAll('[data-cab]')].map(i => [i.dataset.cab, i.value]));
    const escreverCab = c => document.querySelectorAll('[data-cab]').forEach(i => { i.value = c[i.dataset.cab] || ''; });

    // ── busca ───────────────────────────────────────────────────────
    async function buscar() {
        const q = $('ri-q').value.trim();
        const out = $('ri-res');
        if (q.length < 2) { out.innerHTML = ''; return; }
        out.innerHTML = '<div class="ri-carregando">⏳ Buscando no ExchelonX…</div>';
        try {
            const r = await api('/relint/buscar?q=' + encodeURIComponent(q));
            const gs = r.grupos.map(g => `<div class="ri-cartao ri-grupo"><div class="ri-ic">🕸</div><div><b>${esc(g.nome)}</b>${esc(g.tipo)} · ${g.integrantes} integrante(s)</div>
                <button class="ri-btn ri-btn-mini ri-btn-ouro" data-grupo="${esc(g.fonte)}|${esc(g.id)}">+ ORCRIM</button></div>`).join('');
            const ps = r.pessoas.map(p => `<div class="ri-cartao"><img src="${esc(p.foto || '../img/relint/sem-foto.jpg')}" alt="">
                <div><b>${esc(p.nome)}</b>${p.apelidos.length ? `“${esc(p.apelidos.join(' / '))}” · ` : ''}${p.cpf ? 'CPF ' + esc(cpfFmt(p.cpf)) : 'sem CPF'}${p.nascimento ? ' · ' + esc(dataBR(p.nascimento)) : ''}</div>
                <button class="ri-btn ri-btn-mini ri-btn-pri" data-add="${esc(p.id)}" ${E.alvos.some(a => String(a.id) === String(p.id)) ? 'disabled' : ''}>+ Alvo</button></div>`).join('');
            out.innerHTML = gs + ps || '<div class="ri-vazio">Nada encontrado.</div>';
            out.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => { b.disabled = true; adicionarAlvo(b.dataset.add); }));
            out.querySelectorAll('[data-grupo]').forEach(b => b.addEventListener('click', () => { const [f, id] = b.dataset.grupo.split('|'); adicionarGrupo(f, id, b); }));
        } catch (e) { out.innerHTML = `<div class="ri-vazio">⚠️ ${esc(e.message)}</div>`; }
    }
    async function carregarGrupos() {
        try {
            const r = await api('/relint/grupos');
            status('ok', 'Conectado ao ExchelonX (via atualizador local)');
            const comIntegrantes = r.grupos.filter(g => g.integrantes);
            $('ri-grupos-lista').innerHTML = comIntegrantes.length ? '<span class="ri-sub" style="margin:0;">ORCRIM cadastradas:</span>' + comIntegrantes.map(g =>
                `<span class="ri-chip" data-grupo="${esc(g.fonte)}|${esc(g.id)}">🕸 ${esc(g.nome)} (${g.integrantes})</span>`).join('') : '';
            $('ri-grupos-lista').querySelectorAll('[data-grupo]').forEach(c => c.addEventListener('click', () => { const [f, id] = c.dataset.grupo.split('|'); adicionarGrupo(f, id, c); }));
        } catch (e) {
            const msg = /Failed to fetch|NetworkError/i.test(e.message) ? 'Atualizador local fechado — abra o Sistema P3 (exe) para acessar o ExchelonX' : e.message;
            status('erro', msg);
        }
    }

    // ── alvos ───────────────────────────────────────────────────────
    function novaSelecao(f, salvo) {
        const fp = fotoPrincipal(f);
        const end0 = (f.enderecos || [])[0];
        const fotoImovel = end0 && end0.fotos && end0.fotos[0];
        const fc = new Set((f.fichaCriminal || []).map((r, i) => PAPEIS_AUTOR.includes(String(r.papel || '').toLowerCase()) ? i : -1).filter(i => i >= 0));
        const s = { foto: fp ? fp.id : null, imovel: fotoImovel ? fotoImovel.id : null, registro: new Set(), endereco: 0, fc,
            info: textoLimpo((f.informacoes || []).filter(informePadrao)[0]?.texto || f.dados.observacoes).slice(0, 700),
            informes: new Set((f.informacoes || []).map((x, i) => informePadrao(x) ? i : -1).filter(i => i >= 0)) };
        if (salvo) Object.assign(s, salvo, { registro: new Set(salvo.registro || []), fc: new Set(salvo.fc || []), informes: salvo.informes ? new Set(salvo.informes) : s.informes,
            cb: salvo.cb ? new Set(salvo.cb) : null, detalhar: salvo.detalhar ? new Set(salvo.detalhar) : null });
        return s;
    }
    async function adicionarAlvo(id, extras = {}) {
        if (E.alvos.some(a => String(a.id) === String(id))) return;
        const marcador = { id, ficha: null, funcao: extras.funcao || '', carregando: true, sel: null, consulta: extras.consulta || null, consultaRaw: extras.consultaRaw || null, detalhes: extras.detalhes || {} };
        E.alvos.push(marcador); renderAlvos();
        try {
            marcador.ficha = (await api('/relint/ficha?id=' + encodeURIComponent(id))).ficha;
            marcador.sel = novaSelecao(marcador.ficha, extras.sel);
            if (!marcador.funcao) { const g = (marcador.ficha.grupos || [])[0]; if (g && val(g.funcao) && !/não definida/i.test(g.funcao)) marcador.funcao = g.funcao; }
        } catch (e) { alert('Não foi possível carregar a ficha: ' + e.message); E.alvos = E.alvos.filter(a => a !== marcador); }
        marcador.carregando = false;
        E.ativo = Math.max(0, E.alvos.indexOf(marcador));
        renderAlvos(); renderFicha();
    }
    async function adicionarGrupo(fonte, id, botao) {
        if (botao) botao.disabled = true;
        status('', 'Carregando a ORCRIM e as fichas dos integrantes…');
        try {
            const g = (await api(`/relint/grupo?fonte=${encodeURIComponent(fonte)}&id=${encodeURIComponent(id)}`)).grupo;
            E.grupo = { nome: g.nome, tipo: g.tipo };
            $('ri-grupo-nome').value = g.nome || '';
            g.integrantes.forEach(i => {
                if (E.alvos.some(a => String(a.id) === String(i.ficha.id))) return;
                const funcao = val(i.funcao) && !/não definida/i.test(i.funcao) ? i.funcao : '';
                E.alvos.push({ id: i.ficha.id, ficha: i.ficha, funcao, sel: novaSelecao(i.ficha) });
            });
            status('ok', `ORCRIM “${g.nome}” carregada — ${g.integrantes.length} integrante(s)`);
        } catch (e) { alert('Não foi possível carregar a ORCRIM: ' + e.message); status('erro', e.message); }
        if (botao) botao.disabled = false;
        renderAlvos(); renderFicha();
    }
    function renderAlvos() {
        $('ri-grupo-box').style.display = E.grupo ? 'flex' : 'none';
        const el = $('ri-alvos');
        if (!E.alvos.length) { el.innerHTML = '<div class="ri-vazio">Nenhum alvo adicionado.</div>'; return; }
        el.innerHTML = E.alvos.map((a, i) => {
            if (a.carregando) return `<div class="ri-alvo"><span class="ri-n">${String(i + 1).padStart(2, '0')}</span><span></span><div class="ri-carregando">⏳ Carregando a Ficha Alvo…</div></div>`;
            const f = a.ficha, fp = a.sel.fotoExt ? { url: a.sel.fotoExt } : (f.fotos || []).find(x => x.id === a.sel.foto) || fotoPrincipal(f);
            return `<div class="ri-alvo${i === E.ativo ? ' ativo' : ''}" data-i="${i}">
                <span class="ri-n">${String(i + 1).padStart(2, '0')}</span>
                <img src="${esc(fp ? fp.url : '../img/relint/sem-foto.jpg')}" alt="">
                <div><b>${esc(f.dados.nome)}</b><small>${vulgos(f) ? '“' + esc(vulgos(f)) + '” · ' : ''}${(f.fichaCriminal || []).length} registro(s) · ${(f.mandados || []).length} mandado(s) · ${(f.enderecos || []).length} endereço(s)</small></div>
                <input class="ri-in" data-funcao="${i}" placeholder="Função (ex.: líder, gerente, braço armado)" value="${esc(a.funcao)}">
                <div style="display:flex;gap:4px;">
                    <button class="ri-btn ri-btn-mini${a.consulta ? ' on' : ''}" data-consultar="${i}" title="Consulta Integrada de Pessoas (CAD, BNMP, TJAL/TJSP) — exige CPF">${a.consulta ? '✔ CAD/BNMP/TJ' : '🔎 CAD/BNMP/TJ'}</button>
                    <button class="ri-btn ri-btn-mini" data-ver="${i}">Ficha</button>
                    <button class="ri-btn ri-btn-mini" data-sobe="${i}" ${i ? '' : 'disabled'}>▲</button>
                    <button class="ri-btn ri-btn-mini" data-rem="${i}">✕</button></div></div>`;
        }).join('');
        el.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { E.ativo = +b.dataset.ver; renderAlvos(); renderFicha(); $('ri-ficha-painel').scrollIntoView({ behavior: 'smooth' }); });
        el.querySelectorAll('[data-rem]').forEach(b => b.onclick = () => { E.alvos.splice(+b.dataset.rem, 1); E.ativo = 0; if (!E.alvos.length) E.grupo = null; renderAlvos(); renderFicha(); });
        el.querySelectorAll('[data-sobe]').forEach(b => b.onclick = () => { const i = +b.dataset.sobe; [E.alvos[i - 1], E.alvos[i]] = [E.alvos[i], E.alvos[i - 1]]; E.ativo = i - 1; renderAlvos(); renderFicha(); });
        el.querySelectorAll('[data-funcao]').forEach(inp => inp.oninput = () => { E.alvos[+inp.dataset.funcao].funcao = inp.value; });
        el.querySelectorAll('[data-consultar]').forEach(b => b.onclick = () => { b.disabled = true; consultarIntegrada(E.alvos[+b.dataset.consultar], b).finally(() => { b.disabled = false; }); });
    }

    // ── FICHA ALVO ──────────────────────────────────────────────────
    const ABAS = [['dados', 'Dados'], ['veiculos', 'Veículos'], ['fotos', 'Fotos'], ['vinculos', 'Vínculos'], ['mandados', 'Mandados'],
        ['enderecos', 'Endereços'], ['informacoes', 'Informações'], ['denuncias', 'Denúncias'], ['fichaCriminal', 'Ficha criminal'], ['consulta', 'Consulta integrada']];
    const contagem = (f, k, a) => k === 'dados' ? '' : k === 'consulta' ? (a && a.consulta ? '✔' : '') : String(((k === 'vinculos' ? (f.vinculos || []).concat(f.grupos || []) : f[k]) || []).length);
    const kv = pares => '<div class="ri-kv">' + pares.filter(([, v]) => val(v)).map(([k, v]) => `<div><b>${esc(k)}:</b>${esc(v)}</div>`).join('') + '</div>';
    function renderFicha() {
        const el = $('ri-ficha');
        const a = E.alvos[E.ativo];
        if (!a || !a.ficha) { el.innerHTML = '<div class="ri-vazio">Selecione um alvo para ver a ficha.</div>'; return; }
        const f = a.ficha, s = a.sel, fp = (f.fotos || []).find(x => x.id === s.foto) || fotoPrincipal(f);
        const tags = [...(f.grupos || []).map(g => `<span class="ri-tag v">🕸 ${esc(g.nome)}${val(g.funcao) ? ' · ' + esc(g.funcao) : ''}</span>`),
            (f.mandados || []).some(m => !/cumprid|baixad|revogad/i.test(m.status || '')) ? '<span class="ri-tag v">⚖ Mandado em aberto</span>' : '',
            f.dados.situacao ? `<span class="ri-tag">${esc(f.dados.situacao)}</span>` : ''].join('');
        el.innerHTML = `<div class="ri-ficha-topo"><img src="${esc(fp ? fp.url : '../img/relint/sem-foto.jpg')}" alt="">
                <div><h3>${esc(f.dados.nome)}</h3>${vulgos(f) ? `<div class="ri-vulgo">“${esc(vulgos(f))}”</div>` : ''}
                <div class="ri-sub" style="margin:4px 0 0;">${f.dados.cpf ? 'CPF ' + esc(cpfFmt(f.dados.cpf)) + ' · ' : ''}${f.dados.nascimento ? 'Nasc. ' + esc(dataBR(f.dados.nascimento)) + ' · ' : ''}${f.dados.mae ? 'Mãe: ' + esc(f.dados.mae) : ''}</div>
                <div class="ri-tags">${tags}</div></div></div>
            <div class="ri-abas">${ABAS.map(([k, n]) => `<button class="ri-aba${E.aba === k ? ' ativa' : ''}" data-aba="${k}">${n}${contagem(f, k, a) !== '' ? `<em>${contagem(f, k, a)}</em>` : ''}</button>`).join('')}</div>
            <div id="ri-aba-corpo">${E.aba === 'consulta' ? abaConsulta(a) : conteudoAba(f, s, E.aba)}</div>`;
        el.querySelectorAll('[data-aba]').forEach(b => b.onclick = () => { E.aba = b.dataset.aba; renderFicha(); });
        ligarAba(el, a);
    }
    function conteudoAba(f, s, aba) {
        const vazio = t => `<div class="ri-vazio">${t}</div>`;
        if (aba === 'dados') {
            const d = f.dados;
            return kv([['Nome', d.nome], ['Vulgo(s)', vulgos(f)], ['Mãe', d.mae], ['Pai', d.pai], ['CPF', cpfFmt(d.cpf)], ['RG', [d.rg, d.rgOrgao].filter(Boolean).join(' ')],
                ['Nascimento', dataBR(d.nascimento)], ['Sexo', d.sexo], ['Estado civil', d.estadoCivil], ['Naturalidade', d.naturalidade], ['Nacionalidade', d.nacionalidade],
                ['Profissão', d.profissao], ['Situação', d.situacao], ['Observações', d.observacoes]])
                + `<div style="margin-top:12px;"><label class="ri-sub" style="display:block;margin:0 0 4px;">Campo “Informações” do Anexo A</label><textarea rows="3" data-info>${esc(s.info)}</textarea></div>`;
        }
        if (aba === 'veiculos') return (f.veiculos || []).length ? '<div class="ri-lista">' + f.veiculos.map(v => `<div class="ri-item"><h4>🚗 ${esc(up(v.modelo) || 'Veículo')}</h4>
            ${kv([['Placa', up(v.placa)], ['Cor', v.cor]])}${v.fotos.length ? `<div class="ri-fotos" style="margin-top:8px;">${v.fotos.map(fotoCard(s)).join('')}</div>` : ''}</div>`).join('') + '</div>' : vazio('Nenhum veículo vinculado.');
        if (aba === 'fotos') return (f.fotos || []).length ? `<p class="ri-sub" style="margin:0 0 10px;">👤 foto do Anexo A · 🏠 foto do imóvel (Anexo A) · 📷 entra no Registro fotográfico. Clique na foto para ampliar.</p>
            <div class="ri-fotos">${f.fotos.map(fotoCard(s)).join('')}</div>` : vazio('Nenhuma foto cadastrada.');
        if (aba === 'vinculos') {
            const gr = (f.grupos || []).map(g => `<div class="ri-item"><h4>🕸 ${esc(g.nome)} <span class="ri-meta">${esc(g.tipo || '')}</span></h4>${kv([['Função', g.funcao], ['Ativa', g.ativa === false ? 'Não' : g.ativa ? 'Sim' : ''], ['Início', dataBR(g.dataInicio)], ['Fim', dataBR(g.dataFim)], ['Observação', g.observacao]])}</div>`);
            const vi = (f.vinculos || []).map(v => `<div class="ri-item"><h4>🔗 ${esc(v.nome)} <span class="ri-meta">${esc([v.tipo, v.subtipo].filter(Boolean).join(' · '))}</span></h4>${kv([['CPF', cpfFmt(v.cpf)], ['Nascimento', dataBR(v.dataNascimento)], ['Mãe', v.mae], ['Confiança', v.nivelConfianca], ['Observação', v.observacao]])}</div>`);
            return gr.length + vi.length ? '<div class="ri-lista">' + gr.concat(vi).join('') + '</div>' : vazio('Nenhum vínculo cadastrado.');
        }
        if (aba === 'mandados') return (f.mandados || []).length ? '<div class="ri-lista">' + f.mandados.map(m => `<div class="ri-item"><h4>⚖ ${esc(up(m.tipo) || 'Mandado')} ${m.numero ? 'nº ' + esc(m.numero) : ''} <span class="ri-meta">${esc(m.status || '')}</span></h4>
            ${kv([['Processo', m.processo], ['Vara / comarca', m.vara], ['Crime', m.crime], ['Papel', m.papel], ['Observação', m.observacao]])}
            ${m.cumprimentos.length ? `<div class="ri-meta" style="margin-top:4px;">Cumprimentos: ${m.cumprimentos.map(c => esc(`${dataBR(c.dataHora)} ${c.situacao || ''} ${c.resultado || ''}`)).join(' · ')}</div>` : ''}</div>`).join('') + '</div>' : vazio('Nenhum mandado vinculado.');
        if (aba === 'enderecos') return (f.enderecos || []).length ? '<div class="ri-lista">' + f.enderecos.map((e, i) => `<div class="ri-item"><h4>🏠 ${esc(e.texto || 'Endereço')}${e.principal ? ' <span class="ri-tag">principal</span>' : ''}
                <label><input type="radio" name="ri-end" data-end="${i}" ${s.endereco === i ? 'checked' : ''}> usar no Anexo A</label></h4>
            ${kv([['Ponto de referência', [e.pontoReferencia, ...(e.referencias || [])].filter(Boolean).join(' · ')], ['Complementos', (e.complementos || []).join(' · ')], ['Descrição', e.descricao], ['Fonte', e.fonte], ['Coordenadas', e.latitude && e.longitude ? `${e.latitude}, ${e.longitude}` : '']])}
            ${e.link ? `<div class="ri-meta" style="margin-top:4px;">📍 <a href="${esc(e.link)}" target="_blank" rel="noopener" style="color:#9cc0ff;">abrir localização</a> (vai para o QR Code do Anexo A)</div>` : ''}
            ${e.fotos.length ? `<div class="ri-fotos" style="margin-top:8px;">${e.fotos.map(fotoCard(s)).join('')}</div>` : ''}</div>`).join('') + '</div>' : vazio('Nenhum endereço cadastrado.');
        if (aba === 'informacoes') return (f.informacoes || []).length ? '<p class="ri-sub" style="margin:0 0 10px;">Marcados = entram no texto do relatório como informes. Por padrão ficam de fora os relatos em que o alvo é vítima/testemunha ou que são declarações de terceiros.</p><div class="ri-lista">' + f.informacoes.map((x, i) => `<div class="ri-item"><h4>ℹ ${esc(x.assunto || x.origem)} <span class="ri-meta">${esc(x.origem)} · ${esc(dataBR(x.dataHora))}${x.papel ? ' · ' + esc(x.papel) : ''}</span>
                <label><input type="checkbox" data-informe="${i}" ${s.informes && s.informes.has(i) ? 'checked' : ''}> incluir no texto</label></h4>
            <div style="white-space:pre-wrap;">${esc(textoLimpo(x.texto))}</div><div style="margin-top:6px;"><button class="ri-btn ri-btn-mini" data-usar-info="${i}">↳ usar no campo “Informações” do Anexo A</button></div></div>`).join('') + '</div>' : vazio('Nenhuma informação complementar.');
        if (aba === 'denuncias') return (f.denuncias || []).length ? '<div class="ri-lista">' + f.denuncias.map(d => `<div class="ri-item"><h4>📣 ${esc(d.tipo || 'Denúncia')} ${d.numero ? 'nº ' + esc(d.numero) : ''} <span class="ri-meta">${esc(dataBR(d.dataDenuncia))} ${esc(d.horaDenuncia || '')} · ${esc(d.cidade || '')} · ${esc(d.statusOperacional || '')}</span></h4>
            ${d.resumoBreve ? `<div><b>${esc(textoLimpo(d.resumoBreve))}</b></div>` : ''}<div style="white-space:pre-wrap;">${esc(textoLimpo(d.narrativa))}</div>
            ${d.arquivoUrl ? `<div class="ri-meta" style="margin-top:4px;">📎 <a href="${esc(d.arquivoUrl)}" target="_blank" rel="noopener" style="color:#9cc0ff;">${esc(d.arquivoNome || 'anexo')}</a></div>` : ''}</div>`).join('') + '</div>' : vazio('Nenhuma denúncia vinculada.');
        if (aba === 'fichaCriminal') return (f.fichaCriminal || []).length ? `<p class="ri-sub" style="margin:0 0 10px;">Marcados = entram no histórico criminal do texto e na “Ficha criminal” do Anexo A (padrão: registros como suspeito/autor).</p><div class="ri-lista">` + f.fichaCriminal.map((r, i) => `<div class="ri-item"><h4>${esc(up(r.crimes) || 'Registro')}
                <label><input type="checkbox" data-fc="${i}" ${s.fc.has(i) ? 'checked' : ''}> incluir</label></h4>
            <div class="ri-meta">${esc(r.tipo || 'BO')} nº ${esc(r.numero || '—')} · ${esc(dataBR(r.dataFato))} · papel: <b>${esc(r.papel || '—')}</b></div></div>`).join('') + '</div>' : vazio('Nenhum registro criminal.');
        return '';
    }
    // ── Consulta Integrada: helpers sobre o resultado bruto ──────────
    const SECOES_CI = [['fotos', '📷 Fotos (Alcatraz / IDSEG-Quimera)'], ['cad', '🚓 Ocorrências — CAD'], ['ppe', '🚔 Ocorrências policiais — PPE'], ['pc', '🗂 Registros anteriores'],
        ['end', '📍 Endereços'], ['vinc', '👪 Vínculos'], ['bnmp', '⚖ BNMP'], ['proc', '🏛 Processos'], ['tempo', '🕒 Linha do tempo']];
    function fotosConsulta(r) {
        const fotos = (r.fotos || []).filter(Boolean);
        const qQuimera = r.fotoQuimera && r.fotoQuimera.temFoto ? (r.fotoQuimera.quantidade || 1) : 0;
        return fotos.map((url, i) => ({ url, fonte: i < qQuimera ? 'IDSEG/Quimera (RG)' : 'Alcatraz' }));
    }
    function enderecosConsulta(r) {
        const vistos = new Set(), lista = [];
        const campo = o => { if (!o) return null; const k = Object.keys(o).find(x => /endere/i.test(x)); return k ? o[k] : null; };
        const add = (e, data, fonte) => { const t = textoLimpo(e); const k = semAcento(t).toUpperCase().replace(/\s+/g, ' '); if (!t || vistos.has(k)) return; vistos.add(k); lista.push({ endereco: t, data, fonte }); };
        (r.idnet || []).forEach(reg => add(campo(reg), reg['Data de Atendimento no IC'], 'Identificação civil'));
        add(campo(r.cnh), null, 'CNH');
        (r.enderecosEquatorial || []).forEach(e => add(e.endereco, null, 'Equatorial'));
        return lista;
    }
    const ordData = d => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? `${m[3]}${m[2]}${m[1]}${m[4] || '00'}${m[5] || '00'}` : String(d || ''); };
    function linhaTempo(r) {
        const it = [];
        (r.ocorrenciasDespacho || []).forEach(o => it.push({ data: val(o.dt_ocor), texto: `${val(o.ds_ocor_sgrup) || 'Ocorrência'}${o.id_ocor_fk ? ' — nº ' + o.id_ocor_fk : ''}`, env: val(o.ds_oco_despc_tipo_envl), fonte: 'CAD' }));
        (r.ocorrenciasPpe || []).forEach(o => it.push({ data: val(o.dt_ocorrencia), texto: val(o.no_natureza_ocorrencia) || 'Ocorrência', env: val(o.tipo_envolvimento), fonte: 'PPE' }));
        (r.ocorrenciasPcAntigo || []).forEach(o => it.push({ data: val(o.data_hora_registro), texto: `Boletim ${val(o.attr_numero_bo) || '—'}`, env: '', fonte: 'Registro anterior' }));
        (r.processos || []).forEach(p => { const m = p.ultimoMovimento || {}; if (m.dataHora) it.push({ data: new Date(m.dataHora).toLocaleDateString('pt-BR'), texto: `Processo ${p.numeroProcesso} — ${val(m.textoCompleto || m.nome).slice(0, 90)}`, env: '', fonte: p.tribunal || 'Tribunal' }); });
        return it.sort((a, b) => ordData(b.data).localeCompare(ordData(a.data)));
    }
    const camposDetalhe = d => (d && (d.campos || d)) || {};
    async function carregarDetalhe(a, tipo, chave, params) {
        a.detalhes = a.detalhes || {};
        const k = tipo + ':' + chave;
        if (a.detalhes[k]) return a.detalhes[k];
        if (tipo === 'despacho') {
            const pronto = ((a.consultaRaw || {}).detalhesOcorrencias || []).find(d => String(d.idOcorrencia) === String(chave));
            if (pronto) return (a.detalhes[k] = { campos: pronto.campos || {}, envolvidos: pronto.envolvidos || [], veiculos: pronto.veiculos || [] });
        }
        const resp = await P3AtualizadorLocal.ocorrenciaDetalhe(params);
        if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'sem resposta');
        let d = resp.detalhe;
        if (Array.isArray(d)) d = { campos: d.reduce((acc, bloco, i) => { Object.entries(bloco || {}).forEach(([x, v]) => { acc[`${x} (envolvido ${i + 1})`] = v; }); return acc; }, {}) };
        return (a.detalhes[k] = { campos: camposDetalhe(d), envolvidos: (d && d.envolvidos) || [], veiculos: (d && d.veiculos) || [] });
    }
    const kvDet = d => kv(Object.entries(d.campos || {}).map(([k, v]) => [k, textoLimpo(v)]))
        + ((d.envolvidos || []).length ? `<div class="ri-sub" style="margin:8px 0 4px;">Envolvidos (${d.envolvidos.length})</div>` + d.envolvidos.map(e => kv(Object.entries(e))).join('<hr style="border:0;border-top:1px dotted rgba(255,255,255,.15);">') : '')
        + ((d.veiculos || []).length ? `<div class="ri-sub" style="margin:8px 0 4px;">Veículos (${d.veiculos.length})</div>` + d.veiculos.map(v => kv(Object.entries(v))).join('') : '');

    function abaConsulta(a) {
        const c = a.consulta, r = a.consultaRaw, cpf = String(a.ficha.dados.cpf || '').replace(/\D/g, '');
        const botao = `<button class="ri-btn ri-btn-pri" data-consulta-aba ${cpf.length === 11 ? '' : 'disabled'}>${c ? '↻ Consultar novamente' : '🔎 Executar Consulta Integrada'} (CAD, PPE, Alcatraz, IDSEG/Quimera, BNMP, Tribunais)</button>`;
        if (!c || !r) return `<p class="ri-sub" style="margin:0 0 10px;">${cpf.length === 11 ? 'A mesma consulta da página “Consulta Integrada de Pessoas”, pelo CPF do alvo. Os resultados aparecem aqui e podem ir para o relatório (Anexo B), com detalhe completo das ocorrências.' : '⚠️ Ficha sem CPF — a Consulta Integrada exige CPF.'}</p>${botao}`;
        const s = a.sel, inc = k => `<label class="ri-inc"><input type="checkbox" data-cb="${k}" ${s.cb && s.cb.has(k) ? 'checked' : ''}> incluir no relatório</label>`;
        const sec = (k, titulo, corpo, n) => `<div class="ri-item"><h4>${titulo}${n != null ? ` <em class="ri-n2">${n}</em>` : ''} ${inc(k)}</h4>${corpo}</div>`;
        const fotos = fotosConsulta(r);
        const fotosH = fotos.length ? `<div class="ri-fotos">${fotos.map((f, i) => `<div class="ri-foto"><img src="${esc(f.url)}" alt="" data-zoom="${esc(f.url)}" data-leg="${esc(f.fonte)}">
            <div><span class="ri-leg">${esc(f.fonte)}</span><button class="ri-btn ri-btn-mini${s.fotoExt === f.url ? ' on' : ''}" data-ci-foto="${i}" title="Foto do Anexo A">👤</button>
            <button class="ri-btn ri-btn-mini${(s.registroExt || []).includes(f.url) ? ' on' : ''}" data-ci-reg="${i}" title="Registro fotográfico">📷</button></div></div>`).join('')}</div>`
            : `<div class="ri-meta">${r.fotoQuimera && r.fotoQuimera.consultado ? 'Quimera consultado: ' + (r.fotoQuimera.motivo === 'pessoa_nao_encontrada' ? 'pessoa não encontrada.' : 'sem foto cadastrada.') : 'Nenhuma foto encontrada.'}</div>`;
        const tabOc = (lista, cols, tipo, chaveFn, paramsFn) => lista.length ? `<div class="ri-scroll"><table class="ri-tab"><tr>${cols.map(x => `<th>${x[0]}</th>`).join('')}<th>Relatório</th></tr>${lista.map((o, i) => {
                const ch = chaveFn(o, i), key = tipo + ':' + ch;
                return `<tr class="ri-oc" data-oc-tipo="${tipo}" data-oc-i="${i}">${cols.map(x => `<td>${esc(x[1](o))}</td>`).join('')}<td><label class="ri-inc" onclick="event.stopPropagation()"><input type="checkbox" data-detalhar="${esc(key)}" ${s.detalhar && s.detalhar.has(key) ? 'checked' : ''}> detalhar</label></td></tr>
                    <tr class="ri-oc-det" id="det-${esc(tipo)}-${i}"><td colspan="${cols.length + 1}">${a.detalhes && a.detalhes[key] ? kvDet(a.detalhes[key]) : ''}</td></tr>`; }).join('')}</table></div>` : '<div class="ri-meta">Nenhuma.</div>';
        const desp = r.ocorrenciasDespacho || [], ppe = r.ocorrenciasPpe || [], pc = r.ocorrenciasPcAntigo || [];
        const ends = enderecosConsulta(r), vo = r.vinculosOcorrencia || [], p = r.pessoa || {};
        const tempo = linhaTempo(r);
        return `<p class="ri-sub" style="margin:0 0 10px;">Consultado em ${esc(new Date(c.consultadoEm).toLocaleString('pt-BR'))}. Clique numa ocorrência para ver o detalhe completo do CAD; marque “detalhar” para levá-lo ao relatório (Anexo B).</p>
            <div class="ri-lista">
            ${sec('fotos', '📷 Fotos — Alcatraz / IDSEG-Quimera', fotosH, fotos.length)}
            ${sec('cad', '🚓 Ocorrências — CAD (despacho)', tabOc(desp, [['Nº', o => val(o.id_ocor_fk || o._id_ocor)], ['Data', o => val(o.dt_ocor)], ['Natureza', o => val(o.ds_ocor_sgrup)], ['Envolvimento', o => val(o.ds_oco_despc_tipo_envl)], ['Situação', o => val(o.ds_ocor_despc_envl_pess_sitc)]], 'despacho', o => val(o._id_ocor || o.id_ocor_fk)), desp.length)}
            ${sec('ppe', '🚔 Ocorrências policiais — PPE', tabOc(ppe, [['Data', o => val(o.dt_ocorrencia)], ['Natureza', o => val(o.no_natureza_ocorrencia)], ['Envolvimento', o => val(o.tipo_envolvimento)], ['Sexo', o => val(o.sexo)]], 'ppe', (o, i) => val(o._id) || String(i)), ppe.length)}
            ${pc.length ? sec('pc', '🗂 Registros anteriores (PC)', tabOc(pc, [['Nº BO', o => val(o.attr_numero_bo)], ['Data', o => val(o.data_hora_registro)]], 'pc_antigo', o => val(o._env || o.attr_numero_bo)), pc.length) : ''}
            ${sec('end', '📍 Endereços (identificação civil / CNH)', ends.length ? ends.map(e => `<div class="ri-meta">🏠 <b>${esc(e.endereco)}</b> · ${esc(e.fonte)}${e.data ? ' · ' + esc(e.data) : ''}</div>`).join('') : '<div class="ri-meta">Nenhum.</div>', ends.length)}
            ${sec('vinc', '👪 Vínculos', `${p.mae || p.pai ? kv([['Mãe', p.mae], ['Pai', p.pai]]) : ''}${vo.length ? `<div class="ri-scroll" style="margin-top:6px;"><table class="ri-tab"><tr><th>Nome</th><th>Envolvimento</th><th>Ocorrência</th><th>Data</th><th>Tipificação</th></tr>${vo.map(v => `<tr><td>${esc(v.nome)}${v.cpf ? '<br><small>CPF ' + esc(cpfFmt(v.cpf)) + '</small>' : ''}</td><td>${esc(v.tipoEnvolvimento)}</td><td>${esc(v.numeroOcorrencia)}</td><td>${esc(v.data)}</td><td>${esc(v.tipificacao)}</td></tr>`).join('')}</table></div>` : '<div class="ri-meta">Sem vínculos por ocorrência.</div>'}`, vo.length)}
            ${sec('bnmp', '⚖ BNMP — mandados de prisão', `<span class="ri-tag${c.bnmp.possui ? ' v' : ''}">${c.bnmp.possui ? 'MANDADO EM ABERTO' : 'nada consta'}</span>${c.bnmp.detalhe ? kv(Object.entries(c.bnmp.detalhe)) : ''}`)}
            ${sec('proc', '🏛 Processos (TJAL / TJSP)', c.processos.length ? c.processos.map(x => `<div class="ri-meta">${x.ativo ? '🟢' : '⚪'} <b>${esc(x.tribunal)} ${esc(x.numero)}</b> · ${esc([x.classe, x.assunto].filter(Boolean).join(' — ') || '—')}${x.ultimo ? ' · último andamento: ' + esc(x.ultimo.slice(0, 140)) : ''}</div>`).join('') : '<div class="ri-meta">Nenhum.</div>', c.processos.length)}
            ${sec('tempo', '🕒 Linha do tempo', tempo.length ? tempo.map(t => `<div class="ri-meta"><b>${esc(t.data || '—')}</b> · ${esc(t.texto)}${t.env ? ' (' + esc(t.env) + ')' : ''} <span class="ri-tag">${esc(t.fonte)}</span></div>`).join('') : '<div class="ri-meta">Sem eventos datados.</div>', tempo.length)}
            </div><div style="margin-top:10px;">${botao}</div>`;
    }
    function ligarAbaConsulta(el, a) {
        const s = a.sel, r = a.consultaRaw;
        if (!r) return;
        el.querySelectorAll('[data-cb]').forEach(cb => cb.onchange = () => { s.cb = s.cb || new Set(); cb.checked ? s.cb.add(cb.dataset.cb) : s.cb.delete(cb.dataset.cb); });
        el.querySelectorAll('[data-detalhar]').forEach(cb => cb.onchange = async () => {
            s.detalhar = s.detalhar || new Set();
            const key = cb.dataset.detalhar;
            if (!cb.checked) { s.detalhar.delete(key); return; }
            s.detalhar.add(key);
            const tr = cb.closest('tr'); if (tr && !(a.detalhes || {})[key]) tr.click(); // já carrega o detalhe para o relatório
        });
        const fotos = fotosConsulta(r);
        el.querySelectorAll('[data-ci-foto]').forEach(b => b.onclick = () => { const u = fotos[+b.dataset.ciFoto].url; s.fotoExt = s.fotoExt === u ? null : u; renderFicha(); renderAlvos(); });
        el.querySelectorAll('[data-ci-reg]').forEach(b => b.onclick = () => { const u = fotos[+b.dataset.ciReg].url; s.registroExt = s.registroExt || []; const k = s.registroExt.indexOf(u); k >= 0 ? s.registroExt.splice(k, 1) : s.registroExt.push(u); renderFicha(); });
        el.querySelectorAll('tr.ri-oc').forEach(tr => tr.onclick = async () => {
            const tipo = tr.dataset.ocTipo, i = +tr.dataset.ocI, det = document.getElementById(`det-${tipo}-${i}`);
            if (!det) return;
            if (det.classList.contains('aberto')) { det.classList.remove('aberto'); return; }
            det.classList.add('aberto');
            const lista = tipo === 'despacho' ? r.ocorrenciasDespacho : tipo === 'ppe' ? r.ocorrenciasPpe : r.ocorrenciasPcAntigo;
            const o = lista[i];
            const chave = tipo === 'despacho' ? val(o._id_ocor || o.id_ocor_fk) : tipo === 'ppe' ? (val(o._id) || String(i)) : val(o._env || o.attr_numero_bo);
            const params = tipo === 'despacho' ? { tipo: 'despacho', idOcor: chave } : tipo === 'ppe' ? { tipo: 'ppe', id: val(o._id), hash: val(o._hash) } : { tipo: 'pc_antigo', numeroBo: chave };
            const td = det.querySelector('td');
            if (!td.innerHTML.trim()) td.innerHTML = '<div class="ri-meta">⏳ Carregando o detalhe no CAD…</div>';
            try { td.innerHTML = kvDet(await carregarDetalhe(a, tipo, chave, params)); }
            catch (e) { td.innerHTML = `<div class="ri-meta">⚠️ ${esc(e.message)}</div>`; }
        });
    }
    const fotoCard = s => x => `<div class="ri-foto"><img src="${esc(x.url)}" alt="" data-zoom="${esc(x.url)}" data-leg="${esc(x.legenda || '')}">
        <div><span class="ri-leg">${esc(x.legenda || (x.tipo === 'residencia' ? 'Imóvel' : x.tipo === 'veiculo' ? 'Veículo' : 'Pessoa'))}</span>
        <button class="ri-btn ri-btn-mini${s.foto === x.id ? ' on' : ''}" data-sel-foto="${esc(x.id)}" title="Foto do Anexo A">👤</button>
        <button class="ri-btn ri-btn-mini${s.imovel === x.id ? ' on' : ''}" data-sel-imovel="${esc(x.id)}" title="Foto do imóvel no Anexo A">🏠</button>
        <button class="ri-btn ri-btn-mini${s.registro.has(x.id) ? ' on' : ''}" data-sel-reg="${esc(x.id)}" title="Registro fotográfico">📷</button></div></div>`;
    function ligarAba(el, a) {
        const s = a.sel;
        const recarregar = () => { renderFicha(); renderAlvos(); };
        el.querySelectorAll('[data-sel-foto]').forEach(b => b.onclick = () => { s.foto = b.dataset.selFoto; recarregar(); });
        el.querySelectorAll('[data-sel-imovel]').forEach(b => b.onclick = () => { s.imovel = s.imovel === b.dataset.selImovel ? null : b.dataset.selImovel; recarregar(); });
        el.querySelectorAll('[data-sel-reg]').forEach(b => b.onclick = () => { const id = b.dataset.selReg; s.registro.has(id) ? s.registro.delete(id) : s.registro.add(id); recarregar(); });
        el.querySelectorAll('[data-end]').forEach(r => r.onchange = () => { s.endereco = +r.dataset.end; });
        el.querySelectorAll('[data-informe]').forEach(c => c.onchange = () => { const i = +c.dataset.informe; c.checked ? s.informes.add(i) : s.informes.delete(i); });
        el.querySelectorAll('[data-fc]').forEach(c => c.onchange = () => { const i = +c.dataset.fc; c.checked ? s.fc.add(i) : s.fc.delete(i); renderAlvos(); });
        el.querySelectorAll('[data-usar-info]').forEach(b => b.onclick = () => { s.info = textoLimpo(a.ficha.informacoes[+b.dataset.usarInfo].texto); b.textContent = '✔ usado no Anexo A'; });
        const bc = el.querySelector('[data-consulta-aba]'); if (bc) bc.onclick = () => { bc.disabled = true; consultarIntegrada(a, bc); };
        if (E.aba === 'consulta') ligarAbaConsulta(el, a);
        const ta = el.querySelector('[data-info]'); if (ta) ta.oninput = () => { s.info = ta.value; };
        el.querySelectorAll('[data-zoom]').forEach(img => img.onclick = () => { $('ri-zoom-img').src = img.dataset.zoom; $('ri-zoom-tit').textContent = img.dataset.leg || 'Foto'; $('ri-modal-zoom').classList.add('aberto'); });
    }

    // ── texto limpo (ExchelonX guarda "Informações" em HTML e CAIXA ALTA) ──
    // DOMParser não executa script nem carrega imagem do conteúdo (seguro).
    const PARSER = new DOMParser();
    function textoLimpo(v) {
        let s = String(v == null ? '' : v);
        for (let i = 0; i < 2 && /<\/?[a-z][\s\S]*?>|&[a-z#0-9]+;/i.test(s); i++) {
            s = PARSER.parseFromString(s.replace(/<\s*(br|\/div|\/p|\/li)\s*\/?>/gi, '\n'), 'text/html').body.textContent || '';
        }
        return s.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
    }
    const SIGLAS = ['AL', 'CPF', 'RG', 'BO', 'B.O', 'PM', 'PC', 'PMAL', 'CV', 'PCC', 'ORCRIM', 'BNMP', 'TJAL', 'CAD', 'SISP', 'GOE', 'BPM', 'P2', 'DNISP', 'CNH', 'IML'];
    function termosProprios() {
        const t = new Set(SIGLAS);
        E.alvos.filter(a => a.ficha).forEach(a => {
            const f = a.ficha;
            [f.dados.nome, ...(f.apelidos || [])].forEach(n => { if (val(n)) t.add(val(n)); });
            (f.enderecos || []).forEach(e => [e.cidade, e.bairro].forEach(x => { if (val(x)) t.add(val(x)); }));
            (f.vinculos || []).forEach(v => { if (val(v.nome)) t.add(val(v.nome)); });
        });
        return [...t].sort((a, b) => b.length - a.length);
    }
    const semAcento = s => String(s).normalize('NFC').normalize('NFD').replace(/[̀-ͯ]/g, '');
    // Termos próprios (nomes, vulgos, cidades, siglas) voltam para MAIÚSCULAS —
    // comparação sem acento, posição a posição (mesmo comprimento).
    function maiusculizarTermos(t) {
        const sombra = semAcento(t).toUpperCase();
        if (sombra.length !== t.length) return t;
        const arr = t.split('');
        for (const termo of termosProprios()) {
            const alvo = semAcento(termo).toUpperCase();
            if (alvo.length < 2) continue;
            for (let pos = sombra.indexOf(alvo); pos >= 0; pos = sombra.indexOf(alvo, pos + alvo.length)) {
                const antes = pos === 0 || !/[A-Z0-9]/.test(sombra[pos - 1]);
                const depois = pos + alvo.length >= sombra.length || !/[A-Z0-9]/.test(sombra[pos + alvo.length]);
                if (antes && depois) for (let k = pos; k < pos + alvo.length; k++) arr[k] = arr[k].toUpperCase();
            }
        }
        return arr.join('');
    }
    // CAIXA ALTA → frase, preservando nomes/vulgos/cidades/siglas e trechos entre aspas.
    function normalizarCaixa(s) {
        s = String(s || '').normalize('NFC');
        const letras = s.replace(/[^A-Za-zÀ-ÿ]/g, '');
        if (!letras || (letras.replace(/[^A-ZÀ-Þ]/g, '').length / letras.length) < 0.6) return s;
        let t = s.toLowerCase().replace(/(^|[.!?]\s+|\n)([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
        t = maiusculizarTermos(t);
        return t.replace(/["“]([^"”]{1,60})["”]/g, (m, x) => `“${x.trim().toUpperCase()}”`);
    }
    // Informes (não confirmados) → futuro do pretérito, como recomenda a DNISP.
    const VERBOS_FP = { possui: 'possuiria', possuí: 'possuiria', armazena: 'armazenaria', utiliza: 'utilizaria', usa: 'usaria', reside: 'residiria', mora: 'moraria',
        atua: 'atuaria', comercializa: 'comercializaria', guarda: 'guardaria', vende: 'venderia', trafica: 'traficaria', esconde: 'esconderia', frequenta: 'frequentaria',
        mantém: 'manteria', tem: 'teria', estoca: 'estocaria', distribui: 'distribuiria', anda: 'andaria', porta: 'portaria', integra: 'integraria', lidera: 'lideraria', chefia: 'chefiaria' };
    const NAO_CONJUGAR = /(?:^|\s)(para|como|de|sem|pode|possa|podem|deve|vai|irá|ao|por|a|que\s+não\s+teria\s+como)\s*$/i;
    const PRIMEIRA_PESSOA = { 'acreditávamos': 'acreditava-se', 'tínhamos': 'tinha-se', 'sabemos': 'sabe-se', 'verificamos': 'verificou-se', 'constatamos': 'constatou-se',
        'identificamos': 'identificou-se', 'observamos': 'observou-se', 'percebemos': 'percebeu-se', 'recebemos': 'recebeu-se', 'fomos': 'foi-se' };
    const futuroPreterito = t => t
        .replace(/(^|[^A-Za-zÀ-ÿ])(acreditávamos|tínhamos|sabemos|verificamos|constatamos|identificamos|observamos|percebemos|recebemos)(?=[^A-Za-zÀ-ÿ]|$)/gi, (m, a, v) => a + PRIMEIRA_PESSOA[v.toLowerCase()])
        .replace(/(^|[^A-Za-zÀ-ÿ])(possui|possuí|armazena|utiliza|usa|reside|mora|atua|comercializa|guarda|vende|trafica|esconde|frequenta|mantém|tem|estoca|distribui|anda|porta|integra|lidera|chefia)(?=[^A-Za-zÀ-ÿ]|$)/g,
            (m, a, v, pos, tudo) => NAO_CONJUGAR.test(tudo.slice(Math.max(0, pos - 40), pos + a.length)) ? m : a + VERBOS_FP[v]);
    function cortarEmFrase(t, max) {
        if (t.length <= max) return t;
        const corte = t.slice(0, max), fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '));
        return (fim > max * 0.5 ? corte.slice(0, fim + 1) : corte.replace(/\s+\S*$/, '') + '…');
    }
    // Informe bruto → parágrafo analítico (sem acrescentar fatos).
    function redigirInforme(texto, ref) {
        let t = normalizarCaixa(textoLimpo(texto))
            // fórmulas protocolares de denúncia/BO e restos de importação de planilha
            .replace(/sem mais a (detalhar|declarar)[^.]*\.?/gi, '').replace(/era o que tinha a declarar\.?/gi, '').replace(/deu por encerrad[ao][^.]*\.?/gi, '')
            .replace(/ficha criminal \(texto original[^)]*\)\s*:?\s*\.?[^.]*\.?/gi, '').trim();
        if (!t) return '';
        // Origem genérica do informe (sem identificar a fonte — DNISP)
        if (/^denunciante\b/i.test(t)) t = 'Segundo denúncia recebida, o ' + t.charAt(0).toLowerCase() + t.slice(1);
        t = futuroPreterito(cortarEmFrase(t, 1400));
        t = t.replace(/(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*atualiza[cç][aã]o\s*[-–:]?\s*/gi, '\nEm atualização de $1, ')
            .replace(/\s*,\s*,/g, ',').replace(/\s+([,.;:!?)])/g, '$1').replace(/\(\s+/g, '(').replace(/([,;:])(?=[“"A-Za-zÀ-ÿ])/g, '$1 ');
        return t.split('\n').map(x => x.trim()).filter(Boolean).map((x, i) => {
            if (i === 0 && !/^(segundo|conforme|de acordo|em atualiza)/i.test(x)) x = `Segundo informes de inteligência, ${x.charAt(0).toLowerCase()}${x.slice(1)}`;
            return /[.!?]$/.test(x) ? x : x + '.';
        });
    }

    // ── Consulta Integrada de Pessoas (CAD / BNMP / TJAL-TJSP) por alvo ──
    const ENV_AUTOR = /AUTOR|SUSPEIT|INFRATOR|ACUSAD|CONDUZID|PRES[OA]|INDICIAD|INVESTIGAD|DETID|FLAGRAN/i;
    const PROC_INATIVO = /ARQUIVAD|BAIXA DEFINITIVA|EXTIN[CÇ]|TRANSITAD|TR[AÂ]NSITO EM JULGADO|CANCELAD/i;
    function resumirConsulta(r) {
        const oc = [];
        (r.ocorrenciasDespacho || []).forEach(o => oc.push({ fonte: 'CAD', numero: val(o.id_ocor_fk || o._id_ocor), data: val(o.dt_ocor), natureza: val(o.ds_ocor_sgrup), envolvimento: val(o.ds_oco_despc_tipo_envl), situacao: val(o.ds_ocor_despc_envl_pess_sitc) }));
        (r.ocorrenciasPpe || []).forEach(o => oc.push({ fonte: 'PPE', numero: '', data: val(o.dt_ocorrencia), natureza: val(o.no_natureza_ocorrencia), envolvimento: val(o.tipo_envolvimento), situacao: '' }));
        (r.ocorrenciasPcAntigo || []).forEach(o => oc.push({ fonte: 'PC', numero: val(o.attr_numero_bo), data: val(o.data_hora_registro), natureza: 'registro policial', envolvimento: '', situacao: '' }));
        const procs = (r.processos || []).map(p => { const mov = p.ultimoMovimento || {}; const txt = val(mov.textoCompleto || mov.nome);
            return { tribunal: val(p.tribunal) || 'TJAL', numero: val(p.numeroProcesso), classe: val(p.classe), assunto: val(p.assunto), ultimo: txt, dataUltimo: mov.dataHora || '', ativo: !PROC_INATIVO.test(txt) }; });
        const m = r.mandados || {};
        return { consultadoEm: new Date().toISOString(), ocorrencias: oc, processos: procs,
            bnmp: { possui: !!m.possuiMandado, detalhe: m.detalhe ? Object.fromEntries(Object.entries(m.detalhe).filter(([, v]) => val(v)).map(([k, v]) => [k, textoLimpo(v)])) : null } };
    }
    async function consultarIntegrada(a, botao) {
        const cpf = String(a.ficha.dados.cpf || '').replace(/\D/g, '');
        if (cpf.length !== 11) { alert('A Consulta Integrada exige CPF — esta ficha não tem CPF cadastrado.'); return; }
        if (!window.P3AtualizadorLocal || !P3AtualizadorLocal.consultarPessoaStream) { alert('Atualizador local indisponível.'); return; }
        const txt = botao ? botao.textContent : '';
        try {
            a.consultando = true;
            const r = await P3AtualizadorLocal.consultarPessoaStream(cpf, ev => { if (botao && ev.fonte) botao.textContent = `⏳ ${ev.fonte}…`; });
            a.consultaRaw = r || {};
            a.consulta = resumirConsulta(a.consultaRaw);
            a.detalhes = {};
            // padrão: todas as seções entram no Anexo B; ocorrências detalhadas = nenhuma
            a.sel.cb = new Set(['fotos', 'cad', 'ppe', 'pc', 'end', 'vinc', 'bnmp', 'proc', 'tempo']);
            a.sel.detalhar = new Set();
        } catch (e) { alert(`Consulta Integrada de ${a.ficha.dados.nome}: ${e.message}`); }
        a.consultando = false;
        if (botao) botao.textContent = txt;
        renderAlvos(); renderFicha();
    }
    async function consultarTodos(botao) {
        const lista = E.alvos.filter(a => a.ficha && String(a.ficha.dados.cpf || '').replace(/\D/g, '').length === 11);
        if (!lista.length) { alert('Nenhum alvo com CPF para consultar.'); return; }
        botao.disabled = true;
        for (let i = 0; i < lista.length; i++) { botao.textContent = `⏳ ${i + 1}/${lista.length} — ${lista[i].ficha.dados.nome.split(' ')[0]}…`; await consultarIntegrada(lista[i]); }
        botao.disabled = false; botao.textContent = '🔎 Consulta Integrada de todos';
    }
    const ocorrenciasAutor = a => ((a.consulta || {}).ocorrencias || []).filter(o => !o.envolvimento || ENV_AUTOR.test(o.envolvimento));
    const processosAtivos = a => ((a.consulta || {}).processos || []).filter(p => p.ativo);

    // ── geração do texto — redação de analista (DNISP) ──────────────
    // · impessoal, 3ª pessoa; futuro do pretérito para o que vem de informes
    //   não confirmados (seria / atuaria / utilizaria); presente/pretérito
    //   para o que consta de registros oficiais (CAD, BNMP, Tribunais);
    // · fontes nunca identificadas (fontes humanas, levantamentos de campo);
    // · conclusão analítica dirigida ao decisor.
    // Cada parágrafo leva data-bloco/data-rotulo para a prévia (caixas de seleção).
    const registrosSel = a => (a.ficha.fichaCriminal || []).filter((r, i) => a.sel.fc.has(i));
    const enderecoSel = a => (a.ficha.enderecos || [])[a.sel.endereco] || (a.ficha.enderecos || [])[0] || null;
    function antecedentes(a) {
        // ExchelonX (ficha criminal selecionada) + CAD (Consulta Integrada, como autor/suspeito), sem repetir nº.
        const itens = [], vistos = new Set();
        registrosSel(a).forEach(r => { const n = val(r.numero); if (n) vistos.add(n.replace(/\D/g, '')); itens.push({ crime: val(r.crimes).toLowerCase() || 'registro policial', ref: `${r.tipo || 'BO'} nº ${n || 'não informado'}`, data: dataBR(r.dataFato) }); });
        ocorrenciasAutor(a).forEach(o => { const n = val(o.numero).replace(/\D/g, ''); if (n && vistos.has(n)) return; if (n) vistos.add(n); itens.push({ crime: normalizarCaixa(o.natureza).toLowerCase() || 'ocorrência policial', ref: o.numero ? `ocorrência nº ${o.numero}` : (val(o.data) ? `registro de ${val(o.data).slice(0, 10)}` : `registro no CAD`), data: val(o.data).slice(0, 10) }); });
        return itens;
    }
    function historicoTexto(a, ref) {
        const itens = antecedentes(a);
        if (!itens.length) return `Nas bases consultadas, não foram localizados registros criminais em que ${ref} figure como autor ou suspeito.`;
        const porCrime = new Map();
        itens.forEach(x => (porCrime.get(x.crime) || porCrime.set(x.crime, []).get(x.crime)).push(x.ref));
        const partes = [...porCrime.entries()].map(([c, refs]) => `${c} (${refs.join('; ')})`);
        return `Quanto aos antecedentes, constam registros em desfavor de ${ref} por ${listaE(partes)}${itens.length >= 3 ? ', circunstância que evidencia reiteração delitiva' : ''}.`;
    }
    function situacaoJudicialTexto(a, ref) {
        const f = a.ficha, c = a.consulta;
        const ps = [];
        const abertosEx = (f.mandados || []).filter(m => !/cumprid|baixad|revogad/i.test(m.status || ''));
        if (c && c.bnmp.possui) {
            const d = c.bnmp.detalhe || {};
            const resumo = ['Tipo', 'Espécie', 'Número', 'Nº do Mandado', 'Processo', 'Órgão', 'Situação'].map(k => Object.keys(d).find(x => semAcento(x).toLowerCase().includes(semAcento(k).toLowerCase()))).filter(Boolean).slice(0, 4).map(k => `${k.toLowerCase()}: ${d[k]}`).join('; ');
            ps.push(`Em consulta ao Banco Nacional de Medidas Penais e Prisões (BNMP), verifica-se a existência de mandado de prisão em aberto em desfavor de ${ref}${resumo ? ' (' + esc(resumo) + ')' : ''}.`);
        } else if (c) ps.push(`Em consulta ao BNMP, não foi localizado mandado de prisão em aberto em desfavor de ${ref}.`);
        if (abertosEx.length) ps.push(`Nos registros da Agência, consta(m) ${abertosEx.map(m => `mandado de ${esc(val(m.tipo).toLowerCase() || 'prisão')}${m.numero ? ' nº ' + esc(m.numero) : ''}${m.processo ? ', expedido nos autos do processo nº ' + esc(m.processo) : ''}${m.vara ? ' (' + esc(m.vara) + ')' : ''}${m.status ? ', situação: ' + esc(m.status.toLowerCase()) : ''}`).join('; ')}.`);
        const pa = c ? processosAtivos(a) : [];
        if (pa.length) ps.push(`No âmbito judicial, ${ref} figura em ${pa.length} processo(s) em tramitação${pa.length > 3 ? ', destacando-se' : ':'} ${pa.slice(0, 3).map(p => `nº ${esc(p.numero)} (${esc(p.tribunal)}${p.classe || p.assunto ? ' – ' + esc([p.classe, p.assunto].filter(Boolean).join(', ').toLowerCase()) : ''})`).join('; ')}.`);
        return ps;
    }
    const fem = f => /^F/i.test(String(f.dados.sexo || ''));
    const sexoConhecido = f => /^[FM]/i.test(String(f.dados.sexo || ''));
    const gen = (f, m, fe) => fem(f) ? fe : m;
    // Endereço vindo do banco às vezes repete o tipo ("RUA RUA NOVA").
    const enderecoTexto = e => String(e.texto || '').replace(/^([A-ZÀ-Ú]+)\s+\1\b/, '$1');
    const unicos = arr => [...new Set(arr.map(x => x.trim()).filter(Boolean).map(x => x.toLowerCase()))];
    // Informes do alvo: só os vínculos como ALVO/SUSPEITO/AUTOR (ou de relatório de busca);
    // relatos em que a pessoa é vítima/testemunha não descrevem a atuação do alvo.
    const RELATO_VITIMA = /a declarante|o declarante|declarante\/v[ií]tima|v[ií]tima relata|ciente das penalidades|era o que tinha a declarar/i;
    const informePadrao = x => !/VITIMA|VÍTIMA|TESTEMUNHA|DECLARANTE/i.test(x.papel || '') && !RELATO_VITIMA.test(textoLimpo(x.texto));
    const informesDoAlvo = a => (a.ficha.informacoes || []).filter((x, i) => a.sel.informes ? a.sel.informes.has(i) : informePadrao(x));
    const P = (bloco, rotulo, html, ia) => `<p data-bloco="${bloco}" data-rotulo="${esc(rotulo)}"${ia ? ' data-ia="1"' : ''}>${html}</p>`;
    function paragrafosAlvo(a, i, orcrim, total) {
        const f = a.ficha, NOME = up(f.dados.nome), vg = vulgo(f);
        const nome = `<b>${esc(NOME)}</b>`, v = vg ? `, vulgo <b>“${esc(up(vg))}”</b>` : '';
        const ref = vg ? `<b>“${esc(up(vg))}”</b>` : nome;
        const funcao = val(a.funcao).toLowerCase();
        const k = `alvo${i}`, rot = n => `${String(i + 1).padStart(2, '0')} ${vg ? up(vg) : NOME.split(' ')[0]} — ${n}`;
        const ps = [];
        const nomeGrupo = E.grupo && val($('ri-grupo-nome').value) ? up($('ri-grupo-nome').value) : '';
        if (orcrim) {
            const abre = i === 0 ? 'No curso dos levantamentos realizados, apurou-se que' : (i === total - 1 && total > 2) ? 'Por fim, foi identificado' : 'Os levantamentos realizados indicam, ainda, que';
            ps.push(P(k + '-id', rot('identificação e função'), `${abre} ${nome}${v} ${funcao ? `seria responsável pela função de <b>${esc(funcao)}</b>` : 'integraria'} ${funcao ? 'no âmbito da organização criminosa' : 'a organização criminosa'}${nomeGrupo ? ' denominada <b>' + esc(nomeGrupo) + '</b>' : ''}, atuando de forma ${funcao ? 'articulada com os demais integrantes' : 'ainda não totalmente delimitada pelos levantamentos'}.`));
        } else {
            const qualif = [f.dados.nascimento ? `data de nascimento ${esc(dataBR(f.dados.nascimento))}` : '', f.dados.mae ? `filiação: ${esc(up(f.dados.mae))}${f.dados.pai ? ' e ' + esc(up(f.dados.pai)) : ''}` : ''].filter(Boolean).join(', ');
            ps.push(P(k + '-id', rot('identificação'), sexoConhecido(f)
                ? `${i === 0 ? `No curso dos levantamentos realizados, foi ${gen(f, 'identificado', 'identificada')}` : `Foi ${gen(f, 'identificado', 'identificada')}, ainda,`} ${nome}${v}${funcao ? `, que atuaria como <b>${esc(funcao)}</b>` : ''}${qualif ? ` (${qualif})` : ''}.`
                : `${i === 0 ? 'No curso dos levantamentos realizados, procedeu-se à identificação de' : 'Procedeu-se, ainda, à identificação de'} ${nome}${v}${qualif ? ` (${qualif})` : ''}${funcao ? `, apontado(a) como <b>${esc(funcao)}</b>` : ''}.`));
        }
        const end = enderecoSel(a);
        if (end) {
            const carac = unicos([end.pontoReferencia, ...(end.referencias || []), end.descricao].map(x => normalizarCaixa(textoLimpo(x)))).join('; ');
            ps.push(P(k + '-end', rot('endereço / imóvel'), `Por meio de levantamentos de inteligência, constatou-se que ${ref} residiria no imóvel situado na <span style="color:#c00000">${esc(enderecoTexto(end))}</span>${carac ? ` (${esc(carac)})` : ''}, local de interesse para eventuais medidas de natureza operacional.`));
        }
        // Mesmo informe importado por mais de uma fonte → entra uma vez só.
        const vistosInf = [];
        const assinatura = t => semAcento(textoLimpo(t)).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 160);
        informesDoAlvo(a).filter(x => { const k = assinatura(x.texto); if (!k || vistosInf.some(v => v.startsWith(k.slice(0, 100)) || k.startsWith(v.slice(0, 100)))) return false; vistosInf.push(k); return true; }).slice(0, 3).forEach((x, j) => {
            const linhas = redigirInforme(x.texto, ref);
            if (linhas.length) ps.push(P(`${k}-info${j}`, rot('informes de inteligência' + (j ? ' (2)' : '')), esc(linhas.join(' ')), true));
        });
        ps.push(P(k + '-hist', rot('antecedentes'), historicoTexto(a, ref)));
        const comoVitima = ((a.consulta || {}).ocorrencias || []).filter(o => /V[IÍ]TIMA/i.test(o.envolvimento || ''));
        if (comoVitima.length) ps.push(P(k + '-vit', rot('ocorrências como vítima'), `Registra, ainda, ocorrência(s) em que ${ref} figura como vítima, a saber: ${listaE(comoVitima.slice(0, 6).map(o => `${esc(normalizarCaixa(o.natureza).toLowerCase() || 'ocorrência')} (${o.numero ? 'nº ' + esc(o.numero) + ', ' : ''}${esc(val(o.data).slice(0, 10))})`))}, circunstância a ser considerada na avaliação de risco e de eventual envolvimento em conflitos.`));
        situacaoJudicialTexto(a, ref).forEach((t, j) => ps.push(P(`${k}-jud${j}`, rot('situação judicial'), t)));
        if ((f.veiculos || []).length) ps.push(P(k + '-veic', rot('veículos'), `Há registro de que ${ref} utilizaria ${f.veiculos.map(x => `o veículo ${esc(up(x.modelo))}${x.cor ? ', cor ' + esc(x.cor.toLowerCase()) : ''}${x.placa ? ', placa ' + esc(up(x.placa)) : ''}`).join('; ')}.`));
        const vinc = (f.vinculos || []).filter(x => val(x.nome)).slice(0, 4);
        if (vinc.length) ps.push(P(k + '-vinc', rot('vínculos'), `No tocante aos vínculos, ${ref} manteria relação ${listaE(vinc.map(x => `${esc((x.tipo || 'de vínculo').toLowerCase())} com ${esc(up(x.nome))}${x.observacao ? ' (' + esc(normalizarCaixa(textoLimpo(x.observacao)).toLowerCase()) + ')' : ''}`))}.`, true));
        if ((f.denuncias || []).length) {
            const d0 = f.denuncias[0];
            ps.push(P(k + '-den', rot('denúncias'), `Constam ${f.denuncias.length} denúncia(s) envolvendo ${ref}${f.denuncias.some(d => d.numero) ? ' (nº ' + f.denuncias.filter(d => d.numero).map(d => esc(d.numero)).join(', ') + ')' : ''}${val(d0.resumoBreve) ? `, que apontariam ${esc(normalizarCaixa(textoLimpo(d0.resumoBreve)).toLowerCase().replace(/\.$/, ''))}` : ''}, convergentes com os demais informes.`, true));
        }
        return ps;
    }
    const NAO_CRIME = /cumprimento de mandado|alvar[aá]|apoio|visita|sem ilicitude|perda|extravio|acidente|averigua|registro policial|ocorr[eê]ncia policial|desaparecimento|entrega|recupera/i;
    function crimesPredominantes() {
        const c = new Map();
        E.alvos.filter(a => a.ficha).forEach(a => antecedentes(a).filter(x => !NAO_CRIME.test(x.crime)).forEach(x => c.set(x.crime, (c.get(x.crime) || 0) + 1)));
        return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    }
    const cidadesAlvos = () => [...new Set(E.alvos.filter(a => a.ficha).map(a => val((enderecoSel(a) || {}).cidade)).filter(Boolean))];
    function gerarTexto() {
        const prontos = E.alvos.filter(a => a.ficha);
        if (!prontos.length) { alert('Adicione ao menos um alvo.'); return; }
        const orcrim = !!E.grupo || prontos.length > 1 && prontos.some(a => (a.ficha.grupos || []).length);
        const crimes = crimesPredominantes(), cidades = cidadesAlvos();
        const local = cidades.length ? listaE(cidades.map(c => esc(c.toUpperCase()))) + '/AL' : 'CIDADE/AL';
        const nomeG = val($('ri-grupo-nome').value);
        const comConsulta = prontos.some(a => a.consulta);
        const fontes = ['levantamentos de campo', 'informes de fontes humanas', 'consultas aos registros da Agência'].concat(comConsulta ? ['às bases do CAD/SISP, do BNMP e dos Tribunais'] : []);
        const ps = [];
        if (orcrim) {
            ps.push(P('intro', 'Introdução', `Informações acerca de uma organização criminosa (ORCRIM)${nomeG ? ' denominada <b>' + esc(up(nomeG)) + '</b>' : ''} apontam indivíduos suspeitos de crimes de ${crimes.length ? esc(listaE(crimes)) : 'tráfico de drogas e posse/porte irregular de arma de fogo'} com atuação em ${local}.`));
            ps.push(P('intro2', 'Contexto da ORCRIM', 'A ORCRIM utilizaria imóveis residenciais como pontos de apoio logístico para o armazenamento de substâncias entorpecentes, armas de fogo e outros materiais ilícitos, empregados na manutenção, proteção e expansão das atividades criminosas, circunstância que evidencia risco concreto à ordem pública e à segurança da coletividade local.'));
            ps.push(P('intro3', 'Estrutura da ORCRIM', `Após ações de inteligência — ${listaE(fontes)} —, apurou-se que a organização criminosa apresentaria estrutura definida, com divisão de funções entre seus integrantes, o que garantiria, em tese, a continuidade das atividades ilícitas de forma coordenada e dificultaria a atuação dos órgãos de segurança pública.`));
        } else {
            ps.push(P('intro', 'Introdução', `O presente relatório reúne conhecimentos produzidos a partir de ${listaE(fontes)} acerca de ${prontos.length > 1 ? 'indivíduos suspeitos' : 'indivíduo suspeito'} de envolvimento com ${crimes.length ? esc(listaE(crimes)) : 'práticas delituosas'} com atuação em ${local}.`));
        }
        prontos.forEach((a, i) => paragrafosAlvo(a, i, orcrim, prontos.length).forEach(p => ps.push(p)));
        const temMandado = prontos.some(a => (a.consulta && a.consulta.bnmp.possui) || (a.ficha.mandados || []).some(m => !/cumprid|baixad|revogad/i.test(m.status || '')));
        ps.push(P('concl', 'Conclusão', orcrim
            ? 'Diante dos elementos colhidos por meio das ações de inteligência, verifica-se a existência de indícios consistentes da atuação de organização criminosa estruturada, com divisão de funções entre seus integrantes e utilização de imóveis residenciais como pontos de apoio logístico para o armazenamento de drogas, armas de fogo e demais instrumentos empregados na prática criminosa, o que evidencia risco concreto à ordem pública e elevada probabilidade de continuidade delitiva.'
            : `Diante dos elementos colhidos, verificam-se indícios consistentes da atuação criminosa ${prontos.length > 1 ? 'dos indivíduos acima qualificados' : 'do indivíduo acima qualificado'}, com risco concreto à ordem pública e probabilidade de continuidade delitiva${temMandado ? ', agravada pela existência de mandado judicial pendente de cumprimento' : ''}.`));
        ps.push(P('fecho', 'Encaminhamento', 'Sendo assim, faz-se necessário o encaminhamento deste relatório para fins de subsídio à tomada de decisão.'));
        $('ri-corpo').innerHTML = ps.join('');
        const assunto = document.querySelector('[data-cab="assunto"]');
        if (!val(assunto.value)) assunto.value = orcrim ? `ORGANIZAÇÃO CRIMINOSA ATUANTE EM ${cidades.length ? cidades.join(', ').toUpperCase() : 'CIDADE'}/AL.` : `${prontos.length > 1 ? 'INDIVÍDUOS SUSPEITOS' : 'INDIVÍDUO SUSPEITO'} DE ATUAÇÃO CRIMINOSA EM ${cidades.length ? cidades.join(', ').toUpperCase() : 'CIDADE'}/AL.`;
    }

    // ── XERIFE ANALISTA: analisa ficha alvo + CAD + processos + BNMP e redige
    // o relatório completo (js/xerife-analista.js — determinístico, só com os dados).
    async function gerarComXerife(botao) {
        const prontos = E.alvos.filter(a => a.ficha);
        if (!prontos.length) { alert('Adicione ao menos um alvo.'); return; }
        if (!window.XerifeAnalista) { alert('Módulo de análise do XERIFE não carregado.'); return; }
        const txt = botao.textContent; botao.disabled = true;
        try {
            // 1) Consulta Integrada (CAD/BNMP/Tribunais) dos alvos com CPF que ainda não foram consultados
            const faltam = prontos.filter(a => !a.consulta && String(a.ficha.dados.cpf || '').replace(/\D/g, '').length === 11);
            const local = window.P3AtualizadorLocal && await P3AtualizadorLocal.disponivel().catch(() => false);
            if (faltam.length && local && confirm(`O XERIFE vai consultar CAD, BNMP e Tribunais de ${faltam.length} alvo(s) ainda não consultado(s) para analisar tudo. Continuar?\n(Cancelar = analisar só com os dados já carregados)`)) {
                for (let i = 0; i < faltam.length; i++) { botao.textContent = `🧠 Consultando ${i + 1}/${faltam.length} — ${faltam[i].ficha.dados.nome.split(' ')[0]}…`; await consultarIntegrada(faltam[i]); }
            }
            botao.textContent = '🧠 Analisando…';
            // 2) Texto-base (identificação, endereço, informes, antecedentes, situação judicial, vínculos)
            gerarTexto();
            const corpo = $('ri-corpo');
            // 3) Análise por alvo, logo após os parágrafos do alvo
            const analises = [];
            prontos.forEach((a, i) => {
                const f = a.ficha, NOME = up(f.dados.nome), vg = vulgo(f);
                const ref = vg ? `<b>“${esc(up(vg))}”</b>` : `<b>${esc(NOME)}</b>`;
                const rot = n => `${String(i + 1).padStart(2, '0')} ${vg ? up(vg) : NOME.split(' ')[0]} — ${n}`;
                const r = XerifeAnalista.paragrafosAnalise(a, ref, `alvo${i}`, rot);
                analises.push({ R: r.R, ref });
                const ult = [...corpo.querySelectorAll(`p[data-bloco^="alvo${i}-"]`)].pop();
                const html = r.paragrafos.map(x => P(x.bloco, x.rotulo, x.html)).join('');
                if (ult) ult.insertAdjacentHTML('afterend', html); else corpo.insertAdjacentHTML('beforeend', html);
            });
            // 4) Conclusão analítica, propostas e avaliação do conhecimento
            const orcrim = !!E.grupo || prontos.length > 1 && prontos.some(a => (a.ficha.grupos || []).length);
            const S = XerifeAnalista.sintese(analises, { orcrim });
            const concl = corpo.querySelector('p[data-bloco="concl"]');
            if (concl) concl.innerHTML = S.conclusao;
            const fecho = corpo.querySelector('p[data-bloco="fecho"]');
            const extra = (S.propostas.length ? P('propostas', 'Propostas de ação', `Propõe-se: ${S.propostas.map((p, j) => `${String.fromCharCode(97 + j)}) ${esc(p)}`).join('; ')}.`) : '')
                + (S.lacunas.length ? P('lacunas', 'Lacunas de inteligência', `Permanecem as seguintes lacunas a serem supridas em novos levantamentos: ${S.lacunas.map(esc).join(' | ')}.`) : '')
                + P('avaliacao', 'Avaliação do conhecimento', S.avaliacao);
            if (fecho) fecho.insertAdjacentHTML('beforebegin', extra); else corpo.insertAdjacentHTML('beforeend', extra);
            // 5) Refino opcional da redação pela IA local
            const X = await garantirXerife();
            if (X && X.obterEstadoIA && X.obterEstadoIA() === 'pronto' && confirm('Análise concluída. Refinar também a redação dos informes com a IA local do XERIFE (sem acrescentar dados)?')) await refinarComXerife($('ri-xerife'));
            else alert(`🧠 XERIFE: relatório redigido com a análise de ${prontos.length} alvo(s) — risco global ${S.maior}. Revise o texto antes de imprimir.`);
        } catch (e) { console.error('[relint xerife]', e); alert('Não foi possível concluir a análise: ' + e.message); }
        botao.disabled = false; botao.textContent = txt;
    }

    // ── CLAUDE (API da Anthropic, via atualizador local): análise completa e
    // redação do RELINT a partir de TODOS os dados reunidos + análise do XERIFE.
    // A chave da API fica só no computador (tools/atualizador-local/relint_claude.py).
    async function postApi(caminho, corpo) {
        const r = await fetch(API + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
        let j = null; try { j = await r.json(); } catch (e) { /* corpo vazio */ }
        if (j && j.autorizado === false) throw new Error('acesso restrito à P2/ADMIN (login no Sistema P3 exe)');
        if (!j) throw new Error('HTTP ' + r.status);
        return j;
    }
    async function configurarChaveClaude() {
        let st = null; try { st = await api('/claude/status'); } catch (e) { alert('Atualizador local indisponível — abra o Sistema P3 (exe).'); return; }
        const k = prompt(`Chave da API do Claude (Anthropic)${st && st.configurado ? ` — atual: ${st.final} (${st.origem})` : ' — não configurada'}.\nCole a nova chave (sk-ant-…) ou deixe em branco para remover. Ela fica salva apenas neste computador.`, '');
        if (k === null) return;
        try { const r = await postApi('/claude/configurar', { apiKey: k.trim() }); alert(r.configurado ? `✅ Chave salva (${r.final}). Modelo: ${r.modelo}.` : 'Chave removida.'); }
        catch (e) { alert('Não foi possível salvar: ' + e.message); }
    }
    const semFotos = f => { const c = Object.assign({}, f); delete c.fotos; return c; };
    async function gerarComClaude(botao) {
        const prontos = E.alvos.filter(a => a.ficha);
        if (!prontos.length) { alert('Adicione ao menos um alvo.'); return; }
        let st = null;
        try { st = await api('/claude/status'); } catch (e) { alert('Atualizador local indisponível — abra o Sistema P3 (exe) com login P2/ADMIN.'); return; }
        if (!st || !st.configurado) { if (confirm('A chave da API do Claude ainda não foi configurada neste computador. Configurar agora?')) await configurarChaveClaude(); return; }
        const faltam = prontos.filter(a => !a.consulta && String(a.ficha.dados.cpf || '').replace(/\D/g, '').length === 11);
        if (faltam.length && confirm(`Consultar antes CAD, BNMP e Tribunais de ${faltam.length} alvo(s) ainda não consultado(s)? (recomendado — o Claude analisa tudo o que estiver reunido)`)) {
            for (let i = 0; i < faltam.length; i++) { botao.textContent = `⏳ Consultando ${i + 1}/${faltam.length}…`; await consultarIntegrada(faltam[i]); }
        }
        const instrucoes = prompt('Orientações adicionais ao Claude (opcional) — ex.: "foco no tráfico no bairro X", "destacar a liderança":', '') || '';
        const txt = botao.textContent; botao.disabled = true; botao.textContent = '🤖 Claude analisando… (pode levar 1–3 min)';
        try {
            const alvos = prontos.map(a => {
                let x = null;
                if (window.XerifeAnalista) { const R = XerifeAnalista.analisarAlvo(a); x = { risco: R.nivel, pontos: R.pontos, fatores: R.fatores.map(f => f.txt), perfil: R.perfil.map(p => `${p.cat.nome} (${p.n})`), escalada: R.escalada, primeiroRegistro: R.primeiro, ultimoRegistro: R.ultimo, ultimos12meses: R.ultimos12, propostas: R.propostas, lacunas: R.lacunas }; }
                return { ficha: semFotos(a.ficha), consulta: a.consulta || null, funcao: a.funcao || null, analiseXerife: x };
            });
            const r = await postApi('/relint/claude', { alvos, grupo: E.grupo ? { nome: val($('ri-grupo-nome').value) || E.grupo.nome, tipo: E.grupo.tipo } : null, cabecalho: lerCab(), instrucoes });
            if (!r.ok) throw new Error(r.erro || 'falha na análise');
            const corpo = $('ri-corpo');
            corpo.innerHTML = (r.paragrafos || []).map(p => {
                const html = esc(p.texto).replace(/\n+/g, '<br>');
                return p.alerta ? `<p data-bloco="${esc(p.bloco)}" data-rotulo="${esc(p.rotulo)}" title="${esc(p.alerta)}" style="background:#fff3cd;">${html}</p>` : P(p.bloco, p.rotulo, html);
            }).join('');
            const assunto = document.querySelector('[data-cab="assunto"]');
            if (assunto && !val(assunto.value) && r.assunto) assunto.value = r.assunto;
            const alertas = (r.paragrafos || []).filter(p => p.alerta).length;
            alert(`🤖 Relatório redigido pelo Claude (${r.modelo}) — risco global ${r.risco_global}.${alertas ? `\n⚠️ ${alertas} parágrafo(s) destacado(s) em amarelo para conferência (número não encontrado nos dados).` : ''}${r.observacoes_ao_analista ? '\n\nObservações ao analista: ' + r.observacoes_ao_analista : ''}\n\nRevise o texto antes de imprimir.`);
        } catch (e) { alert('Claude: ' + e.message); }
        botao.disabled = false; botao.textContent = txt;
    }

    // ── XERIFE: refino da redação (IA local), sem acrescentar fatos ──
    function garantirXerife() {
        if (window.Xerife) return Promise.resolve(window.Xerife);
        return new Promise(ok => {
            if (!document.querySelector('script[data-relint-xerife]')) {
                const s = document.createElement('script'); s.src = '../js/xerife.js'; s.dataset.relintXerife = '1'; document.body.appendChild(s);
            }
            let n = 0; const t = setInterval(() => { if (window.Xerife || ++n > 50) { clearInterval(t); ok(window.Xerife || null); } }, 200);
        });
    }
    const PROMPT_XERIFE = 'Você é analista de inteligência da Polícia Militar de Alagoas e redige Relatórios de Inteligência (RELINT) conforme a Doutrina Nacional de Inteligência de Segurança Pública (DNISP). ' +
        'Reescreva o parágrafo recebido em português formal, impessoal, em 3ª pessoa, claro e conciso, sem adjetivação desnecessária. ' +
        'Use o futuro do pretérito (seria, atuaria, utilizaria, manteria) para informações oriundas de informes não confirmados. Não identifique fontes. ' +
        'É PROIBIDO acrescentar qualquer fato, nome, número, data, local ou conclusão que não esteja no parágrafo original. Mantenha nomes, vulgos e siglas em MAIÚSCULAS. ' +
        'Responda somente com o parágrafo reescrito, sem comentários.';
    const numerosDe = s => (String(s).match(/\d+/g) || []);
    const maiusculasDe = s => (String(s).match(/\b[A-ZÀ-Þ]{3,}\b/g) || []).map(semAcento);
    async function refinarComXerife(botao) {
        const ps = [...$('ri-corpo').querySelectorAll('p[data-ia="1"]')];
        if (!ps.length) { alert('Gere o texto primeiro — o XERIFE refina os parágrafos de informes, vínculos e denúncias.'); return; }
        const X = await garantirXerife();
        const estado = X && X.obterEstadoIA ? X.obterEstadoIA() : 'indisponivel';
        if (!X || !X.gerarComIA || estado !== 'pronto') {
            alert('A IA local do XERIFE não está pronta (' + ({ baixando: 'ainda carregando o modelo — tente em alguns minutos', indisponivel: 'computador sem suporte a IA local (WebGPU)', erro: 'erro ao carregar' }[estado] || estado) + '). O texto atual já segue a redação padrão.');
            return;
        }
        const txt = botao.textContent; botao.disabled = true;
        let ok = 0, rej = 0;
        for (let i = 0; i < ps.length; i++) {
            botao.textContent = `🤠 XERIFE ${i + 1}/${ps.length}…`;
            const original = ps[i].textContent;
            const novo = await X.gerarComIA([{ role: 'system', content: PROMPT_XERIFE }, { role: 'user', content: original }], { temperature: 0.2, max_tokens: 500 });
            const n = val(novo);
            // Trava: nenhum número ou termo em maiúsculas que não exista no original.
            const nums = new Set(numerosDe(original)), mais = new Set(maiusculasDe(original));
            const inventou = numerosDe(n).some(x => !nums.has(x)) || maiusculasDe(n).some(x => !mais.has(x));
            if (n && !inventou && n.length > original.length * 0.5) { ps[i].textContent = n.replace(/^["“]|["”]$/g, ''); ok++; } else rej++;
        }
        botao.disabled = false; botao.textContent = txt;
        alert(`XERIFE: ${ok} parágrafo(s) refinado(s)${rej ? `, ${rej} mantido(s) na redação padrão (a IA acrescentaria dados que não constam das fichas)` : ''}.`);
    }

    // ── IMPRESSÃO — modelo oficial ──────────────────────────────────
    function qrDataUrl(texto) {
        if (!texto || !window.QRCode) return '';
        const div = document.createElement('div');
        try { new QRCode(div, { text: texto, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { return ''; }
        const c = div.querySelector('canvas');
        return c ? c.toDataURL('image/png') : ((div.querySelector('img') || {}).src || '');
    }
    // B(): marca um bloco removível na prévia (caixa de seleção).
    const B = (chave, rotulo) => `data-bloco="${chave}" data-rotulo="${esc(rotulo)}"`;
    function montarDocumento() {
        const c = cfg(), cab = lerCab(), base = new URL('../', location.href).href;
        const prontos = E.alvos.filter(a => a.ficha);
        const selo = c.selo === 'nenhum' ? '' : c.selo === 'unidade' && CFG_UNIDADE && CFG_UNIDADE.logoUrl ? new URL(CFG_UNIDADE.logoUrl, location.href).href : base + 'img/relint/selo-dint.png';
        const linhasCab = c.cabecalho.split('\n').map(l => l.trim()).filter(Boolean);
        const aviso = 'Conhecimento para assessoramento do processo decisório, não tendo finalidade probatória. Conforme previsto na DNISP, este documento e seus anexos não devem ser inseridos em procedimentos e/ou processos de qualquer natureza.';
        const sigilo = 'O sigilo deste documento é protegido e controlado pela Lei n.º 12.527/11. A divulgação, o fornecimento, a utilização ou a reprodução desautorizada do seu conteúdo, a qualquer tempo ou por qualquer meio ou modo, inclusive mediante acesso ou facilitação de acesso indevidos, constituem condutas ilícitas que ensejam responsabilidades penais, civis e administrativas.';
        const fotoDe = (a, id) => (a.ficha.fotos || []).find(x => x.id === id);
        const anexo = prontos.map((a, i) => {
            const f = a.ficha, d = f.dados, fp = a.sel.fotoExt ? { url: a.sel.fotoExt } : fotoDe(a, a.sel.foto), end = enderecoSel(a), im = fotoDe(a, a.sel.imovel);
            const n = String(i + 1).padStart(2, '0'), quem = `${n} ${vulgo(f) ? up(vulgo(f)) : up(d.nome).split(' ')[0]}`;
            const regs = registrosSel(a), cad = ocorrenciasAutor(a), pa = processosAtivos(a), cons = a.consulta;
            const mandEx = (f.mandados || []).filter(m => !/cumprid|baixad|revogad/i.test(m.status || ''));
            const linkEnd = end ? (end.link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end.texto)}`) : '';
            const refEnd = end ? unicos([end.pontoReferencia, ...(end.referencias || []), end.descricao].map(x => textoLimpo(x))).join('. ').toUpperCase() : '';
            const info = textoLimpo(a.sel.info);
            return `<table class="qual" ${B('anx' + i, `Anexo A — ${quem}`)}>
                <tr><td class="qual-foto"><img src="${esc(fp ? fp.url : base + 'img/relint/sem-foto.jpg')}" alt=""><div class="qual-n">Nº ${n}</div></td>
                    <td class="qual-dados">
                        <div>Nome: ${esc(up(d.nome))}</div>${vulgos(f) ? `<div>Vulgo: “${esc(up(vulgos(f)))}”</div>` : ''}
                        ${d.mae ? `<div>Mãe: ${esc(up(d.mae))}</div>` : ''}${d.pai ? `<div>Pai: ${esc(up(d.pai))}</div>` : ''}
                        ${d.cpf ? `<div>CPF: ${esc(cpfFmt(d.cpf))}</div>` : ''}${d.rg ? `<div>RG: ${esc([d.rg, d.rgOrgao].filter(Boolean).join(' '))}</div>` : ''}
                        ${d.nascimento ? `<div>D. N.: ${esc(dataBR(d.nascimento))}</div>` : ''}${val(a.funcao) ? `<div>Função: ${esc(up(a.funcao))}</div>` : ''}</td></tr>
                <tr ${B(`anx${i}-info`, `${quem} — Informações`)}><th>Informações:</th><td>${esc(info ? normalizarCaixa(info) : 'X-X-X-X')}</td></tr>
                <tr ${B(`anx${i}-fc`, `${quem} — Ficha criminal`)}><th>Ficha criminal:</th><td>${regs.length ? regs.map(r => `${esc(r.tipo || 'B.O')} Nº ${esc(r.numero || '—')} – ${esc(up(r.crimes))};`).join('<br>') : 'NADA CONSTA NAS BASES DA AGÊNCIA.'}</td></tr>
                ${cons ? `<tr ${B(`anx${i}-cad`, `${quem} — Ocorrências (CAD)`)}><th>Ocorrências (CAD/SISP):</th><td>${cad.length ? cad.slice(0, 25).map(o => `${o.numero ? 'Nº ' + esc(o.numero) + ' – ' : ''}${esc(up(o.natureza))}${o.data ? ' (' + esc(o.data.slice(0, 10)) + ')' : ''}${o.envolvimento ? ' – ' + esc(up(o.envolvimento)) : ''};`).join('<br>') : 'NADA CONSTA COMO AUTOR/SUSPEITO.'}</td></tr>` : ''}
                ${cons || mandEx.length ? `<tr ${B(`anx${i}-mand`, `${quem} — Mandados`)}><th>Mandados:</th><td>${[cons ? (cons.bnmp.possui ? 'BNMP: MANDADO DE PRISÃO EM ABERTO' + (cons.bnmp.detalhe ? ' – ' + esc(Object.entries(cons.bnmp.detalhe).slice(0, 4).map(([k, v]) => `${k}: ${v}`).join('; ').toUpperCase()) : '') : 'BNMP: NADA CONSTA') : '', ...mandEx.map(m => `${esc(up(m.tipo) || 'MANDADO')}${m.numero ? ' Nº ' + esc(m.numero) : ''}${m.processo ? ' – PROC. ' + esc(m.processo) : ''}${m.status ? ' – ' + esc(up(m.status)) : ''}`)].filter(Boolean).join(';<br>')}.</td></tr>` : ''}
                ${cons ? `<tr ${B(`anx${i}-proc`, `${quem} — Processos ativos`)}><th>Processos ativos:</th><td>${pa.length ? pa.slice(0, 15).map(p => `${esc(p.tribunal)} Nº ${esc(p.numero)}${p.classe || p.assunto ? ' – ' + esc(up([p.classe, p.assunto].filter(Boolean).join(' / '))) : ''};`).join('<br>') : 'NADA CONSTA.'}</td></tr>` : ''}
                <tr ${B(`anx${i}-end`, `${quem} — Endereço`)}><th>Endereço:</th><td>${end ? esc(enderecoTexto(end)) + (refEnd ? '.<br>' + esc(refEnd) + '.' : '') : 'X-X-X-X'}</td></tr>
                <tr ${B(`anx${i}-qr`, `${quem} — QR Code e foto do imóvel`)}><td class="qual-qr">${linkEnd ? `<div class="qr-tit">QRCODE:</div><img src="${qrDataUrl(linkEnd)}" alt="">` : ''}</td>
                    <td class="qual-imovel">${im ? `<img src="${esc(im.url)}" alt="">` : '<div class="sem-img">Sem foto do imóvel</div>'}</td></tr>
            </table>`;
        }).join('<div class="quebra"></div>');
        const registro = prontos.flatMap(a => [...a.sel.registro].map(id => ({ a, x: fotoDe(a, id) })).filter(r => r.x)
            .concat((a.sel.registroExt || []).map(u => ({ a, x: { url: u, legenda: '', tipo: 'pessoa' } }))));
        const regHtml = registro.length ? `<div ${B('reg', 'Registro fotográfico')}><div class="quebra"></div><div class="tit-centro">REGISTRO FOTOGRÁFICO</div>` + registro.map(({ a, x }, j) =>
            `<table class="reg" ${B('reg' + j, `Foto ${j + 1} — ${up(vulgo(a.ficha) || a.ficha.dados.nome.split(' ')[0])}`)}><tr><td><img src="${esc(x.url)}" alt=""><div class="reg-leg">${esc(normalizarCaixa(textoLimpo(x.legenda)) || `${vulgo(a.ficha) ? '“' + up(vulgo(a.ficha)) + '”' : up(a.ficha.dados.nome)} — registro fotográfico ${x.tipo === 'residencia' ? 'do imóvel' : x.tipo === 'veiculo' ? 'do veículo' : 'do indivíduo'}.`)}</div></td></tr></table>`).join('') + '</div>' : '';
        const hist = prontos.map((a, i) => {
            const regs = registrosSel(a);
            if (!regs.length) return '';
            return `<div ${B('hist' + i, `Histórico criminal — ${up(vulgo(a.ficha) || a.ficha.dados.nome.split(' ')[0])}`)}><div class="quebra"></div><div class="tit-centro">HISTÓRICO CRIMINAL — ${esc(up(a.ficha.dados.nome))}${vulgo(a.ficha) ? ' (“' + esc(up(vulgo(a.ficha))) + '”)' : ''}</div>` +
                regs.map(r => `<div class="hist-tit">${esc(up(r.crimes) || 'REGISTRO POLICIAL')}</div><table class="hist"><tr><td><b>Tipo do procedimento:</b> ${esc(r.tipo || 'BO')}</td><td><b>Número:</b> ${esc(r.numero || '—')}</td></tr><tr><td><b>Data do fato:</b> ${esc(dataBR(r.dataFato) || '—')}</td><td><b>Envolvimento:</b> ${esc(up(r.papel) || '—')}</td></tr></table>`).join('') + '</div>';
        }).join('');
        const campos = [['DATA', cab.data], ['ASSUNTO', cab.assunto], ['ORIGEM', cab.origem], ['DIFUSÃO', cab.difusao], ['DIFUSÃO ANTERIOR', cab.difusaoAnterior], ['REFERÊNCIA', cab.referencia], ['OPERAÇÃO', cab.operacao], ['ANEXO', cab.anexo]]
            .filter(([, v]) => val(v)).map(([k, v]) => `<div class="campo" ${B('cab-' + k, 'Campo ' + k)}><b>${k}:</b> ${esc(v)}</div>`).join('');
        const assinatura = val(c.assinatura) ? `<div class="assinatura" ${B('ass', 'Assinatura / fecho')}>${c.assinatura.split('\n').map(l => esc(l)).join('<br>')}</div>` : '';
        return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><base href="${base}page/"><title>RELINT ${esc(cab.numero)}</title><style>
            @page { size: A4; margin: 8mm 16mm 8mm 16mm; @top-right-corner { content: counter(page) "/" counter(pages); font: bold 10pt "Times New Roman", serif; vertical-align: bottom; text-align: left; padding: 0 0 0 2mm; } }
            * { box-sizing: border-box; }
            body { margin: 0; font: 12pt/1.5 Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .oculto { display: none !important; }
            [contenteditable="true"]:focus { outline: none; }
            .pg { width: 100%; border-collapse: collapse; } .pg > thead td, .pg > tfoot td { padding: 0; } .pg > tbody > tr > td { padding: 0 6mm; }
            .topo { position: relative; padding-bottom: 4mm; } .topo.com-selo { min-height: 44mm; }
            .aviso { border: 1px solid #e00; color: #e00; font-size: 8.5pt; line-height: 1.25; text-align: center; padding: 2px 6px; }
            .restrito { width: 47mm; margin: 2mm auto 0; border: 1.2px solid #e00; color: #e00; font: bold 10.5pt Arial; text-align: center; padding: 1px 0; }
            .selo { position: absolute; right: 0; top: 19mm; width: 22mm; height: 22mm; object-fit: contain; }
            .rodape { padding-top: 3mm; } .rodape .aviso { text-align: justify; }
            .marca { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-55deg); font: bold 92pt Arial; color: rgba(0,0,0,.055); white-space: nowrap; z-index: -1; letter-spacing: .08em; pointer-events: none; }
            .inst { display: grid; grid-template-columns: 26mm 1fr 26mm; align-items: center; margin: 2mm 0 6mm; } .com-selo-doc .inst { margin-top: -25mm; }
            .inst img { width: 22mm; height: 22mm; object-fit: contain; }
            .inst div { text-align: center; font: bold 10.5pt/1.35 Arial; }
            h1 { font: bold 12pt Arial; text-align: center; margin: 4mm 0 5mm; }
            .campo { margin: 0; line-height: 1.55; } .campos { border-bottom: 1.5px solid #000; padding-bottom: 3mm; margin-bottom: 5mm; }
            .corpo p { text-align: justify; text-indent: 1.25cm; margin: 0 0 1.5mm; }
            .separa { text-align: center; font-weight: bold; margin: 5mm 0 2mm; letter-spacing: .04em; }
            .assinatura { text-align: center; margin-top: 14mm; font-weight: bold; }
            .quebra { break-after: page; height: 0; }
            .tit-centro { text-align: center; font-weight: bold; margin: 2mm 0 3mm; }
            table.qual { width: 100%; border-collapse: collapse; font-size: 9.5pt; line-height: 1.3; break-inside: avoid; margin-bottom: 4mm; }
            table.qual td, table.qual th { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
            table.qual th { width: 30%; text-align: center; vertical-align: middle; font-weight: bold; }
            .qual-foto { width: 30%; text-align: center; vertical-align: bottom !important; }
            .qual-foto img { width: 38mm; height: 46mm; object-fit: cover; display: block; margin: 4px auto 6px; }
            .qual-n { font-weight: bold; font-size: 10.5pt; }
            .qual-dados div { margin: 2px 0; } .qual-dados { vertical-align: middle !important; }
            .qual-qr { text-align: center; vertical-align: middle !important; } .qual-qr img { width: 36mm; height: 36mm; } .qr-tit { font-weight: bold; margin-bottom: 4px; }
            .qual-imovel { text-align: center; } .qual-imovel img { max-width: 100%; max-height: 80mm; object-fit: contain; display: block; margin: 0 auto; }
            .sem-img { color: #777; font-size: 9pt; padding: 20mm 0; }
            table.reg { width: 100%; border-collapse: collapse; margin-bottom: 4mm; break-inside: avoid; } table.reg td { border: 1px solid #000; text-align: center; padding: 4px; }
            table.reg img { max-width: 100%; max-height: 135mm; object-fit: contain; display: block; margin: 0 auto 3px; } .reg-leg { font-size: 10.5pt; line-height: 1.3; padding: 0 10mm 3px; }
            .hist-tit { text-align: center; font-weight: bold; font-size: 10.5pt; margin: 4mm 0 1.5mm; break-after: avoid; }
            table.hist { width: 100%; border-collapse: collapse; font-size: 9.5pt; break-inside: avoid; } table.hist td { border: 1px solid #777; padding: 4px 6px; width: 50%; }
            .ci-alvo { margin-bottom: 6mm; } .ci-nome { font-weight: bold; font-size: 10.5pt; border-bottom: 1.5px solid #000; padding-bottom: 1mm; margin-bottom: 2mm; }
            .ci-sec { margin-bottom: 3mm; font-size: 9pt; line-height: 1.3; } .ci-tit { font-weight: bold; font-size: 9.5pt; margin: 2mm 0 1mm; break-after: avoid; }
            table.ci { width: 100%; border-collapse: collapse; font-size: 8.5pt; } table.ci th, table.ci td { border: 1px solid #000; padding: 2px 4px; text-align: left; vertical-align: top; } table.ci th { background: #eee; }
            .ci-fotos { display: flex; gap: 4mm; flex-wrap: wrap; } .ci-fotos figure { margin: 0; text-align: center; font-size: 8pt; } .ci-fotos img { height: 40mm; max-width: 60mm; object-fit: contain; border: 1px solid #000; }
            .ci-det { border: 1px solid #777; padding: 2mm 3mm; margin-top: 2mm; font-size: 8.5pt; line-height: 1.3; break-inside: avoid; } .ci-det-tit { font-weight: bold; margin-bottom: 1mm; }
            @media screen { body { background: #6b7280; } .pg { background: #fff; max-width: 210mm; margin: 12px auto; box-shadow: 0 4px 18px rgba(0,0,0,.35); } }
        </style></head><body>
            <div class="marca">${esc(c.marca)}</div>
            <table class="pg${selo ? ' com-selo-doc' : ''}">
                <thead><tr><td><div class="topo${selo ? ' com-selo' : ''}"><div class="aviso">${aviso}</div><div class="restrito">ACESSO RESTRITO</div>${selo ? `<img class="selo" src="${esc(selo)}" alt="">` : ''}</div></td></tr></thead>
                <tfoot><tr><td><div class="rodape"><div class="aviso">${sigilo}</div><div class="restrito">ACESSO RESTRITO</div></div></td></tr></tfoot>
                <tbody><tr><td>
                    <div class="inst" ${B('inst', 'Cabeçalho institucional')}><img src="${base}img/relint/brasao-pmal.png" alt=""><div>${linhasCab.map(esc).join('<br>')}</div><span></span></div>
                    <h1 ${B('titulo', 'Título / número')}>RELATÓRIO DE INTELIGÊNCIA ${esc(cab.numero)}</h1>
                    <div class="campos">${campos}</div>
                    <div class="corpo">${$('ri-corpo').innerHTML}</div>
                    ${assinatura}
                    <div class="separa">X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X</div>
                    ${prontos.length ? `<div ${B('anexo', 'Anexo A (inteiro)')}><div class="quebra"></div><div class="tit-centro">ANEXO A – QUALIFICAÇÃO DOS ENVOLVIDOS</div>${anexo}</div>` : ''}
                    ${regHtml}${hist}${anexoConsulta(prontos)}
                </td></tr></tbody>
            </table>
        </body></html>`;
    }

    // ANEXO B — Consulta Integrada (CAD, PPE, Alcatraz, IDSEG/Quimera, endereços,
    // vínculos, BNMP, processos, linha do tempo) — cada seção é um bloco da prévia.
    const CAMPOS_DET = /Data\/Hora Abert|Tipo de Ocorr|Tipicidade|Natureza|Logradouro|^N[ºo°]:?$|Bairro|Cidade|Ambiente|Estabelecimento|Atendimento Inicial|Relato|Solu[cç][aã]o|Situa[cç][aã]o|Fechamento|Integrantes|Envolv/i;
    function anexoConsulta(prontos) {
        const comCons = prontos.map((a, i) => ({ a, i })).filter(x => x.a.consultaRaw && x.a.consulta);
        if (!comCons.length) return '';
        const T = (cols, linhas) => `<table class="ci"><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr>${linhas.length ? linhas.join('') : `<tr><td colspan="${cols.length}">Nada consta.</td></tr>`}</table>`;
        const corpo = comCons.map(({ a, i }) => {
            const r = a.consultaRaw, c = a.consulta, s = a.sel, n = String(i + 1).padStart(2, '0');
            const quem = `${n} ${vulgo(a.ficha) ? up(vulgo(a.ficha)) : up(a.ficha.dados.nome).split(' ')[0]}`;
            const tem = k => s.cb ? s.cb.has(k) : true;
            const bl = (k, tit, html) => tem(k) ? `<div class="ci-sec" ${B(`ci${i}-${k}`, `${quem} — ${tit}`)}><div class="ci-tit">${tit}</div>${html}</div>` : '';
            const fotos = fotosConsulta(r);
            const det = (tipo, chave, rotulo) => {
                const d = (a.detalhes || {})[tipo + ':' + chave];
                if (!d || !(s.detalhar || new Set()).has(tipo + ':' + chave)) return '';
                const campos = Object.entries(d.campos || {}).filter(([k, v]) => CAMPOS_DET.test(k) && val(v));
                return `<div class="ci-det" ${B(`ci${i}-det-${tipo}-${chave}`, `${quem} — detalhe ${rotulo}`)}><div class="ci-det-tit">DETALHE — ${esc(rotulo)}</div>${campos.map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(textoLimpo(v))}</div>`).join('')}
                    ${(d.envolvidos || []).length ? `<div style="margin-top:3px;"><b>Envolvidos:</b> ${d.envolvidos.map(e => esc([e.Nome || e.nome, e.Envolvimento || e.envolvimento, e['Situação'] || e.situacao].filter(Boolean).join(' – '))).join('; ')}</div>` : ''}</div>`;
            };
            const desp = r.ocorrenciasDespacho || [], ppe = r.ocorrenciasPpe || [], pc = r.ocorrenciasPcAntigo || [];
            return `<div class="ci-alvo" ${B(`ci${i}`, `Anexo B — ${quem}`)}><div class="ci-nome">Nº ${n} — ${esc(up(a.ficha.dados.nome))}${a.ficha.dados.cpf ? ' — CPF ' + esc(cpfFmt(a.ficha.dados.cpf)) : ''}</div>
                ${bl('fotos', 'FOTOS (ALCATRAZ / IDSEG-QUIMERA)', fotos.length ? `<div class="ci-fotos">${fotos.map(f => `<figure><img src="${esc(f.url)}" alt=""><figcaption>${esc(f.fonte)}</figcaption></figure>`).join('')}</div>` : '<div>Nenhuma foto encontrada.</div>')}
                ${bl('cad', 'OCORRÊNCIAS — CAD', T(['Nº', 'Data', 'Natureza', 'Envolvimento', 'Situação'], desp.map(o => `<tr><td>${esc(val(o.id_ocor_fk || o._id_ocor))}</td><td>${esc(val(o.dt_ocor))}</td><td>${esc(up(o.ds_ocor_sgrup))}</td><td>${esc(up(o.ds_oco_despc_tipo_envl))}</td><td>${esc(up(o.ds_ocor_despc_envl_pess_sitc))}</td></tr>`)) + desp.map(o => det('despacho', val(o._id_ocor || o.id_ocor_fk), `ocorrência nº ${val(o.id_ocor_fk || o._id_ocor)}`)).join(''))}
                ${bl('ppe', 'OCORRÊNCIAS POLICIAIS — PPE', T(['Data', 'Natureza', 'Envolvimento'], ppe.map(o => `<tr><td>${esc(val(o.dt_ocorrencia))}</td><td>${esc(up(o.no_natureza_ocorrencia))}</td><td>${esc(up(o.tipo_envolvimento))}</td></tr>`)) + ppe.map((o, k) => det('ppe', val(o._id) || String(k), `PPE ${val(o.dt_ocorrencia)}`)).join(''))}
                ${pc.length ? bl('pc', 'REGISTROS ANTERIORES', T(['Nº BO', 'Data'], pc.map(o => `<tr><td>${esc(val(o.attr_numero_bo))}</td><td>${esc(val(o.data_hora_registro))}</td></tr>`)) + pc.map(o => det('pc_antigo', val(o._env || o.attr_numero_bo), `BO ${val(o.attr_numero_bo)}`)).join('')) : ''}
                ${bl('end', 'ENDEREÇOS (IDENTIFICAÇÃO CIVIL / CNH)', T(['Endereço', 'Fonte', 'Data'], enderecosConsulta(r).map(e => `<tr><td>${esc(up(e.endereco))}</td><td>${esc(e.fonte)}</td><td>${esc(e.data || '—')}</td></tr>`)))}
                ${bl('vinc', 'VÍNCULOS', `${r.pessoa && (r.pessoa.mae || r.pessoa.pai) ? `<div>Filiação: ${esc(up([r.pessoa.mae, r.pessoa.pai].filter(Boolean).join(' e ')))}</div>` : ''}` + T(['Nome', 'Envolvimento', 'Ocorrência', 'Data'], (r.vinculosOcorrencia || []).map(v => `<tr><td>${esc(up(v.nome))}</td><td>${esc(up(v.tipoEnvolvimento))}</td><td>${esc(v.numeroOcorrencia)}</td><td>${esc(v.data)}</td></tr>`)))}
                ${bl('bnmp', 'BNMP — MANDADOS DE PRISÃO', c.bnmp.possui ? `<div><b>MANDADO EM ABERTO.</b></div>${c.bnmp.detalhe ? Object.entries(c.bnmp.detalhe).map(([k, v]) => `<div><b>${esc(k)}:</b> ${esc(v)}</div>`).join('') : ''}` : '<div>Nada consta.</div>')}
                ${bl('proc', 'PROCESSOS (TJAL / TJSP)', T(['Tribunal', 'Nº', 'Classe / assunto', 'Último andamento', 'Situação'], c.processos.map(x => `<tr><td>${esc(x.tribunal)}</td><td>${esc(x.numero)}</td><td>${esc(up([x.classe, x.assunto].filter(Boolean).join(' / ')))}</td><td>${esc(x.ultimo.slice(0, 160))}</td><td>${x.ativo ? 'EM TRAMITAÇÃO' : 'ENCERRADO'}</td></tr>`)))}
                ${bl('tempo', 'LINHA DO TEMPO', T(['Data', 'Evento', 'Fonte'], linhaTempo(r).map(t => `<tr><td>${esc(t.data || '—')}</td><td>${esc(up(t.texto))}${t.env ? ' (' + esc(up(t.env)) + ')' : ''}</td><td>${esc(t.fonte)}</td></tr>`)))}
            </div>`;
        }).join('');
        return `<div ${B('anexoB', 'Anexo B (inteiro)')}><div class="quebra"></div><div class="tit-centro">ANEXO B – CONSULTA INTEGRADA (CAD/SISP, PPE, ALCATRAZ, IDSEG/QUIMERA, BNMP E TRIBUNAIS)</div>${corpo}</div>`;
    }

    // ── PRÉVIA: documento editável + caixas de seleção por bloco ────
    // As ocultações ficam em E.ocultos (e no rascunho) — valem também para
    // "Imprimir RELINT" direto. Edições feitas na prévia valem para a
    // impressão feita a partir da prévia.
    function aplicarOcultos(doc) {
        doc.querySelectorAll('[data-bloco]').forEach(el => el.classList.toggle('oculto', E.ocultos.has(el.dataset.bloco)));
    }
    function montarPainelBlocos(doc) {
        const vistos = new Map();
        doc.querySelectorAll('[data-bloco]').forEach(el => { if (!vistos.has(el.dataset.bloco)) vistos.set(el.dataset.bloco, el.dataset.rotulo || el.dataset.bloco); });
        const grupos = { cab: [], corpo: [], anexo: [], outros: [] };
        vistos.forEach((rot, k) => (/^(cab-|inst|titulo|ass)/.test(k) ? grupos.cab : /^(intro|alvo|concl|fecho)/.test(k) ? grupos.corpo : /^anx|^anexo$/.test(k) ? grupos.anexo : /^ci|^anexoB/.test(k) ? (grupos.ci = grupos.ci || []) : grupos.outros).push([k, rot]));
        const sec = (t, l) => l.length ? `<div class="ri-blocos-sec">${t}</div>` + l.map(([k, r]) => `<label><input type="checkbox" data-bl="${esc(k)}" ${E.ocultos.has(k) ? '' : 'checked'}> ${esc(r)}</label>`).join('') : '';
        $('ri-blocos').innerHTML = sec('Cabeçalho', grupos.cab) + sec('Texto do relatório', grupos.corpo) + sec('Anexo A', grupos.anexo) + sec('Fotos e histórico', grupos.outros) + sec('Anexo B — Consulta Integrada', grupos.ci || []);
        $('ri-blocos').querySelectorAll('[data-bl]').forEach(cb => cb.onchange = () => { cb.checked ? E.ocultos.delete(cb.dataset.bl) : E.ocultos.add(cb.dataset.bl); aplicarOcultos(doc); });
    }
    function prepararDoc(fr) {
        const doc = fr.contentDocument;
        aplicarOcultos(doc);
        doc.querySelector('.pg > tbody > tr > td').setAttribute('contenteditable', 'true');
        return doc;
    }
    function aguardarImagens(doc) {
        return Promise.all([...doc.images].map(img => img.complete ? null : new Promise(ok => { img.onload = img.onerror = ok; setTimeout(ok, 8000); })));
    }
    async function previa() {
        if (!E.alvos.some(a => a.ficha)) { alert('Adicione ao menos um alvo.'); return; }
        const fr = $('ri-previa');
        await new Promise(ok => { fr.onload = ok; fr.srcdoc = montarDocumento(); });
        montarPainelBlocos(prepararDoc(fr));
        $('ri-modal-previa').classList.add('aberto');
    }
    async function imprimir(usarPrevia) {
        if (!E.alvos.some(a => a.ficha)) { alert('Adicione ao menos um alvo.'); return; }
        let fr = usarPrevia ? $('ri-previa') : null;
        if (!fr) {
            fr = document.getElementById('ri-print-frame') || Object.assign(document.createElement('iframe'), { id: 'ri-print-frame' });
            Object.assign(fr.style, { position: 'fixed', right: '0', bottom: '0', width: '1px', height: '1px', border: '0', opacity: '0' });
            if (!fr.parentNode) document.body.appendChild(fr);
            await new Promise(ok => { fr.onload = ok; fr.srcdoc = montarDocumento(); });
            aplicarOcultos(fr.contentDocument);
        }
        await aguardarImagens(fr.contentDocument);
        fr.contentWindow.focus(); fr.contentWindow.print();
    }

    // ── rascunho (só neste navegador) ───────────────────────────────
    function salvarRascunho() {
        const salvoEm = new Date().toISOString();
        lsSet(LS_RASCUNHO, { cab: lerCab(), corpo: $('ri-corpo').innerHTML, grupo: E.grupo ? { nome: $('ri-grupo-nome').value, tipo: E.grupo.tipo } : null,
            alvos: E.alvos.filter(a => a.ficha).map(a => ({ id: a.id, funcao: a.funcao, consulta: a.consulta || null, detalhes: a.detalhes || null,
                consultaRaw: a.consultaRaw ? Object.assign({}, a.consultaRaw, { webmii: undefined, inteligencia: undefined }) : null,
                sel: Object.assign({}, a.sel, { registro: [...a.sel.registro], fc: [...a.sel.fc], informes: [...(a.sel.informes || [])], cb: a.sel.cb ? [...a.sel.cb] : null, detalhar: a.sel.detalhar ? [...a.sel.detalhar] : null }) })),
            ocultos: [...E.ocultos], salvoEm });
        if (lsGet(LS_RASCUNHO, {}).salvoEm !== salvoEm) { /* sem espaço: guarda sem as fotos da consulta */
            const r0 = { cab: lerCab(), corpo: $('ri-corpo').innerHTML, ocultos: [...E.ocultos], salvoEm: new Date().toISOString(), semFotos: true,
                alvos: E.alvos.filter(a => a.ficha).map(a => ({ id: a.id, funcao: a.funcao, consulta: a.consulta || null, consultaRaw: a.consultaRaw ? Object.assign({}, a.consultaRaw, { fotos: [], webmii: undefined, inteligencia: undefined }) : null,
                    sel: Object.assign({}, a.sel, { registro: [...a.sel.registro], fc: [...a.sel.fc], informes: [...(a.sel.informes || [])], cb: a.sel.cb ? [...a.sel.cb] : null, detalhar: a.sel.detalhar ? [...a.sel.detalhar] : null, fotoExt: null, registroExt: [] }) })) };
            lsSet(LS_RASCUNHO, r0);
        }
        const b = $('ri-salvar'); b.textContent = '✅ Rascunho salvo'; setTimeout(() => { b.textContent = '💾 Salvar rascunho'; }, 2000);
    }
    async function restaurar() {
        const r = lsGet(LS_RASCUNHO, null);
        escreverCab(Object.assign(cabPadrao(), r ? r.cab : {}));
        if (!r) return;
        if (r.corpo) $('ri-corpo').innerHTML = r.corpo;
        if (r.grupo) { E.grupo = { nome: r.grupo.nome, tipo: r.grupo.tipo }; $('ri-grupo-nome').value = r.grupo.nome || ''; }
        E.ocultos = new Set(r.ocultos || []);
        for (const a of r.alvos || []) await adicionarAlvo(a.id, { funcao: a.funcao, sel: a.sel, consulta: a.consulta, consultaRaw: a.consultaRaw, detalhes: a.detalhes });
    }
    function novo() {
        if (!confirm('Começar um novo relatório? O rascunho atual será apagado.')) return;
        try { localStorage.removeItem(LS_RASCUNHO); } catch (e) { /* opcional */ }
        E.alvos = []; E.grupo = null; E.ativo = 0; E.ocultos = new Set();
        escreverCab(cabPadrao()); $('ri-corpo').innerHTML = '<p>Adicione os alvos e clique em “Gerar texto a partir das fichas”.</p>';
        renderAlvos(); renderFicha();
    }

    // ── inicialização (acesso: P2 / ADMIN) ──────────────────────────
    document.addEventListener('DOMContentLoaded', async () => {
        const sessao = P3.requireAuth();
        if (!sessao) return;
        if (sessao.nivel !== 'p2' && sessao.nivel !== 'admin') {
            alert('O Relatório de Inteligência está disponível apenas para usuários com nível P2 ou ADMIN.');
            location.href = 'solucoesia.html';
            return;
        }
        try { CFG_UNIDADE = await P3.loadUnidadeConfig(); } catch (e) { CFG_UNIDADE = null; }
        const c = cfg();
        document.querySelectorAll('[data-cfg]').forEach(i => { i.value = c[i.dataset.cfg] || ''; i.addEventListener('change', () => { const atual = lsGet(LS_CFG, {}); atual[i.dataset.cfg] = i.value; lsSet(LS_CFG, atual); }); });
        $('ri-buscar').onclick = buscar;
        $('ri-q').addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); });
        $('ri-grupo-limpar').onclick = () => { E.grupo = null; renderAlvos(); };
        $('ri-gerar').onclick = gerarTexto;
        $('ri-xerife').onclick = () => refinarComXerife($('ri-xerife'));
        $('ri-xerife-analise').onclick = () => gerarComXerife($('ri-xerife-analise'));
        $('ri-claude').onclick = () => gerarComClaude($('ri-claude'));
        $('ri-claude-chave').onclick = configurarChaveClaude;
        $('ri-consultar-todos').onclick = () => consultarTodos($('ri-consultar-todos'));
        $('ri-blocos-todos').onclick = () => { E.ocultos.clear(); const d = $('ri-previa').contentDocument; aplicarOcultos(d); montarPainelBlocos(d); };
        document.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => { $('ri-corpo').focus(); document.execCommand(b.dataset.cmd); });
        $('ri-salvar').onclick = salvarRascunho;
        $('ri-novo').onclick = novo;
        $('ri-previa-btn').onclick = previa;
        $('ri-imprimir').onclick = () => imprimir(false);
        $('ri-previa-imprimir').onclick = () => imprimir(true);
        document.querySelectorAll('[data-fechar]').forEach(b => b.onclick = () => $(b.dataset.fechar).classList.remove('aberto'));
        document.querySelectorAll('.ri-modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('aberto'); }));
        await carregarGrupos();
        restaurar();
    });
})();
