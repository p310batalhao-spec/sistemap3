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
            info: (f.informacoes || [])[0] ? val(f.informacoes[0].texto).slice(0, 600) : val(f.dados.observacoes) };
        if (salvo) Object.assign(s, salvo, { registro: new Set(salvo.registro || []), fc: new Set(salvo.fc || []) });
        return s;
    }
    async function adicionarAlvo(id, extras = {}) {
        if (E.alvos.some(a => String(a.id) === String(id))) return;
        const marcador = { id, ficha: null, funcao: extras.funcao || '', carregando: true, sel: null };
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
            const f = a.ficha, fp = (f.fotos || []).find(x => x.id === a.sel.foto) || fotoPrincipal(f);
            return `<div class="ri-alvo${i === E.ativo ? ' ativo' : ''}" data-i="${i}">
                <span class="ri-n">${String(i + 1).padStart(2, '0')}</span>
                <img src="${esc(fp ? fp.url : '../img/relint/sem-foto.jpg')}" alt="">
                <div><b>${esc(f.dados.nome)}</b><small>${vulgos(f) ? '“' + esc(vulgos(f)) + '” · ' : ''}${(f.fichaCriminal || []).length} registro(s) · ${(f.mandados || []).length} mandado(s) · ${(f.enderecos || []).length} endereço(s)</small></div>
                <input class="ri-in" data-funcao="${i}" placeholder="Função (ex.: líder, gerente, braço armado)" value="${esc(a.funcao)}">
                <div style="display:flex;gap:4px;">
                    <button class="ri-btn ri-btn-mini" data-ver="${i}">Ficha</button>
                    <button class="ri-btn ri-btn-mini" data-sobe="${i}" ${i ? '' : 'disabled'}>▲</button>
                    <button class="ri-btn ri-btn-mini" data-rem="${i}">✕</button></div></div>`;
        }).join('');
        el.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { E.ativo = +b.dataset.ver; renderAlvos(); renderFicha(); $('ri-ficha-painel').scrollIntoView({ behavior: 'smooth' }); });
        el.querySelectorAll('[data-rem]').forEach(b => b.onclick = () => { E.alvos.splice(+b.dataset.rem, 1); E.ativo = 0; if (!E.alvos.length) E.grupo = null; renderAlvos(); renderFicha(); });
        el.querySelectorAll('[data-sobe]').forEach(b => b.onclick = () => { const i = +b.dataset.sobe; [E.alvos[i - 1], E.alvos[i]] = [E.alvos[i], E.alvos[i - 1]]; E.ativo = i - 1; renderAlvos(); renderFicha(); });
        el.querySelectorAll('[data-funcao]').forEach(inp => inp.oninput = () => { E.alvos[+inp.dataset.funcao].funcao = inp.value; });
    }

    // ── FICHA ALVO ──────────────────────────────────────────────────
    const ABAS = [['dados', 'Dados'], ['veiculos', 'Veículos'], ['fotos', 'Fotos'], ['vinculos', 'Vínculos'], ['mandados', 'Mandados'],
        ['enderecos', 'Endereços'], ['informacoes', 'Informações'], ['denuncias', 'Denúncias'], ['fichaCriminal', 'Ficha criminal']];
    const contagem = (f, k) => k === 'dados' ? '' : String(((k === 'vinculos' ? (f.vinculos || []).concat(f.grupos || []) : f[k]) || []).length);
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
            <div class="ri-abas">${ABAS.map(([k, n]) => `<button class="ri-aba${E.aba === k ? ' ativa' : ''}" data-aba="${k}">${n}${contagem(f, k) !== '' ? `<em>${contagem(f, k)}</em>` : ''}</button>`).join('')}</div>
            <div id="ri-aba-corpo">${conteudoAba(f, s, E.aba)}</div>`;
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
        if (aba === 'informacoes') return (f.informacoes || []).length ? '<div class="ri-lista">' + f.informacoes.map((x, i) => `<div class="ri-item"><h4>ℹ ${esc(x.assunto || x.origem)} <span class="ri-meta">${esc(x.origem)} · ${esc(dataBR(x.dataHora))}${x.papel ? ' · ' + esc(x.papel) : ''}</span></h4>
            <div style="white-space:pre-wrap;">${esc(x.texto)}</div><div style="margin-top:6px;"><button class="ri-btn ri-btn-mini" data-usar-info="${i}">↳ usar no campo “Informações” do Anexo A</button></div></div>`).join('') + '</div>' : vazio('Nenhuma informação complementar.');
        if (aba === 'denuncias') return (f.denuncias || []).length ? '<div class="ri-lista">' + f.denuncias.map(d => `<div class="ri-item"><h4>📣 ${esc(d.tipo || 'Denúncia')} ${d.numero ? 'nº ' + esc(d.numero) : ''} <span class="ri-meta">${esc(dataBR(d.dataDenuncia))} ${esc(d.horaDenuncia || '')} · ${esc(d.cidade || '')} · ${esc(d.statusOperacional || '')}</span></h4>
            ${d.resumoBreve ? `<div><b>${esc(d.resumoBreve)}</b></div>` : ''}<div style="white-space:pre-wrap;">${esc(d.narrativa)}</div>
            ${d.arquivoUrl ? `<div class="ri-meta" style="margin-top:4px;">📎 <a href="${esc(d.arquivoUrl)}" target="_blank" rel="noopener" style="color:#9cc0ff;">${esc(d.arquivoNome || 'anexo')}</a></div>` : ''}</div>`).join('') + '</div>' : vazio('Nenhuma denúncia vinculada.');
        if (aba === 'fichaCriminal') return (f.fichaCriminal || []).length ? `<p class="ri-sub" style="margin:0 0 10px;">Marcados = entram no histórico criminal do texto e na “Ficha criminal” do Anexo A (padrão: registros como suspeito/autor).</p><div class="ri-lista">` + f.fichaCriminal.map((r, i) => `<div class="ri-item"><h4>${esc(up(r.crimes) || 'Registro')}
                <label><input type="checkbox" data-fc="${i}" ${s.fc.has(i) ? 'checked' : ''}> incluir</label></h4>
            <div class="ri-meta">${esc(r.tipo || 'BO')} nº ${esc(r.numero || '—')} · ${esc(dataBR(r.dataFato))} · papel: <b>${esc(r.papel || '—')}</b></div></div>`).join('') + '</div>' : vazio('Nenhum registro criminal.');
        return '';
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
        el.querySelectorAll('[data-fc]').forEach(c => c.onchange = () => { const i = +c.dataset.fc; c.checked ? s.fc.add(i) : s.fc.delete(i); renderAlvos(); });
        el.querySelectorAll('[data-usar-info]').forEach(b => b.onclick = () => { s.info = val(a.ficha.informacoes[+b.dataset.usarInfo].texto); b.textContent = '✔ usado no Anexo A'; });
        const ta = el.querySelector('[data-info]'); if (ta) ta.oninput = () => { s.info = ta.value; };
        el.querySelectorAll('[data-zoom]').forEach(img => img.onclick = () => { $('ri-zoom-img').src = img.dataset.zoom; $('ri-zoom-tit').textContent = img.dataset.leg || 'Foto'; $('ri-modal-zoom').classList.add('aberto'); });
    }

    // ── geração do texto (modelo) ───────────────────────────────────
    const registrosSel = a => (a.ficha.fichaCriminal || []).filter((r, i) => a.sel.fc.has(i));
    function historicoTexto(a) {
        const regs = registrosSel(a);
        if (!regs.length) return 'Não foram localizados registros criminais em seu desfavor nas bases consultadas.';
        const porCrime = new Map();
        regs.forEach(r => { const c = val(r.crimes).toLowerCase() || 'registro policial'; (porCrime.get(c) || porCrime.set(c, []).get(c)).push(`${r.tipo || 'B.O'} nº ${r.numero || 'XXXXXXXX'}`); });
        const itens = [...porCrime.entries()].map(([c, bos]) => `${c} (${bos.join(' e ')})`);
        return `Em relação ao seu histórico criminal, verificam-se registros por ${listaE(itens)}, circunstâncias que demonstram reiteração criminosa e vínculo com atividades ilícitas.`;
    }
    const enderecoSel = a => (a.ficha.enderecos || [])[a.sel.endereco] || (a.ficha.enderecos || [])[0] || null;
    function paragrafosAlvo(a, i, orcrim) {
        const f = a.ficha, nome = `<b>${esc(up(f.dados.nome))}</b>`, vg = vulgo(f), v = vg ? `, vulgo <b>“${esc(up(vg))}”</b>` : '';
        const ref = vg ? `<b>“${esc(up(vg))}”</b>` : nome;
        const funcao = val(a.funcao);
        const ps = [];
        if (orcrim) {
            const abre = i === 0 ? 'No curso dos levantamentos realizados, apurou-se que' : i === E.alvos.length - 1 && E.alvos.length > 2 ? 'Por fim, foi identificado o indivíduo' : 'Os levantamentos realizados indicam que';
            ps.push(i === E.alvos.length - 1 && E.alvos.length > 2
                ? `${abre} ${nome}${v}, que atuaria ${funcao ? 'como <b>' + esc(funcao.toLowerCase()) + '</b> da organização criminosa' : 'no contexto da organização criminosa'}.`
                : `${abre} ${nome}${v}, ${funcao ? 'seria <b>' + esc(funcao.toLowerCase()) + '</b> da organização criminosa' : 'integraria a organização criminosa'}${E.grupo && val($('ri-grupo-nome').value) ? ' denominada <b>' + esc(up($('ri-grupo-nome').value)) + '</b>' : ''}.`);
        } else {
            ps.push(`${i === 0 ? 'No curso dos levantamentos realizados, foi identificado' : 'Foi identificado, ainda,'} o indivíduo ${nome}${v}${funcao ? ', apontado como <b>' + esc(funcao.toLowerCase()) + '</b>' : ''}.`);
        }
        const end = enderecoSel(a);
        if (end) ps.push(`Por meio de levantamentos de inteligência, constatou-se que ${ref} reside no imóvel situado na <span style="color:#c00000">${esc(end.texto)}</span>${end.pontoReferencia || (end.referencias || []).length ? ', ' + esc([end.pontoReferencia, ...(end.referencias || [])].filter(Boolean).join(', ').toLowerCase()) : ''}.`);
        (a.ficha.informacoes || []).slice(0, 1).forEach(x => { if (val(x.texto)) ps.push(`Segundo informações de inteligência${x.assunto ? ' (' + esc(x.assunto.toLowerCase()) + ')' : ''}, ${esc(val(x.texto).replace(/^\w/, c => c.toLowerCase()))}`); });
        ps.push(historicoTexto(a));
        const abertos = (f.mandados || []).filter(m => !/cumprid|baixad|revogad/i.test(m.status || ''));
        if (abertos.length) ps.push(`Consta(m) em desfavor de ${ref} ${abertos.map(m => `mandado de ${esc(val(m.tipo).toLowerCase() || 'prisão')}${m.numero ? ' nº ' + esc(m.numero) : ''}${m.processo ? ' (processo nº ' + esc(m.processo) + (m.vara ? ', ' + esc(m.vara) : '') + ')' : ''}${m.status ? ', situação: ' + esc(m.status.toLowerCase()) : ''}`).join('; ')}.`);
        if ((f.veiculos || []).length) ps.push(`${ref} utilizaria ${f.veiculos.map(x => `o veículo ${esc(up(x.modelo))}${x.cor ? ', cor ' + esc(x.cor.toLowerCase()) : ''}${x.placa ? ', placa ' + esc(up(x.placa)) : ''}`).join('; ')}.`);
        const vinc = (f.vinculos || []).filter(x => val(x.nome)).slice(0, 4);
        if (vinc.length) ps.push(`Possui vínculo${vinc.length > 1 ? 's' : ''} ${listaE(vinc.map(x => `${esc((x.tipo || 'vínculo').toLowerCase())} com ${esc(up(x.nome))}${x.observacao ? ' (' + esc(x.observacao) + ')' : ''}`))}.`);
        if ((f.denuncias || []).length) ps.push(`Há ${f.denuncias.length} denúncia(s) registrada(s) envolvendo o alvo${f.denuncias.some(d => d.numero) ? ' (nº ' + f.denuncias.filter(d => d.numero).map(d => esc(d.numero)).join(', ') + ')' : ''}${f.denuncias[0].resumoBreve ? ', destacando-se: ' + esc(f.denuncias[0].resumoBreve.toLowerCase()) : ''}.`);
        return ps;
    }
    function crimesPredominantes() {
        const c = new Map();
        E.alvos.forEach(a => registrosSel(a).forEach(r => { const k = val(r.crimes).toLowerCase(); if (k) c.set(k, (c.get(k) || 0) + 1); }));
        return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
    }
    const cidadesAlvos = () => [...new Set(E.alvos.map(a => val((enderecoSel(a) || {}).cidade)).filter(Boolean))];
    function gerarTexto() {
        const prontos = E.alvos.filter(a => a.ficha);
        if (!prontos.length) { alert('Adicione ao menos um alvo.'); return; }
        const orcrim = !!E.grupo || prontos.length > 1 && prontos.some(a => (a.ficha.grupos || []).length);
        const crimes = crimesPredominantes(), cidades = cidadesAlvos();
        const local = cidades.length ? listaE(cidades.map(c => esc(c.toUpperCase()))) + '/AL' : 'CIDADE/AL';
        const nomeG = val($('ri-grupo-nome').value);
        const ps = [];
        if (orcrim) {
            ps.push(`Informações acerca de uma organização criminosa (ORCRIM)${nomeG ? ' denominada <b>' + esc(up(nomeG)) + '</b>' : ''} apontam indivíduos suspeitos de crimes de ${crimes.length ? esc(listaE(crimes)) : 'tráfico de drogas e posse/porte irregular de arma de fogo'} com atuação em ${local}.`);
            ps.push('A ORCRIM utilizaria de imóveis residenciais como pontos de apoio logístico para o armazenamento de substâncias entorpecentes, armas de fogo e outros materiais ilícitos, os quais seriam empregados para a manutenção, proteção e expansão das atividades criminosas, circunstância que evidencia risco concreto à ordem pública e à segurança da coletividade local.');
            ps.push('Após ações de inteligência e contatos com fontes humanas em colaboração, apurou-se que a organização criminosa apresentaria estrutura definida, com divisão de funções entre seus integrantes, garantindo, em tese, a continuidade das atividades ilícitas de forma coordenada e dificultando a atuação dos órgãos de segurança pública.');
        } else {
            ps.push(`Informações de inteligência apontam ${prontos.length > 1 ? 'indivíduos suspeitos' : 'indivíduo suspeito'} de crimes de ${crimes.length ? esc(listaE(crimes)) : 'natureza diversa'} com atuação em ${local}.`);
        }
        prontos.forEach((a, i) => paragrafosAlvo(a, i, orcrim).forEach(p => ps.push(p)));
        ps.push(orcrim
            ? 'Diante dos elementos colhidos por meio das ações de inteligência, verifica-se a existência de indícios consistentes da atuação de organização criminosa estruturada, com divisão de funções entre seus integrantes e utilização de imóveis residenciais como pontos de apoio logístico para armazenamento de drogas, armas de fogo e demais instrumentos utilizados na prática criminosa, evidenciando risco concreto à ordem pública e elevada probabilidade de continuidade delitiva.'
            : `Diante dos elementos colhidos por meio das ações de inteligência, verificam-se indícios consistentes da atuação criminosa ${prontos.length > 1 ? 'dos indivíduos' : 'do indivíduo'} acima qualificado${prontos.length > 1 ? 's' : ''}, evidenciando risco concreto à ordem pública e elevada probabilidade de continuidade delitiva.`);
        ps.push('Sendo assim, faz-se necessário o encaminhamento deste relatório para fins de subsídio à tomada de decisão.');
        $('ri-corpo').innerHTML = ps.map(p => `<p>${p}</p>`).join('');
        const assunto = document.querySelector('[data-cab="assunto"]');
        if (!val(assunto.value)) assunto.value = orcrim ? `ORGANIZAÇÃO CRIMINOSA ATUANTE EM ${cidades.length ? cidades.join(', ').toUpperCase() : 'CIDADE'}/AL.` : `${prontos.length > 1 ? 'INDIVÍDUOS SUSPEITOS' : 'INDIVÍDUO SUSPEITO'} DE ATUAÇÃO CRIMINOSA EM ${cidades.length ? cidades.join(', ').toUpperCase() : 'CIDADE'}/AL.`;
    }

    // ── IMPRESSÃO — modelo oficial ──────────────────────────────────
    function qrDataUrl(texto) {
        if (!texto || !window.QRCode) return '';
        const div = document.createElement('div');
        try { new QRCode(div, { text: texto, width: 160, height: 160, correctLevel: QRCode.CorrectLevel.M }); } catch (e) { return ''; }
        const c = div.querySelector('canvas');
        return c ? c.toDataURL('image/png') : ((div.querySelector('img') || {}).src || '');
    }
    function montarDocumento() {
        const c = cfg(), cab = lerCab(), base = new URL('../', location.href).href;
        const prontos = E.alvos.filter(a => a.ficha);
        const selo = c.selo === 'nenhum' ? '' : c.selo === 'unidade' && CFG_UNIDADE && CFG_UNIDADE.logoUrl ? new URL(CFG_UNIDADE.logoUrl, location.href).href : base + 'img/relint/selo-dint.png';
        const linhasCab = c.cabecalho.split('\n').map(l => l.trim()).filter(Boolean);
        const aviso = 'Conhecimento para assessoramento do processo decisório, não tendo finalidade probatória. Conforme previsto na DNISP, este documento e seus anexos não devem ser inseridos em procedimentos e/ou processos de qualquer natureza.';
        const sigilo = 'O sigilo deste documento é protegido e controlado pela Lei n.º 12.527/11. A divulgação, o fornecimento, a utilização ou a reprodução desautorizada do seu conteúdo, a qualquer tempo ou por qualquer meio ou modo, inclusive mediante acesso ou facilitação de acesso indevidos, constituem condutas ilícitas que ensejam responsabilidades penais, civis e administrativas.';
        const fotoDe = (a, id) => (a.ficha.fotos || []).find(x => x.id === id);
        const anexo = prontos.map((a, i) => {
            const f = a.ficha, d = f.dados, fp = fotoDe(a, a.sel.foto), end = enderecoSel(a), im = fotoDe(a, a.sel.imovel);
            const regs = registrosSel(a);
            const linkEnd = end ? (end.link || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end.texto)}`) : '';
            const refEnd = end ? [end.pontoReferencia, ...(end.referencias || []), end.descricao].filter(Boolean).join('. ').toUpperCase() : '';
            return `<table class="qual">
                <tr><td class="qual-foto"><img src="${esc(fp ? fp.url : base + 'img/relint/sem-foto.jpg')}" alt=""><div class="qual-n">Nº ${String(i + 1).padStart(2, '0')}</div></td>
                    <td class="qual-dados">
                        <div>Nome: ${esc(up(d.nome))}</div>${vulgos(f) ? `<div>Vulgo: “${esc(up(vulgos(f)))}”</div>` : ''}
                        ${d.mae ? `<div>Mãe: ${esc(up(d.mae))}</div>` : ''}${d.pai ? `<div>Pai: ${esc(up(d.pai))}</div>` : ''}
                        ${d.cpf ? `<div>CPF: ${esc(cpfFmt(d.cpf))}</div>` : ''}${d.rg ? `<div>RG: ${esc([d.rg, d.rgOrgao].filter(Boolean).join(' '))}</div>` : ''}
                        ${d.nascimento ? `<div>D. N.: ${esc(dataBR(d.nascimento))}</div>` : ''}${val(a.funcao) ? `<div>Função: ${esc(up(a.funcao))}</div>` : ''}</td></tr>
                <tr><th>Informações:</th><td>${esc(val(a.sel.info) || 'X-X-X-X')}</td></tr>
                <tr><th>Ficha criminal:</th><td>${regs.length ? regs.map(r => `${esc(r.tipo || 'B.O')} Nº ${esc(r.numero || '—')} – ${esc(up(r.crimes))};`).join('<br>') : 'NADA CONSTA NAS BASES CONSULTADAS.'}</td></tr>
                <tr><th>Endereço:</th><td>${end ? esc(end.texto) + (refEnd ? '.<br>' + esc(refEnd) + '.' : '') : 'X-X-X-X'}</td></tr>
                <tr><td class="qual-qr">${linkEnd ? `<div class="qr-tit">QRCODE:</div><img src="${qrDataUrl(linkEnd)}" alt="">` : ''}</td>
                    <td class="qual-imovel">${im ? `<img src="${esc(im.url)}" alt="">` : '<div class="sem-img">Sem foto do imóvel</div>'}</td></tr>
            </table>`;
        }).join('<div class="quebra"></div>');
        const registro = prontos.flatMap(a => [...a.sel.registro].map(id => ({ a, x: fotoDe(a, id) })).filter(r => r.x));
        const regHtml = registro.length ? `<div class="quebra"></div><div class="tit-centro">REGISTRO FOTOGRÁFICO</div>` + registro.map(({ a, x }) =>
            `<table class="reg"><tr><td><img src="${esc(x.url)}" alt=""><div class="reg-leg">${esc(val(x.legenda) || `${vulgo(a.ficha) ? '“' + up(vulgo(a.ficha)) + '”' : up(a.ficha.dados.nome)} — registro fotográfico ${x.tipo === 'residencia' ? 'do imóvel' : x.tipo === 'veiculo' ? 'do veículo' : 'do indivíduo'}.`)}</div></td></tr></table>`).join('') : '';
        const hist = prontos.filter(a => registrosSel(a).length).map(a => `<div class="quebra"></div><div class="tit-centro">HISTÓRICO CRIMINAL — ${esc(up(a.ficha.dados.nome))}${vulgo(a.ficha) ? ' (“' + esc(up(vulgo(a.ficha))) + '”)' : ''}</div>` +
            registrosSel(a).map(r => `<div class="hist-tit">${esc(up(r.crimes) || 'REGISTRO POLICIAL')}</div><table class="hist"><tr><td><b>Tipo do procedimento:</b> ${esc(r.tipo || 'BO')}</td><td><b>Número:</b> ${esc(r.numero || '—')}</td></tr><tr><td><b>Data do fato:</b> ${esc(dataBR(r.dataFato) || '—')}</td><td><b>Envolvimento:</b> ${esc(up(r.papel) || '—')}</td></tr></table>`).join('')).join('');
        const campos = [['DATA', cab.data], ['ASSUNTO', cab.assunto], ['ORIGEM', cab.origem], ['DIFUSÃO', cab.difusao], ['DIFUSÃO ANTERIOR', cab.difusaoAnterior], ['REFERÊNCIA', cab.referencia], ['OPERAÇÃO', cab.operacao], ['ANEXO', cab.anexo]]
            .filter(([, v]) => val(v)).map(([k, v]) => `<div class="campo"><b>${k}:</b> ${esc(v)}</div>`).join('');
        const assinatura = val(c.assinatura) ? `<div class="assinatura">${c.assinatura.split('\n').map(l => esc(l)).join('<br>')}</div>` : '';
        return `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"><base href="${base}page/"><title>RELINT ${esc(cab.numero)}</title><style>
            @page { size: A4; margin: 8mm 16mm 8mm 16mm; @top-right-corner { content: counter(page) "/" counter(pages); font: bold 10pt "Times New Roman", serif; vertical-align: bottom; text-align: left; padding: 0 0 0 2mm; } }
            * { box-sizing: border-box; }
            body { margin: 0; font: 12pt/1.5 Arial, Helvetica, sans-serif; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .pg { width: 100%; border-collapse: collapse; } .pg > thead td, .pg > tfoot td { padding: 0; } .pg > tbody > tr > td { padding: 0 6mm; }
            .topo { position: relative; padding-bottom: 4mm; } .topo.com-selo { min-height: 44mm; }
            .aviso { border: 1px solid #e00; color: #e00; font-size: 8.5pt; line-height: 1.25; text-align: center; padding: 2px 6px; }
            .restrito { width: 47mm; margin: 2mm auto 0; border: 1.2px solid #e00; color: #e00; font: bold 10.5pt Arial; text-align: center; padding: 1px 0; }
            .selo { position: absolute; right: 0; top: 19mm; width: 22mm; height: 22mm; object-fit: contain; }
            .rodape { padding-top: 3mm; } .rodape .aviso { text-align: justify; }
            .marca { position: fixed; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-55deg); font: bold 92pt Arial; color: rgba(0,0,0,.055); white-space: nowrap; z-index: -1; letter-spacing: .08em; }
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
        </style></head><body>
            <div class="marca">${esc(c.marca)}</div>
            <table class="pg${selo ? ' com-selo-doc' : ''}">
                <thead><tr><td><div class="topo${selo ? ' com-selo' : ''}"><div class="aviso">${aviso}</div><div class="restrito">ACESSO RESTRITO</div>${selo ? `<img class="selo" src="${esc(selo)}" alt="">` : ''}</div></td></tr></thead>
                <tfoot><tr><td><div class="rodape"><div class="aviso">${sigilo}</div><div class="restrito">ACESSO RESTRITO</div></div></td></tr></tfoot>
                <tbody><tr><td>
                    <div class="inst"><img src="${base}img/relint/brasao-pmal.png" alt=""><div>${linhasCab.map(esc).join('<br>')}</div><span></span></div>
                    <h1>RELATÓRIO DE INTELIGÊNCIA ${esc(cab.numero)}</h1>
                    <div class="campos">${campos}</div>
                    <div class="corpo">${$('ri-corpo').innerHTML}</div>
                    ${assinatura}
                    <div class="separa">X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X-X</div>
                    ${prontos.length ? `<div class="quebra"></div><div class="tit-centro">ANEXO A – QUALIFICAÇÃO DOS ENVOLVIDOS</div>${anexo}` : ''}
                    ${regHtml}${hist}
                </td></tr></tbody>
            </table>
        </body></html>`;
    }
    // Impressão por iframe na própria página (funciona também no .exe —
    // sem pop-up e sem passar o conteúdo sigiloso por nenhum servidor).
    function aguardarImagens(doc) {
        return Promise.all([...doc.images].map(img => img.complete ? null : new Promise(ok => { img.onload = img.onerror = ok; setTimeout(ok, 8000); })));
    }
    async function previa() {
        if (!E.alvos.some(a => a.ficha)) { alert('Adicione ao menos um alvo.'); return; }
        const fr = $('ri-previa');
        fr.srcdoc = montarDocumento();
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
        }
        await aguardarImagens(fr.contentDocument);
        fr.contentWindow.focus(); fr.contentWindow.print();
    }

    // ── rascunho (só neste navegador) ───────────────────────────────
    function salvarRascunho() {
        lsSet(LS_RASCUNHO, { cab: lerCab(), corpo: $('ri-corpo').innerHTML, grupo: E.grupo ? { nome: $('ri-grupo-nome').value, tipo: E.grupo.tipo } : null,
            alvos: E.alvos.filter(a => a.ficha).map(a => ({ id: a.id, funcao: a.funcao, sel: Object.assign({}, a.sel, { registro: [...a.sel.registro], fc: [...a.sel.fc] }) })), salvoEm: new Date().toISOString() });
        const b = $('ri-salvar'); b.textContent = '✅ Rascunho salvo'; setTimeout(() => { b.textContent = '💾 Salvar rascunho'; }, 2000);
    }
    async function restaurar() {
        const r = lsGet(LS_RASCUNHO, null);
        escreverCab(Object.assign(cabPadrao(), r ? r.cab : {}));
        if (!r) return;
        if (r.corpo) $('ri-corpo').innerHTML = r.corpo;
        if (r.grupo) { E.grupo = { nome: r.grupo.nome, tipo: r.grupo.tipo }; $('ri-grupo-nome').value = r.grupo.nome || ''; }
        for (const a of r.alvos || []) await adicionarAlvo(a.id, { funcao: a.funcao, sel: a.sel });
    }
    function novo() {
        if (!confirm('Começar um novo relatório? O rascunho atual será apagado.')) return;
        try { localStorage.removeItem(LS_RASCUNHO); } catch (e) { /* opcional */ }
        E.alvos = []; E.grupo = null; E.ativo = 0;
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
