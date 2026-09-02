        // ====================================================================
        // Sistema P3 — Cliente do Atualizador local (Python)
        // ====================================================================
        // Fala com o servidor Python que roda no PC de quem clicou (ver
        // tools/atualizador-local/) — substitui, sob demanda (só quando
        // clicado), o robô agendado do Apps Script pra:
        //   1) Movimentação de processos (Autores/Suspeitos) — js/autores.js
        //      (verificarAgora) e js/suspeitos.js (verificarAgoraSuspeitos).
        //   2) Busca de foto no CAD/SERIS (Alcatraz) — js/cad-busca-foto.js.
        //
        // Servidor precisa estar rodando (python tools/atualizador-local/app.py)
        // — se não estiver, disponivel() devolve false e quem chama decide o
        // que fazer (cad-busca-foto.js cai de volta pro Apps Script; os botões
        // de "Verificar agora" avisam o usuário pra abrir o servidor).
        (function (global) {
            'use strict';
            if (global.P3AtualizadorLocal) return;

            const URL_BASE = 'http://localhost:5057';
            const TIMEOUT_HEALTH_MS = 2000;

            async function disponivel() {
                try {
                    const controlador = new AbortController();
                    const timer = setTimeout(() => controlador.abort(), TIMEOUT_HEALTH_MS);
                    const resp = await fetch(`${URL_BASE}/health`, { signal: controlador.signal });
                    clearTimeout(timer);
                    return resp.ok;
                } catch (e) {
                    return false;
                }
            }

            // Lê um corpo NDJSON (1 objeto JSON por linha) conforme os bytes vão
            // chegando, chamando onLinha(obj) pra cada linha completa — é assim
            // que /movimentacoes/atualizar manda progresso item a item sem
            // esperar o processo inteiro terminar pra responder.
            async function lerStreamNdjson(resp, onLinha) {
                const reader = resp.body.getReader();
                const decoder = new TextDecoder('utf-8');
                let buffer = '';
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    let idx;
                    while ((idx = buffer.indexOf('\n')) !== -1) {
                        const linha = buffer.slice(0, idx).trim();
                        buffer = buffer.slice(idx + 1);
                        if (!linha) continue;
                        let obj;
                        try { obj = JSON.parse(linha); }
                        catch (e) { console.warn('[atualizador-local] linha NDJSON inválida:', linha); continue; }
                        onLinha(obj);
                    }
                }
                const resto = buffer.trim();
                if (resto) {
                    try { onLinha(JSON.parse(resto)); } catch (e) { /* ignora resto incompleto */ }
                }
            }

            // tipo: 'autores' | 'suspeitos' | 'ambos'. onProgresso(obj) é chamado
            // pra cada evento {tipo:'inicio'|'progresso'|'aviso'|'fim_fonte', ...}
            // — ver tools/atualizador-local/sync_movimentacoes.py pro formato
            // exato de cada um. Lança erro se o servidor não estiver disponível,
            // responder com erro HTTP, ou mandar um evento {tipo:'erro_fatal'}.
            async function atualizarMovimentacoes(tipo, onProgresso) {
                const resp = await fetch(`${URL_BASE}/movimentacoes/atualizar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tipo: tipo, forcar: true }),
                });
                if (!resp.ok) {
                    let detalhe = '';
                    try { detalhe = (await resp.json()).erro || ''; } catch (e) { /* corpo não era JSON */ }
                    throw new Error(detalhe || `Atualizador local respondeu HTTP ${resp.status}`);
                }

                let resumoFinal = null;
                let erroFatal = null;
                await lerStreamNdjson(resp, function (obj) {
                    if (obj.tipo === 'fim') resumoFinal = obj.resumo;
                    else if (obj.tipo === 'erro_fatal') erroFatal = obj.mensagem;
                    else if (onProgresso) onProgresso(obj);
                });
                if (erroFatal) throw new Error(erroFatal);
                return resumoFinal;
            }

            // Mesmo contrato de retorno que o Apps Script (buscarFotoPessoaCAD)
            // já tinha: {ok, encontrado, pessoa, fotos:[...], erro?}.
            async function buscarFotoAlcatraz(cpfLimpo) {
                const resp = await fetch(`${URL_BASE}/alcatraz/buscar-foto?cpf=${cpfLimpo}`);
                return resp.json();
            }

            // {ok, configurado, login} — usado pra saber se já tem credenciais
            // salvas no servidor local (ver js/core/cad-status-banner.js).
            async function statusCad() {
                const resp = await fetch(`${URL_BASE}/cad/status`);
                return resp.json();
            }

            // Salva login/senha/token do CAD no servidor local (persistido em
            // cad_config.json — ver tools/atualizador-local/cad_config_store.py)
            // e já testa o login completo na hora, mesmo espírito do
            // "diagnostico_auth" que o modal já fazia contra o Apps Script.
            // {ok, testado, erro?}.
            async function configurarCad(login, senha, token) {
                const resp = await fetch(`${URL_BASE}/cad/configurar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ login: login, senha: senha, token: token }),
                });
                return resp.json();
            }

            // Consulta Integrada de Pessoas (page/consulta-pessoa.html) — ver
            // rota /pessoa/consultar em tools/atualizador-local/app.py.
            // Streaming NDJSON (mesmo padrão de atualizarMovimentacoes acima) —
            // a consulta bate em ~17 etapas em sequência e pode passar de 30s;
            // onProgresso(obj) é chamado a cada evento {tipo:'inicio'|'progresso', ...}
            // pra alimentar uma barra de progresso, sem esperar a consulta
            // inteira terminar pra mostrar alguma coisa. Lança erro em caso de
            // falha de conexão/HTTP/evento erro_fatal; devolve o `resultado`
            // final (mesmo objeto que a versão não-streaming devolvia).
            async function consultarPessoaStream(cpfLimpo, onProgresso) {
                const resp = await fetch(`${URL_BASE}/pessoa/consultar?cpf=${encodeURIComponent(cpfLimpo)}`);
                if (!resp.ok) {
                    let detalhe = '';
                    try { detalhe = (await resp.json()).erro || ''; } catch (e) { /* corpo não era JSON */ }
                    throw new Error(detalhe || `Consulta respondeu HTTP ${resp.status}`);
                }
                let resultadoFinal = null;
                let erroFatal = null;
                await lerStreamNdjson(resp, function (obj) {
                    if (obj.tipo === 'fim') resultadoFinal = obj.resultado;
                    else if (obj.tipo === 'erro_fatal') erroFatal = obj.mensagem;
                    else if (onProgresso) onProgresso(obj);
                });
                if (erroFatal) throw new Error(erroFatal);
                return resultadoFinal;
            }

            // params: {tipo:'ppe', id, hash} | {tipo:'pc_antigo', numeroBo} | {tipo:'despacho', idOcor}
            async function ocorrenciaDetalhe(params) {
                const qs = new URLSearchParams(params).toString();
                const resp = await fetch(`${URL_BASE}/pessoa/ocorrencia-detalhe?${qs}`);
                return resp.json();
            }

            // Busca de identificação por NOME/MÃE/PAI (não pede CPF) — devolve
            // {ok, pessoas:[{nome,mae,pai,cpf,dataNascimento,rg,alcunha}]}, pode
            // ter mais de 1 (homônimos). Ver P3ConsultaPessoaAbrirCpf pra
            // continuar a partir de 1 dos resultados.
            async function buscarPessoaPorNome(nome, mae, pai) {
                const qs = new URLSearchParams({ nome: nome || '', mae: mae || '', pai: pai || '' }).toString();
                const resp = await fetch(`${URL_BASE}/pessoa/buscar-por-nome?${qs}`);
                return resp.json();
            }

            // Busca de veículo por PLACA ou CHASSI (RENAVAM não é aceito como
            // critério pelo CAD — ver comentário em app.py/cad_consulta.py) —
            // devolve {ok, encontrado, veiculo?, erro?}.
            async function buscarVeiculo(placa, chassi) {
                const qs = new URLSearchParams({ placa: placa || '', chassi: chassi || '' }).toString();
                const resp = await fetch(`${URL_BASE}/veiculo/consultar?${qs}`);
                return resp.json();
            }

            // Consulta SEMI-automática de unidade consumidora na Equatorial
            // Alagoas (30/08/2026, pedido explícito do usuário) — abre uma
            // janela de navegador de verdade (só funciona dentro do app
            // desktop, ver equatorial_popup.py) já com CPF/data de nascimento
            // preenchidos; o usuário clica em "Entrar" e resolve o captcha lá
            // mesmo se aparecer. Essa chamada FICA PENDENTE (sem timeout do lado
            // do fetch) até o usuário terminar, cancelar ou o servidor desistir
            // sozinho depois de 10 min — ver _TIMEOUT_ESPERA_S em
            // equatorial_popup.py. Devolve {ok, enderecos:[{endereco,uc,
            // pontoReferencia}], erro?}.
            async function equatorialConsultar(cpf, dataNascimentoBr) {
                const resp = await fetch(`${URL_BASE}/pessoa/equatorial-consultar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cpf: cpf || '', dataNascimento: dataNascimentoBr || '' }),
                });
                return resp.json();
            }

            // 2ª fonte de foto na Consulta Integrada de Pessoas (ver
            // page/consulta-pessoa.html) — {ok, configurado}.
            async function idsegStatus() {
                const resp = await fetch(`${URL_BASE}/cad/idseg-status`);
                return resp.json();
            }

            // senha é OPCIONAL (31/08/2026, pedido explícito do usuário:
            // "alguns usuários utilizam o mesmo login (CPF) mas a senha
            // diferente") — em branco, o servidor mantém o comportamento
            // de sempre (usa a senha do CAD). {ok, erro?}.
            async function idsegConfigurar(token, senha) {
                const resp = await fetch(`${URL_BASE}/cad/idseg-configurar`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: token, senha: senha || '' }),
                });
                return resp.json();
            }

            // Busca web por nome (Webmii, ver webmii_busca.py) — o
            // Chromium usado por baixo NÃO vem embutido no .exe (decisão
            // explícita do usuário, 30/08/2026 — ver comentário grande em
            // webmii_busca.py), precisa ser baixado 1 vez por máquina.
            // {ok, instalado}.
            async function webmiiStatus() {
                const resp = await fetch(`${URL_BASE}/webmii/status`);
                return resp.json();
            }

            // Dispara o download (~190MB, só na 1ª vez) — BLOQUEANTE de
            // propósito, sem timeout do lado do fetch (mesmo espírito de
            // equatorialConsultar acima: pode levar minutos dependendo da
            // conexão). {ok, mensagem}.
            async function webmiiInstalar() {
                const resp = await fetch(`${URL_BASE}/webmii/instalar`, { method: 'POST' });
                return resp.json();
            }

            // Consulta de CNPJ via BrasilAPI (31/08/2026, pedido explícito
            // do usuário) — API pública, sem CAD/login nenhum envolvido
            // (ver brasilapi_cnpj.py). {ok, encontrado, dados?, erro?}.
            async function consultarCnpj(cnpj) {
                const resp = await fetch(`${URL_BASE}/cnpj/consultar?cnpj=${encodeURIComponent(cnpj)}`);
                return resp.json();
            }

            // Denúncias Recorrentes (01/09/2026, redesenho) — ver
            // tools/atualizador-local/alvos_denuncia.py. {ok, alvos:[...]}.
            async function alvosDenunciaSalvos() {
                const resp = await fetch(`${URL_BASE}/supabase/denuncias-recorrentes/salvos`);
                return resp.json();
            }

            // Dispara o pipeline inteiro (agrupar endereços → extrair
            // candidatos → cruzar Supabase/Autores → busca completa no CAD
            // pros confirmados → salvar na Hostinger) — streaming NDJSON,
            // mesmo padrão de consultarPessoaStream/atualizarMovimentacoes
            // acima. Pode levar minutos (login real do CAD, 1 pessoa por
            // vez). onProgresso(obj) por evento {tipo:'inicio'|'progresso'|
            // 'aviso', ...}; devolve o `resumo` final ({totalGrupos,
            // totalCandidatos, totalInvestigados, totalSalvos}).
            async function rodarVarreduraDenunciasRecorrentes(onProgresso) {
                const resp = await fetch(`${URL_BASE}/supabase/denuncias-recorrentes/varredura`, { method: 'POST' });
                if (!resp.ok) {
                    let detalhe = '';
                    try { detalhe = (await resp.json()).erro || ''; } catch (e) { /* corpo não era JSON */ }
                    throw new Error(detalhe || `Varredura respondeu HTTP ${resp.status}`);
                }
                let resumoFinal = null;
                let erroFatal = null;
                await lerStreamNdjson(resp, function (obj) {
                    if (obj.tipo === 'fim') resumoFinal = obj.resumo;
                    else if (obj.tipo === 'erro_fatal') erroFatal = obj.mensagem;
                    else if (onProgresso) onProgresso(obj);
                });
                if (erroFatal) throw new Error(erroFatal);
                return resumoFinal;
            }

            // Sincronização Direta do CAD (02/09/2026) — busca 1 grade
            // (ocorrencias|armas|drogas|envolvidos) direto no CAD, sem os
            // tetos de tempo/tamanho do Apps Script (ver
            // tools/atualizador-local/cad_grades.py e a rota
            // /cad/sincronizar-grade). Streaming NDJSON, mesmo padrão de
            // consultarPessoaStream acima — onProgresso(obj) recebe
            // {tipo:'progresso', pagina, totalPaginas, registros,
            // totalReal} a cada página buscada. Devolve o MESMO formato
            // de `resultado` que o Apps Script já devolvia ({ok, dados,
            // total, totalRelatadoPeloCAD, truncado, motivoTruncamento})
            // — js/cadastroocorrencias.js usa isso pra não precisar de
            // nenhuma lógica separada por origem (Python vs Apps Script).
            async function buscarGradeCad(grade, dataIni, dataFim, onProgresso) {
                const qs = new URLSearchParams({ grade: grade, dataIni: dataIni, dataFim: dataFim }).toString();
                const resp = await fetch(`${URL_BASE}/cad/sincronizar-grade?${qs}`);
                if (!resp.ok) {
                    let detalhe = '';
                    try { detalhe = (await resp.json()).erro || ''; } catch (e) { /* corpo não era JSON */ }
                    throw new Error(detalhe || `Sincronização (${grade}) respondeu HTTP ${resp.status}`);
                }
                let resultadoFinal = null;
                let erroFatal = null;
                await lerStreamNdjson(resp, function (obj) {
                    if (obj.tipo === 'fim') resultadoFinal = obj.resultado;
                    else if (obj.tipo === 'erro_fatal') erroFatal = obj.mensagem;
                    else if (onProgresso) onProgresso(obj);
                });
                if (erroFatal) throw new Error(erroFatal);
                return resultadoFinal;
            }

            // Cérbero (02/09/2026) — importa uma captura .har (arquivo File,
            // vindo de <input type="file">) pro servidor local processar e
            // subir pra Hostinger. Streaming NDJSON, mesmo padrão das demais
            // rotas longas — onProgresso(obj) recebe {tipo:'progresso',
            // mensagem}. Devolve o `resultado` final ({pessoas, enderecos,
            // fotosEnviadas, fotosJaExistentes, fotosComErro}).
            async function importarHarCerbero(arquivoHar, onProgresso) {
                const formData = new FormData();
                formData.append('har', arquivoHar, arquivoHar.name);
                const resp = await fetch(`${URL_BASE}/cerbero/importar-har`, { method: 'POST', body: formData });
                if (!resp.ok) {
                    let detalhe = '';
                    try { detalhe = (await resp.json()).erro || ''; } catch (e) { /* corpo não era JSON */ }
                    throw new Error(detalhe || `Importação respondeu HTTP ${resp.status}`);
                }
                let resultadoFinal = null;
                let erroFatal = null;
                await lerStreamNdjson(resp, function (obj) {
                    if (obj.tipo === 'fim') resultadoFinal = obj.resultado;
                    else if (obj.tipo === 'erro_fatal') erroFatal = obj.mensagem;
                    else if (onProgresso) onProgresso(obj);
                });
                if (erroFatal) throw new Error(erroFatal);
                return resultadoFinal;
            }

            global.P3AtualizadorLocal = {
                URL_BASE: URL_BASE,
                disponivel: disponivel,
                atualizarMovimentacoes: atualizarMovimentacoes,
                buscarFotoAlcatraz: buscarFotoAlcatraz,
                statusCad: statusCad,
                configurarCad: configurarCad,
                consultarPessoaStream: consultarPessoaStream,
                ocorrenciaDetalhe: ocorrenciaDetalhe,
                buscarPessoaPorNome: buscarPessoaPorNome,
                buscarVeiculo: buscarVeiculo,
                equatorialConsultar: equatorialConsultar,
                idsegStatus: idsegStatus,
                idsegConfigurar: idsegConfigurar,
                webmiiStatus: webmiiStatus,
                webmiiInstalar: webmiiInstalar,
                consultarCnpj: consultarCnpj,
                alvosDenunciaSalvos: alvosDenunciaSalvos,
                rodarVarreduraDenunciasRecorrentes: rodarVarreduraDenunciasRecorrentes,
                buscarGradeCad: buscarGradeCad,
                importarHarCerbero: importarHarCerbero,
            };
        })(window);
