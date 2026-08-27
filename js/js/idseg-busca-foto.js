// ====================================================================
// Sistema P3 — Busca de foto no IDSEG (app Quimera / SSP-AL) por CPF
// ====================================================================
// Segunda fonte de foto, ao lado do CAD/Alcatraz (ver js/cad-busca-foto.js
// — mesmo pipeline de detecção facial + upload, só troca de onde a foto
// vem). Chama o MESMO Apps Script de rastreamento (ação
// buscar_foto_pessoa_idseg — ver apps-script/rastreamento.gs), que
// autentica no IDSEG com o login/senha do CAD já configurados (mesma
// credencial, sem tela de login separada) e devolve foto(s) em base64.
//
// Duas formas de uso, pra dois fluxos diferentes na tela:
//   - idsegBuscarESalvarUmaPessoa: busca e já SALVA sozinho (escolhe a
//     melhor foto como capa) — usado em Autores, mesmo padrão do botão
//     "🔍 Buscar" do CAD.
//   - idsegConsultarPessoa + idsegSalvarFotoEncontrada: busca e devolve
//     as fotos SEM salvar nada — usado em Suspeitos, onde o cadastro
//     agora tem NOME/CPF/RG/MÃE e o usuário decide, foto por foto, qual
//     salvar (clique em "💾 Salvar" depois de ver o preview).

const GAS_IDSEG_URL_FOTO = GAS_CAD_URL_FOTO; // mesmo projeto Apps Script (ver js/cad-busca-foto.js)

async function idsegBuscarFotoPorCpf(cpf) {
    const cpfLimpo = String(cpf || '').replace(/\D/g, '');
    if (!cpfLimpo) return { ok: false, erro: 'CPF ausente.' };

    for (let tentativa = 1; tentativa <= CAD_BUSCA_MAX_TENTATIVAS; tentativa++) {
        const resp = await fetch(`${GAS_IDSEG_URL_FOTO}?acao=buscar_foto_pessoa_idseg&cpf=${cpfLimpo}`);
        const resultado = await resp.json();
        if (resultado.ocupado && tentativa < CAD_BUSCA_MAX_TENTATIVAS) {
            await new Promise(resolve => setTimeout(resolve, CAD_BUSCA_ESPERA_OCUPADO_MS));
            continue;
        }
        return resultado;
    }
}

// Baixa todas as fotos encontradas e detecta rosto em cada uma — reaproveita
// cadBaixarEDetectarFoto_/p3CarregarModelosFaciais/cadVetorSeConfiavel_ de
// js/cad-busca-foto.js (carregado antes deste arquivo nas páginas que usam
// IDSEG), que não têm nada específico de CAD na lógica, só no nome.
// Devolve null se o CPF não bateu no IDSEG (ou erro), ou
// { pessoa, candidatas:[{arquivo, deteccao}] } ordenado da melhor pra pior.
async function idsegBuscarCandidatas_(cpf) {
    const resultado = await idsegBuscarFotoPorCpf(cpf);
    if (!resultado.ok) throw new Error(resultado.erro || 'Erro desconhecido no Apps Script do IDSEG.');
    if (!resultado.encontrado || !resultado.fotos || !resultado.fotos.length) return null;

    await p3CarregarModelosFaciais();

    const candidatas = [];
    for (let i = 0; i < resultado.fotos.length; i++) {
        try {
            candidatas.push(await cadBaixarEDetectarFoto_('idseg_' + Date.now(), i, resultado.fotos[i]));
        } catch (e) {
            // Falha ao baixar ESSA foto em si — pula, segue com as demais
            // (mesmo raciocínio de cadBuscarESalvarUmaPessoa).
        }
    }
    if (!candidatas.length) throw new Error('Nenhuma das fotos encontradas no IDSEG pôde ser baixada.');
    candidatas.sort((a, b) => (b.deteccao ? b.deteccao.score : -1) - (a.deteccao ? a.deteccao.score : -1));

    return { pessoa: resultado.pessoa || null, candidatas };
}

// ====================================================================
// Fluxo AUTOMÁTICO (Autores) — mesmo comportamento de
// cadBuscarESalvarUmaPessoa: acha, baixa tudo, salva a melhor como capa
// e as demais como extra, sem intervenção manual.
// ====================================================================
async function idsegBuscarESalvarUmaPessoa(cfg, tipo, id, cpf) {
    if (!cpf) return { status: 'sem_cpf' };
    let achado;
    try {
        achado = await idsegBuscarCandidatas_(cpf);
    } catch (e) {
        return { status: 'erro', erro: e.message };
    }
    if (!achado) return { status: 'nao_encontrado' };

    const uploadFoto = tipo === 'suspeito' ? P3.Suspeitos.uploadFoto : P3.Autores.uploadFoto;
    const capa = achado.candidatas[0];
    const extras = achado.candidatas.slice(1);

    let comVetor = 0, salvas = 0;
    try {
        await uploadFoto(cfg, id, capa.arquivo, cadVetorSeConfiavel_(capa.deteccao), { origem: 'idseg' });
        salvas++;
        if (cadVetorSeConfiavel_(capa.deteccao)) comVetor++;
    } catch (e) {
        return { status: 'erro', erro: e.message };
    }

    for (const extra of extras) {
        try {
            await uploadFoto(cfg, id, extra.arquivo, cadVetorSeConfiavel_(extra.deteccao), { capa: false, origem: 'idseg' });
            salvas++;
            if (cadVetorSeConfiavel_(extra.deteccao)) comVetor++;
        } catch (e) {
            // 1 foto extra falhar não é crítico.
        }
    }

    return { status: 'salvo', totalFotos: achado.candidatas.length, salvas, comVetor, pessoa: achado.pessoa };
}

// ====================================================================
// Fluxo MANUAL (Suspeitos) — busca e devolve as fotos pro usuário ver
// ANTES de decidir salvar (pedido explícito: cadastro com NOME/CPF/RG/
// MÃE consultado no IDSEG, "aparecendo a foto eu possa salvar... ao
// clicar em salvar"). Nada é gravado no banco até idsegSalvarFotoEncontrada
// ser chamada.
// ====================================================================
async function idsegConsultarPessoa(cpf) {
    if (!cpf) return { status: 'sem_cpf' };
    let achado;
    try {
        achado = await idsegBuscarCandidatas_(cpf);
    } catch (e) {
        return { status: 'erro', erro: e.message };
    }
    if (!achado) return { status: 'nao_encontrado' };
    return { status: 'encontrado', pessoa: achado.pessoa, candidatas: achado.candidatas };
}

// Salva UMA candidata específica (já detectada por idsegConsultarPessoa)
// — `capa` (default true) decide se ela vira a foto principal da pessoa.
async function idsegSalvarFotoEncontrada(cfg, tipo, id, candidata, capa) {
    const uploadFoto = tipo === 'suspeito' ? P3.Suspeitos.uploadFoto : P3.Autores.uploadFoto;
    return await uploadFoto(cfg, id, candidata.arquivo, cadVetorSeConfiavel_(candidata.deteccao), {
        origem: 'idseg',
        capa: capa === false ? false : undefined,
    });
}
