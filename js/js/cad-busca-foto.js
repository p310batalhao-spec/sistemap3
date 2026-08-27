// ====================================================================
// Sistema P3 — Busca de foto no CAD (SERIS/Alcatraz) por CPF
// ====================================================================
// Usado pelas telas de Autores e Suspeitos (botão "🔍" por linha + botão
// "Buscar fotos de todos no CAD"). Tenta primeiro o servidor local
// (tools/atualizador-local/ — ver js/core/atualizador-local.js), que faz
// o mesmo login/busca no CAD sem depender do Apps Script; se ele não
// estiver rodando, cai pro Apps Script de rastreamento (mesmo projeto da
// Análise Preditiva, ver js/preditivaCAD.js:GAS_CAD_URL — autentica no
// CAD com CPF+senha+token já configurados por lá). Os dois devolvem a(s)
// foto(s) do Alcatraz em base64, se achar alguma pro CPF.
//
// A detecção de rosto e o upload continuam 100% no navegador,
// reaproveitando js/core/facial-detect.js + P3.Autores.uploadFoto /
// P3.Suspeitos.uploadFoto (mesmo pipeline da aba "Upload de foto") —
// aqui só troca "arquivo escolhido no seu PC" por "arquivo baixado do
// CAD". Apps Script não tem como calcular o vetor facial sozinho (não
// roda face-api.js), por isso a foto sempre passa pelo navegador antes
// de ser salva.

const GAS_CAD_URL_FOTO = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';

// Tenta de novo sozinho quando o backend responde "ocupado" (outra busca
// rodando na mesma sessão do CAD — ver comentário em
// buscarFotoPessoaCAD no rastreamento.gs) — sem isso, rodar "buscar
// todos" enquanto alguém usa a Análise Preditiva faria boa parte dos
// CPFs falharem só por causa dessa colisão passageira.
const CAD_BUSCA_MAX_TENTATIVAS = 4;
const CAD_BUSCA_ESPERA_OCUPADO_MS = 3000;

// Piso de confiança pra uma detecção virar VETOR salvo (referência
// permanente na busca por reconhecimento facial). Mais alto que o
// minConfidence usado pra sequer TENTAR detectar (0.15, em
// p3DetectarRostoComQualidade) de propósito: aqui não tem humano
// revisando cada foto antes de salvar (fluxo 100% automático, às vezes
// em lote pra dezenas de pessoas), então uma detecção fraca (ex.: 0.2 —
// pode ser meio rosto, reflexo, foto de documento com uma cabeça
// impressa) virando referência permanente prejudicaria TODO MUNDO que
// buscar depois, não só essa pessoa. Abaixo disso a foto ainda é salva
// (fica como referência visual), só não soma vetor à busca.
const CAD_VETOR_SCORE_MINIMO = 0.35;

// Tenta primeiro o servidor local (tools/atualizador-local/ —
// cad_alcatraz.py, mesmo fluxo de rastreamento.gs porém sem depender do
// Apps Script) e só cai pro Apps Script se ele não estiver rodando —
// assim o botão continua funcionando de qualquer jeito, só mais rápido
// quando o servidor local está aberto. Mesmo formato de retorno nos
// dois casos: {ok, encontrado, pessoa, fotos:[...], erro?}.
async function cadBuscarFotoPorCpf(cpf) {
    const cpfLimpo = String(cpf || '').replace(/\D/g, '');
    if (!cpfLimpo) return { ok: false, erro: 'CPF ausente.' };

    if (typeof P3AtualizadorLocal !== 'undefined' && await P3AtualizadorLocal.disponivel()) {
        try {
            return await P3AtualizadorLocal.buscarFotoAlcatraz(cpfLimpo);
        } catch (e) {
            console.warn('[cad-busca-foto] Servidor local falhou, caindo pro Apps Script:', e);
            // segue pro caminho antigo abaixo em vez de propagar o erro
        }
    }

    for (let tentativa = 1; tentativa <= CAD_BUSCA_MAX_TENTATIVAS; tentativa++) {
        const resp = await fetch(`${GAS_CAD_URL_FOTO}?acao=buscar_foto_pessoa&cpf=${cpfLimpo}`);
        const resultado = await resp.json();
        if (resultado.ocupado && tentativa < CAD_BUSCA_MAX_TENTATIVAS) {
            await new Promise(resolve => setTimeout(resolve, CAD_BUSCA_ESPERA_OCUPADO_MS));
            continue;
        }
        return resultado;
    }
}

// Converte a foto (data URL base64 vinda do Apps Script) num File e
// detecta rosto+qualidade — NÃO salva nada ainda (ver
// cadBuscarESalvarUmaPessoa: primeiro detecta em TODAS as fotos da
// pessoa, só depois decide qual delas vira a capa). Nunca lança: foto
// sem rosto detectável vira { arquivo, deteccao: null } em vez de erro,
// pra não travar o processamento das demais fotos da mesma pessoa.
async function cadBaixarEDetectarFoto_(id, indice, fotoDataUrl) {
    const respBlob = await fetch(fotoDataUrl);
    const blob = await respBlob.blob();
    const arquivo = new File([blob], `cad_${id}_${indice}.jpg`, { type: 'image/jpeg' });
    let deteccao = null;
    try {
        deteccao = await p3DetectarRostoComQualidade(arquivo);
    } catch (e) {
        // Só chega aqui por algo ESPECÍFICO desta foto (ex.: arquivo
        // corrompido) — falha de CARREGAMENTO de modelo já é checada
        // antes, em cadBuscarESalvarUmaPessoa, e não passa por aqui.
        // Loga em vez de engolir em silêncio — foi exatamente um catch
        // silencioso aqui que escondeu, da vez passada, um problema real
        // de modelo faltando no servidor atrás de um "sem rosto" genérico.
        console.error('[cad-busca-foto] Falha ao detectar rosto em ' + arquivo.name + ':', e);
    }
    return { arquivo, deteccao };
}

// Só devolve o descritor se a detecção passar do piso de confiança pra
// vetor salvo (ver CAD_VETOR_SCORE_MINIMO) — abaixo disso, null (a foto
// ainda é salva como arquivo, só não entra na busca facial).
function cadVetorSeConfiavel_(deteccao) {
    return (deteccao && deteccao.score >= CAD_VETOR_SCORE_MINIMO) ? deteccao.descritor : null;
}

// Fluxo completo pra 1 pessoa: busca no CAD -> se achar, baixa TODAS as
// fotos encontradas e detecta rosto em cada uma ANTES de salvar
// qualquer coisa. A foto com MAIOR confiança de detecção (rosto mais
// nítido/de frente/bem enquadrado) vira a CAPA da pessoa (foto_arquivo
// — a que aparece na lista); TODAS as demais também são salvas como
// arquivo (cada uma na pasta da pessoa — ver p3_salvar_foto_pessoa em
// hostinger-api/config.php), só que com capa:false — e só somam vetor
// se tiverem rosto detectado. Isso evita o caso de o Alcatraz devolver,
// por exemplo, foto de rosto + foto de mão/documento da mesma pessoa e
// a de mão acabar virando a capa só por ter sido a última processada —
// mas ainda assim guarda a foto da mão fisicamente (o pedido aqui foi
// "qualquer imagem daquele indivíduo" salva, não só as com rosto). Se
// NENHUMA foto tiver rosto detectado, a primeira ainda é salva como
// capa (sem vetor) — melhor ter alguma referência visual do que
// nenhuma. Devolve { status } pra UI decidir a mensagem: 'sem_cpf' |
// 'nao_encontrado' | 'erro' | 'salvo'.
async function cadBuscarESalvarUmaPessoa(cfg, tipo, id, cpf) {
    if (!cpf) return { status: 'sem_cpf' };
    let resultado;
    try {
        resultado = await cadBuscarFotoPorCpf(cpf);
    } catch (e) {
        return { status: 'erro', erro: e.message };
    }
    if (!resultado.ok) return { status: 'erro', erro: resultado.erro || 'Erro desconhecido no Apps Script do CAD.' };
    if (!resultado.encontrado || !resultado.fotos || !resultado.fotos.length) return { status: 'nao_encontrado' };

    // Checa os modelos ANTES de processar qualquer foto — se eles não
    // carregarem (ex.: arquivo do modelo faltando no servidor), é melhor
    // falhar alto e claro aqui do que deixar cada foto silenciosamente
    // "sem rosto detectado" (era exatamente isso que escondia o problema
    // antes desta correção).
    try {
        await p3CarregarModelosFaciais();
    } catch (e) {
        return { status: 'erro', erro: 'Falha ao carregar modelos de reconhecimento facial (confira se todos os arquivos de models/face-api/ foram enviados pro servidor): ' + e.message };
    }

    const candidatas = [];
    for (let i = 0; i < resultado.fotos.length; i++) {
        try {
            candidatas.push(await cadBaixarEDetectarFoto_(id, i, resultado.fotos[i]));
        } catch (e) {
            // Falha ao BAIXAR a foto em si (não a detecção) — pula essa,
            // segue com as demais.
        }
    }
    if (!candidatas.length) return { status: 'erro', erro: 'Nenhuma das fotos encontradas pôde ser baixada.' };

    // Maior score primeiro; fotos sem rosto detectado (deteccao: null)
    // vão pro fim — só a MELHOR com rosto vira capa, nunca uma sem rosto
    // se houver alguma alternativa melhor.
    candidatas.sort((a, b) => (b.deteccao ? b.deteccao.score : -1) - (a.deteccao ? a.deteccao.score : -1));
    const capa = candidatas[0];
    const extras = candidatas.slice(1); // TODAS as demais — com ou sem rosto — também são salvas como arquivo.

    const uploadFoto = tipo === 'suspeito' ? P3.Suspeitos.uploadFoto : P3.Autores.uploadFoto;

    let comVetor = 0, salvas = 0;
    try {
        await uploadFoto(cfg, id, capa.arquivo, cadVetorSeConfiavel_(capa.deteccao), { origem: 'cad' });
        salvas++;
        if (cadVetorSeConfiavel_(capa.deteccao)) comVetor++;
    } catch (e) {
        return { status: 'erro', erro: e.message };
    }

    for (const extra of extras) {
        try {
            await uploadFoto(cfg, id, extra.arquivo, cadVetorSeConfiavel_(extra.deteccao), { capa: false, origem: 'cad' });
            salvas++;
            if (cadVetorSeConfiavel_(extra.deteccao)) comVetor++;
        } catch (e) {
            // 1 foto extra falhar não é crítico — a capa (a parte que
            // mais importa visualmente) já foi salva com sucesso.
        }
    }

    return { status: 'salvo', totalFotos: resultado.fotos.length, salvas, comVetor, pessoa: resultado.pessoa };
}
