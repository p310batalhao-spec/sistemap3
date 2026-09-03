// ====================================================================
// Sistema P3 — Autores: Reconhecimento facial (aba "Reconhecimento facial")
// ====================================================================
// Compara uma foto enviada pelo usuário contra os vetores faciais já
// calculados (autores E suspeitos) — a partir de fotos cadastradas pela
// aba "Upload de foto" ou pelo script tools/vetores-faciais/. Este
// arquivo não acessa nada externo, só a API PHP/MySQL do próprio
// sistema. Detecção e cálculo do embedding rodam 100% no navegador
// (js/core/facial-detect.js) — a foto enviada nunca sai do navegador
// além da comparação local.
//
// Resultado é SEMPRE uma estimativa de similaridade (distância
// euclidiana entre embeddings de 128 dimensões), nunca uma identificação
// positiva — daí o aviso fixo na tela e o rótulo "compatibilidade
// estimada" em vez de "identificado".

// RF_DISTANCIA_MEDIA (0.6) é a âncora da curva de rfPercentual — NÃO
// mexer sem recalcular a curva inteira, é o limiar "mesma pessoa" que o
// próprio modelo (face-api.js) documenta. RF_DISTANCIA_ALTA é só o
// corte de cor (verde vs amarelo) — esse sim já foi recalibrado.
const RF_DISTANCIA_ALTA = 0.2;    // abaixo disso: ~90%+, altíssima confiança (verde)
const RF_DISTANCIA_MEDIA = 0.6;   // âncora da curva — abaixo disso: possível, checar com atenção
const RF_MAX_RESULTADOS = 8;
// Esconde da lista quem não bate nem 80% — pedido explícito do usuário,
// depois de ver que 60% deixava passar gente claramente diferente
// misturada com os matches reais. IMPORTANTE: 80% aqui corresponde a
// distância euclidiana ≈0.40 (ver rfPercentual abaixo) — BEM mais
// apertado que o limiar de "mesma pessoa" que o próprio modelo usa
// (~0.6). Ou seja, isso não deixa o reconhecimento "mais inteligente":
// só esconde da lista candidatos na faixa 0.40–0.60 que ainda são
// estatisticamente prováveis de ser a mesma pessoa (fotos de ângulo/
// iluminação pior) — troca ver mais "ruído" por arriscar não mostrar
// alguém que era, sim, a pessoa certa. O aviso de "confirme
// manualmente" continua valendo pro que passa desse limiar.
//
// CONSEQUÊNCIA que já corrigimos aqui: com o limiar em 80% (distância
// ≤0.40), o corte "alta confiança" antigo (0.45) tinha ficado
// matematicamente inatingível — qualquer resultado que passasse do
// limiar de exibição JÁ estava sempre abaixo de 0.45 também, então a
// cor "média" (amarela) nunca mais aparecia, só verde. RF_DISTANCIA_ALTA
// foi recalibrado pra 0.2 (~90%) pra voltar a distinguir "altíssima
// confiança" de "confiança boa, mas confirme com mais atenção" DENTRO
// da faixa que agora é exibida (80–100%).
const RF_LIMIAR_PERCENTUAL_MINIMO = 80;
// Abaixo disso, a detecção do ROSTO PESQUISADO (não do banco) já veio
// fraca — avisa o usuário, já que o resultado inteiro da busca herda
// essa incerteza (ver rfOnArquivoSelecionado).
const RF_SCORE_QUERY_BAIXO = 0.5;

let rfCfg = null;
let rfDescritorAtual = null; // Float32Array(128) da foto enviada
let rfScoreAtual = null;     // confiança da detecção (0-1) da foto pesquisada
let rfUltimosResultados = []; // último resultados renderizados — pro clique abrir o modal de detalhes

function rfSetStatus(msg) {
    const el = document.getElementById('rf-status-msg');
    if (el) el.textContent = msg || '';
}

function rfClasseScore(distancia) {
    if (distancia <= RF_DISTANCIA_ALTA) return 'rf-score-alta';
    if (distancia <= RF_DISTANCIA_MEDIA) return 'rf-score-media';
    return 'rf-score-baixa';
}

// Mapeamento heurístico distância -> "%": não é uma probabilidade
// estatística de verdade (o modelo não devolve isso), é só uma forma
// mais legível de mostrar a distância pra quem não vai interpretar
// "0.42" de cabeça. Curva em 2 trechos (não linear simples) porque uma
// reta de 0 a 1.2 "achatava" demais os matches bons — uma distância de
// 0.45 (bem provável ser a mesma pessoa) virava só 62%, o que lia como
// "meio incerto" sem ser. Duas âncoras: distância 0 -> 100%, distância
// RF_DISTANCIA_MEDIA (0.6, limiar usual de "ainda pode ser a mesma
// pessoa" pra este modelo) -> 70%, distância RF_DISTANCIA_MEDIA*2 -> 0%.
function rfPercentual(distancia) {
    const ancoraMedia = RF_DISTANCIA_MEDIA;
    const ancoraZero = RF_DISTANCIA_MEDIA * 2;
    let pct;
    if (distancia <= ancoraMedia) {
        pct = 100 - (distancia / ancoraMedia) * 30;
    } else {
        pct = 70 - ((distancia - ancoraMedia) / (ancoraZero - ancoraMedia)) * 70;
    }
    return Math.round(Math.max(0, Math.min(100, pct)));
}

// `vetorFacial` de cada candidato agora é uma LISTA de embeddings (uma
// pessoa pode ter várias fotos salvas — ver p3_acrescentar_vetor_facial
// em hostinger-api/config.php), não mais um só. Usa a MENOR distância
// entre a foto pesquisada e qualquer uma das fotos salvas da pessoa.
// Trata também o formato antigo (1 embedding solto, sem lista), pra não
// quebrar com dado gravado antes dessa mudança.
function rfMenorDistancia(vetorFacial, descritorAlvo) {
    if (!Array.isArray(vetorFacial) || !vetorFacial.length) return Infinity;
    const listaVetores = typeof vetorFacial[0] === 'number' ? [vetorFacial] : vetorFacial;
    let menor = Infinity;
    for (const v of listaVetores) {
        const d = faceapi.euclideanDistance(descritorAlvo, v);
        if (d < menor) menor = d;
    }
    return menor;
}

async function rfOnArquivoSelecionado(e) {
    const arquivo = e.target.files && e.target.files[0];
    const preview = document.getElementById('rf-preview');
    const btnBuscar = document.getElementById('rf-btn-buscar');
    rfDescritorAtual = null;
    rfScoreAtual = null;
    btnBuscar.disabled = true;
    document.getElementById('rf-resultados').innerHTML = '';

    if (!arquivo) {
        preview.innerHTML = 'Nenhuma imagem selecionada';
        return;
    }

    const url = URL.createObjectURL(arquivo);
    preview.innerHTML = `<img src="${url}" alt="Foto enviada">`;

    try {
        rfSetStatus('Carregando modelos e detectando rosto...');
        const resultado = await p3DetectarRostoComQualidade(arquivo);
        if (!resultado) {
            rfSetStatus('Nenhum rosto detectado nesta imagem — tente outra foto (rosto de frente, boa iluminação).');
            return;
        }
        rfDescritorAtual = resultado.descritor;
        rfScoreAtual = resultado.score;
        // A busca compara contra um EMBEDDING calculado em cima desta
        // detecção — se a detecção em si já foi de baixa confiança (rosto
        // pequeno/de lado/mal iluminado), o embedding tende a ser menos
        // discriminativo, e qualquer resultado da busca herda essa
        // incerteza extra. Avisar aqui é mais honesto do que deixar a
        // pessoa achar que um resultado de 85% é igualmente confiável não
        // importa a qualidade da foto que ela mesma enviou.
        rfSetStatus(resultado.score < RF_SCORE_QUERY_BAIXO
            ? `⚠️ Rosto detectado, mas com confiança baixa (${Math.round(resultado.score * 100)}%) — tente uma foto de frente com melhor luz se der. Clique em "Buscar compatibilidade" mesmo assim, se quiser.`
            : 'Rosto detectado. Clique em "Buscar compatibilidade".');
        btnBuscar.disabled = false;
    } catch (err) {
        console.error('[reconhecimento-facial] Erro ao processar imagem:', err);
        rfSetStatus('Erro ao processar a imagem: ' + err.message);
    }
}

function rfEscaparHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rfMontarUrlFoto(resultado) {
    const apiPhp = rfCfg && rfCfg.apiPhp;
    if (!apiPhp || !resultado.fotoArquivo) return null;
    const base = resultado.tipo === 'suspeito' ? apiPhp.fotosSuspeitosBaseUrl
        : resultado.tipo === 'echelonx' ? apiPhp.fotosEchelonxBaseUrl
        : resultado.tipo === 'cerbero' ? apiPhp.fotosCerberoBaseUrl
        : apiPhp.fotosAutoresBaseUrl;
    if (!base) return null;
    return base.replace(/\/+$/, '') + '/' + resultado.fotoArquivo;
}

function rfRotuloTipo(tipo) {
    if (tipo === 'suspeito') return 'Suspeito';
    if (tipo === 'echelonx') return 'Echelonx';
    if (tipo === 'cerbero') return 'Cérbero';
    return 'Autor';
}

function rfRenderResultados(resultados, temCandidatos) {
    const wrap = document.getElementById('rf-resultados');
    rfUltimosResultados = resultados;
    if (!resultados.length) {
        wrap.innerHTML = temCandidatos
            ? `<div class="empty-msg">Nenhum resultado com compatibilidade ≥ ${RF_LIMIAR_PERCENTUAL_MINIMO}% — a pessoa da foto pode não estar cadastrada, ou nenhuma foto salva bate o suficiente.</div>`
            : '<div class="empty-msg">Nenhum autor/suspeito com vetor facial cadastrado ainda — use a aba "Upload de foto".</div>';
        return;
    }
    wrap.innerHTML = resultados.map(r => {
        const urlFoto = rfMontarUrlFoto(r);
        const thumb = urlFoto
            ? `<img class="rf-resultado-thumb" src="${rfEscaparHtml(urlFoto)}" alt="">`
            : `<div class="rf-resultado-thumb"></div>`;
        const rotuloTipo = rfRotuloTipo(r.tipo);
        return `
            <div class="rf-resultado-item" data-rf-id="${rfEscaparHtml(r.id)}" data-rf-tipo="${rfEscaparHtml(r.tipo)}" title="Ver detalhes">
                ${thumb}
                <div class="rf-resultado-info">
                    <div class="rf-resultado-nome">${rfEscaparHtml(r.NOME)} <span style="font-weight:400;font-size:11px;opacity:.65;">(${rotuloTipo})</span></div>
                    <div class="rf-resultado-cpf">CPF ${rfEscaparHtml(r.CPF || '—')} · distância ${r.distancia.toFixed(3)}</div>
                </div>
                <div class="rf-resultado-score ${rfClasseScore(r.distancia)}">${rfPercentual(r.distancia)}%</div>
            </div>`;
    }).join('');
}

async function rfBuscarCompatibilidade() {
    if (!rfDescritorAtual) return;
    const btnBuscar = document.getElementById('rf-btn-buscar');
    btnBuscar.disabled = true;
    rfSetStatus('Comparando com autores e suspeitos cadastrados...');

    try {
        // Echelonx/Cérbero são opcionais/best-effort — se a API ainda não
        // foi implantada no servidor (ou nunca rodou a sincronização/
        // importação), não pode derrubar a busca em autores/suspeitos.
        const [vetoresAutores, vetoresSuspeitos, vetoresEchelonx, vetoresCerbero] = await Promise.all([
            P3.Autores.listarVetores(rfCfg),
            P3.Suspeitos.listarVetores(rfCfg),
            P3.PessoasEchelonx.listarVetores(rfCfg).catch(err => {
                console.warn('[reconhecimento-facial] echelonx indisponível:', err.message);
                return {};
            }),
            P3.Cerbero.listarVetores(rfCfg).catch(err => {
                console.warn('[reconhecimento-facial] cerbero indisponível:', err.message);
                return {};
            })
        ]);
        const candidatos = [
            ...Object.entries(vetoresAutores || {}).map(([id, a]) => Object.assign({ id, tipo: 'autor' }, a)),
            ...Object.entries(vetoresSuspeitos || {}).map(([id, s]) => Object.assign({ id, tipo: 'suspeito' }, s)),
            ...Object.entries(vetoresEchelonx || {}).map(([id, p]) => Object.assign({ id, tipo: 'echelonx' }, p)),
            ...Object.entries(vetoresCerbero || {}).map(([id, p]) => Object.assign({ id, tipo: 'cerbero' }, p))
        ].filter(a => Array.isArray(a.vetorFacial) && a.vetorFacial.length);

        const resultados = candidatos
            .map(a => ({
                id: a.id,
                NOME: a.NOME,
                CPF: a.CPF,
                tipo: a.tipo,
                fotoArquivo: a.fotoArquivo,
                distancia: rfMenorDistancia(a.vetorFacial, rfDescritorAtual)
            }))
            .filter(r => rfPercentual(r.distancia) >= RF_LIMIAR_PERCENTUAL_MINIMO)
            .sort((a, b) => a.distancia - b.distancia)
            .slice(0, RF_MAX_RESULTADOS);

        rfRenderResultados(resultados, candidatos.length > 0);
        const avisoQualidade = rfScoreAtual != null && rfScoreAtual < RF_SCORE_QUERY_BAIXO
            ? ` ⚠️ Detecção do rosto pesquisado com confiança baixa (${Math.round(rfScoreAtual * 100)}%) — leve isso em conta, o resultado pode ser menos confiável que o normal.`
            : '';
        rfSetStatus(`${candidatos.length} pessoa(s) na base de comparação — ${resultados.length} com compatibilidade ≥ ${RF_LIMIAR_PERCENTUAL_MINIMO}% (confirme manualmente antes de qualquer decisão).${avisoQualidade}`);
    } catch (err) {
        console.error('[reconhecimento-facial] Erro ao buscar compatibilidade:', err);
        rfSetStatus('Erro ao buscar: ' + err.message);
    } finally {
        btnBuscar.disabled = false;
    }
}

// Clique no resultado abre o modal de detalhes (js/pessoa-modal.js) com o
// registro mais completo disponível: autor/suspeito são procurados nos
// arrays já carregados por js/autores.js e js/suspeitos.js (mesma página,
// mesmo escopo global) — echelonx não tem lista completa carregada aqui,
// então usa o próprio resultado esparso (NOME/CPF/fotoArquivo/distância);
// o cruzamento por CPF que o modal já faz sozinho complementa o resto.
function rfAbrirDetalhes(id, tipo) {
    const resultado = rfUltimosResultados.find(r => String(r.id) === String(id) && r.tipo === tipo);
    if (!resultado) return;

    let registro = resultado;
    if (tipo === 'autor' && typeof todosAutores !== 'undefined') {
        registro = todosAutores.find(a => a._id === id) || resultado;
    } else if (tipo === 'suspeito' && typeof todosSuspeitos !== 'undefined') {
        registro = todosSuspeitos.find(s => String(s.id) === String(id)) || resultado;
    }
    // Sempre inclui a distância deste resultado específico, mesmo quando o
    // registro completo veio de todosAutores/todosSuspeitos (que não tem
    // esse campo — é calculado só na busca).
    registro = Object.assign({}, registro, { distancia: resultado.distancia });

    PessoaModal.abrir({ cfg: rfCfg, tipo, registro });
}

document.addEventListener('DOMContentLoaded', async function () {
    if (!P3.requireAuth()) return;

    try { rfCfg = await P3.loadUnidadeConfig(); } catch (e) { console.warn('[reconhecimento-facial] loadUnidadeConfig:', e.message); }

    const inputFoto = document.getElementById('rf-input-foto');
    const btnBuscar = document.getElementById('rf-btn-buscar');
    if (!inputFoto || !btnBuscar) return; // página sem esta aba (não deveria acontecer, mas evita quebrar)

    if (!rfCfg || !P3.Autores.usaApiPhp(rfCfg)) {
        rfSetStatus('Reconhecimento facial só está disponível para o 10º BPM (fonte de dados Hostinger).');
        inputFoto.disabled = true;
        return;
    }

    inputFoto.addEventListener('change', rfOnArquivoSelecionado);
    btnBuscar.addEventListener('click', rfBuscarCompatibilidade);

    document.getElementById('rf-resultados').addEventListener('click', function (e) {
        const item = e.target.closest('.rf-resultado-item');
        if (item) rfAbrirDetalhes(item.dataset.rfId, item.dataset.rfTipo);
    });
});
