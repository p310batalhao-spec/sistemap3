// ====================================================================
// Sistema P3 — Busca facial (Operador de Campo)
// ====================================================================
// Página isolada, restrita ao nível "operador_campo" (ou admin) — ver
// P3.requireOperadorCampo em js/core/session.js. Reaproveita o MESMO
// motor de comparação de js/autores-reconhecimento-facial.js (mesma
// regra de distância/percentual/limiar — ver comentário lá pra
// explicação completa das âncoras da curva e do porquê do limiar ser
// 80%, não 60%), mas com upload via arquivo OU câmera, e complementa
// com a checagem de mandado de prisão (BNMP) quando o operador clica
// na foto de uma pessoa encontrada.

// RF_DISTANCIA_ALTA foi recalibrado pra 0.2 (~90%) em
// autores-reconhecimento-facial.js — mesmo motivo aqui: com o limiar de
// exibição em 80% (distância ≤0.40), o corte antigo de 0.45 tinha
// ficado inatingível (ver comentário completo lá).
const BFC_DISTANCIA_ALTA = 0.2;
const BFC_DISTANCIA_MEDIA = 0.6;
const BFC_LIMIAR_PERCENTUAL_MINIMO = 80;
const BFC_MAX_RESULTADOS = 8;

// Mesma URL do projeto Apps Script de rastreamento já usada em
// js/cad-busca-foto.js e js/preditivaCAD.js — duplicada aqui (não
// incluímos aquele arquivo nesta página) só pra não criar uma
// dependência entre scripts que, no resto, não têm nada a ver.
const GAS_CAD_URL_BFC = 'https://script.google.com/macros/s/AKfycbwuyKpN4AbmV_CmQfZr2olClY1JveArwKEcJE3__DFf74xfnd3AlhXqnde7RPkXDlqx/exec';

// Mesmo motivo de RF_SCORE_QUERY_BAIXO em autores-reconhecimento-facial.js.
const BFC_SCORE_QUERY_BAIXO = 0.5;

let bfcCfg = null;
let bfcDescritorAtual = null;
let bfcScoreAtual = null;
let bfcStreamCamera = null;

function bfcSetStatus(msg) {
    const el = document.getElementById('bfc-status-msg');
    if (el) el.textContent = msg || '';
}

function bfcClasseScore(distancia) {
    if (distancia <= BFC_DISTANCIA_ALTA) return 'rf-score-alta';
    if (distancia <= BFC_DISTANCIA_MEDIA) return 'rf-score-media';
    return 'rf-score-baixa';
}

// Mesma curva de js/autores-reconhecimento-facial.js:rfPercentual.
function bfcPercentual(distancia) {
    const ancoraMedia = BFC_DISTANCIA_MEDIA;
    const ancoraZero = BFC_DISTANCIA_MEDIA * 2;
    let pct;
    if (distancia <= ancoraMedia) {
        pct = 100 - (distancia / ancoraMedia) * 30;
    } else {
        pct = 70 - ((distancia - ancoraMedia) / (ancoraZero - ancoraMedia)) * 70;
    }
    return Math.round(Math.max(0, Math.min(100, pct)));
}

function bfcMenorDistancia(vetorFacial, descritorAlvo) {
    if (!Array.isArray(vetorFacial) || !vetorFacial.length) return Infinity;
    const listaVetores = typeof vetorFacial[0] === 'number' ? [vetorFacial] : vetorFacial;
    let menor = Infinity;
    for (const v of listaVetores) {
        const d = faceapi.euclideanDistance(descritorAlvo, v);
        if (d < menor) menor = d;
    }
    return menor;
}

function bfcEscaparHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function bfcMontarUrlFoto(resultado) {
    const apiPhp = bfcCfg && bfcCfg.apiPhp;
    if (!apiPhp || !resultado.fotoArquivo) return null;
    const base = resultado.tipo === 'suspeito' ? apiPhp.fotosSuspeitosBaseUrl
        : resultado.tipo === 'echelonx' ? apiPhp.fotosEchelonxBaseUrl
        : apiPhp.fotosAutoresBaseUrl;
    if (!base) return null;
    return base.replace(/\/+$/, '') + '/' + resultado.fotoArquivo;
}

function bfcRotuloTipo(tipo) {
    if (tipo === 'suspeito') return 'Suspeito';
    if (tipo === 'echelonx') return 'Echelonx';
    return 'Autor';
}

// ====================================================================
// FOTO — arquivo ou câmera caem aqui, tratados igual a partir daqui.
// ====================================================================
async function bfcProcessarArquivo(arquivo) {
    const preview = document.getElementById('bfc-preview');
    const btnBuscar = document.getElementById('bfc-btn-buscar');
    bfcDescritorAtual = null;
    bfcScoreAtual = null;
    btnBuscar.disabled = true;
    document.getElementById('bfc-resultados').innerHTML = '';

    if (!arquivo) {
        preview.innerHTML = 'Nenhuma imagem selecionada';
        return;
    }

    const url = URL.createObjectURL(arquivo);
    preview.innerHTML = `<img src="${url}" alt="Foto enviada">`;

    try {
        bfcSetStatus('Carregando modelos e detectando rosto...');
        const resultado = await p3DetectarRostoComQualidade(arquivo);
        if (!resultado) {
            bfcSetStatus('Nenhum rosto detectado nesta imagem — tente outra foto (rosto de frente, boa iluminação).');
            return;
        }
        bfcDescritorAtual = resultado.descritor;
        bfcScoreAtual = resultado.score;
        // Ver comentário equivalente em autores-reconhecimento-facial.js
        // (rfOnArquivoSelecionado) — detecção fraca no rosto pesquisado
        // deixa o resultado inteiro menos confiável.
        bfcSetStatus(resultado.score < BFC_SCORE_QUERY_BAIXO
            ? `⚠️ Rosto detectado, mas com confiança baixa (${Math.round(resultado.score * 100)}%) — tente outra foto/ângulo se der. Pode buscar mesmo assim.`
            : 'Rosto detectado. Clique em "Buscar compatibilidade".');
        btnBuscar.disabled = false;
    } catch (err) {
        console.error('[busca-facial-campo] Erro ao processar imagem:', err);
        bfcSetStatus('Erro ao processar a imagem: ' + err.message);
    }
}

// ====================================================================
// CÂMERA — getUserMedia + captura num <canvas>, convertido pra File e
// tratado exatamente como se tivesse vindo do input de arquivo.
// ====================================================================
async function bfcAbrirCamera() {
    const modal = document.getElementById('bfc-modal-camera');
    const video = document.getElementById('bfc-video');
    try {
        bfcStreamCamera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        video.srcObject = bfcStreamCamera;
        modal.classList.add('aberto');
    } catch (err) {
        alert('Não foi possível acessar a câmera: ' + err.message);
    }
}

function bfcFecharCamera() {
    document.getElementById('bfc-modal-camera').classList.remove('aberto');
    if (bfcStreamCamera) {
        bfcStreamCamera.getTracks().forEach(t => t.stop());
        bfcStreamCamera = null;
    }
}

function bfcCapturarFoto() {
    const video = document.getElementById('bfc-video');
    const canvas = document.getElementById('bfc-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
        const arquivo = new File([blob], 'camera_' + Date.now() + '.jpg', { type: 'image/jpeg' });
        bfcFecharCamera();
        bfcProcessarArquivo(arquivo);
    }, 'image/jpeg', 0.92);
}

// ====================================================================
// BUSCA DE COMPATIBILIDADE — mesma lógica de autores-reconhecimento-facial.js
// ====================================================================
function bfcRenderResultados(resultados, temCandidatos) {
    const wrap = document.getElementById('bfc-resultados');
    if (!resultados.length) {
        wrap.innerHTML = temCandidatos
            ? `<div class="empty-msg">Nenhum resultado com compatibilidade ≥ ${BFC_LIMIAR_PERCENTUAL_MINIMO}% — a pessoa pode não estar cadastrada, ou nenhuma foto salva bate o suficiente.</div>`
            : '<div class="empty-msg">Nenhum autor/suspeito com vetor facial cadastrado ainda.</div>';
        wrap.dataset.resultados = '[]';
        return;
    }
    wrap.innerHTML = resultados.map((r, idx) => {
        const urlFoto = bfcMontarUrlFoto(r);
        const thumb = urlFoto
            ? `<img class="rf-resultado-thumb bfc-foto-clicavel" data-idx="${idx}" src="${bfcEscaparHtml(urlFoto)}" alt="" title="Clique pra ver detalhes e checar mandado de prisão (BNMP)">`
            : `<div class="rf-resultado-thumb"></div>`;
        const rotuloTipo = bfcRotuloTipo(r.tipo);
        return `
            <div class="rf-resultado-item">
                ${thumb}
                <div class="rf-resultado-info">
                    <div class="rf-resultado-nome">${bfcEscaparHtml(r.NOME)} <span style="font-weight:400;font-size:11px;opacity:.65;">(${rotuloTipo})</span></div>
                    <div class="rf-resultado-cpf">CPF ${bfcEscaparHtml(r.CPF || '—')} · distância ${r.distancia.toFixed(3)}</div>
                </div>
                <div class="rf-resultado-score ${bfcClasseScore(r.distancia)}">${bfcPercentual(r.distancia)}%</div>
            </div>`;
    }).join('');

    // Guarda os resultados renderizados (sem o vetor, só o necessário
    // pro modal) pra abrir o detalhe ao clicar na foto sem precisar
    // refazer a busca.
    wrap.dataset.resultados = JSON.stringify(resultados.map(r => ({
        NOME: r.NOME, CPF: r.CPF, fotoArquivo: r.fotoArquivo, tipo: r.tipo
    })));
}

async function bfcBuscarCompatibilidade() {
    if (!bfcDescritorAtual) return;
    const btnBuscar = document.getElementById('bfc-btn-buscar');
    btnBuscar.disabled = true;
    bfcSetStatus('Comparando com autores e suspeitos cadastrados...');

    try {
        // Echelonx é opcional/best-effort — ver comentário equivalente em
        // js/autores-reconhecimento-facial.js.
        const [vetoresAutores, vetoresSuspeitos, vetoresEchelonx] = await Promise.all([
            P3.Autores.listarVetores(bfcCfg),
            P3.Suspeitos.listarVetores(bfcCfg),
            P3.PessoasEchelonx.listarVetores(bfcCfg).catch(err => {
                console.warn('[busca-facial-campo] echelonx indisponível:', err.message);
                return {};
            })
        ]);
        const candidatos = [
            ...Object.values(vetoresAutores || {}).map(a => Object.assign({ tipo: 'autor' }, a)),
            ...Object.values(vetoresSuspeitos || {}).map(s => Object.assign({ tipo: 'suspeito' }, s)),
            ...Object.values(vetoresEchelonx || {}).map(p => Object.assign({ tipo: 'echelonx' }, p))
        ].filter(a => Array.isArray(a.vetorFacial) && a.vetorFacial.length);

        const resultados = candidatos
            .map(a => ({
                NOME: a.NOME,
                CPF: a.CPF,
                tipo: a.tipo,
                fotoArquivo: a.fotoArquivo,
                distancia: bfcMenorDistancia(a.vetorFacial, bfcDescritorAtual)
            }))
            .filter(r => bfcPercentual(r.distancia) >= BFC_LIMIAR_PERCENTUAL_MINIMO)
            .sort((a, b) => a.distancia - b.distancia)
            .slice(0, BFC_MAX_RESULTADOS);

        bfcRenderResultados(resultados, candidatos.length > 0);
        const avisoQualidade = bfcScoreAtual != null && bfcScoreAtual < BFC_SCORE_QUERY_BAIXO
            ? ` ⚠️ Detecção do rosto pesquisado com confiança baixa (${Math.round(bfcScoreAtual * 100)}%) — resultado pode ser menos confiável.`
            : '';
        bfcSetStatus(`${candidatos.length} pessoa(s) na base de comparação — ${resultados.length} com compatibilidade ≥ ${BFC_LIMIAR_PERCENTUAL_MINIMO}% (confirme manualmente antes de qualquer decisão. Clique na foto pra ver nome, CPF e checar mandado de prisão).${avisoQualidade}`);
    } catch (err) {
        console.error('[busca-facial-campo] Erro ao buscar:', err);
        bfcSetStatus('Erro ao buscar: ' + err.message);
    } finally {
        btnBuscar.disabled = false;
    }
}

// ====================================================================
// MODAL DE PESSOA (foto clicável) — nome completo, CPF e status do BNMP
// ====================================================================
async function bfcConsultarBnmp(cpf) {
    const cpfLimpo = String(cpf || '').replace(/\D/g, '');
    const resp = await fetch(`${GAS_CAD_URL_BFC}?acao=buscar_mandado_prisao&cpf=${cpfLimpo}`);
    return await resp.json();
}

async function bfcAbrirModalPessoa(idx) {
    const wrap = document.getElementById('bfc-resultados');
    let lista = [];
    try { lista = JSON.parse(wrap.dataset.resultados || '[]'); } catch (e) { /* ignora */ }
    const pessoa = lista[idx];
    if (!pessoa) return;

    document.getElementById('bfc-modal-pessoa-nome').textContent = pessoa.NOME || '—';
    document.getElementById('bfc-modal-pessoa-cpf').textContent = 'CPF ' + (pessoa.CPF || '—');
    document.getElementById('bfc-modal-pessoa-foto').src = bfcMontarUrlFoto(pessoa) || '';
    document.getElementById('bfc-modal-pessoa').classList.add('aberto');

    const bnmpEl = document.getElementById('bfc-modal-pessoa-bnmp');
    bnmpEl.className = 'bfc-bnmp-status';
    bnmpEl.textContent = 'Consultando mandado de prisão (BNMP)...';

    if (!pessoa.CPF) {
        bnmpEl.className = 'bfc-bnmp-status bfc-bnmp-erro';
        bnmpEl.textContent = 'Sem CPF cadastrado — não foi possível consultar o BNMP.';
        return;
    }
    try {
        const resultado = await bfcConsultarBnmp(pessoa.CPF);
        if (!resultado.ok) {
            bnmpEl.className = 'bfc-bnmp-status bfc-bnmp-erro';
            bnmpEl.textContent = 'Não foi possível consultar o BNMP: ' + (resultado.erro || 'desconhecido');
        } else if (resultado.temMandado) {
            bnmpEl.className = 'bfc-bnmp-status bfc-bnmp-alerta';
            bnmpEl.innerHTML = '🚨 MANDADO DE PRISÃO ENCONTRADO NO BNMP' + (resultado.detalhe ? ' — ' + bfcEscaparHtml(resultado.detalhe) : '') +
                (resultado.avisoDebug ? `<div style="font-size:11px;font-weight:400;margin-top:6px;opacity:.85;">⚠️ ${bfcEscaparHtml(resultado.avisoDebug)}</div>` : '');
        } else {
            bnmpEl.className = 'bfc-bnmp-status bfc-bnmp-ok';
            bnmpEl.textContent = '✅ Nenhum mandado de prisão encontrado no BNMP para este CPF.';
        }
    } catch (err) {
        bnmpEl.className = 'bfc-bnmp-status bfc-bnmp-erro';
        bnmpEl.textContent = 'Não foi possível consultar o BNMP: ' + err.message;
    }
}

function bfcFecharModalPessoa() {
    document.getElementById('bfc-modal-pessoa').classList.remove('aberto');
}

document.addEventListener('DOMContentLoaded', async function () {
    const sessao = P3.requireOperadorCampo();
    if (!sessao) return;

    try { bfcCfg = await P3.loadUnidadeConfig(); } catch (e) { console.warn('[busca-facial-campo] loadUnidadeConfig:', e.message); }
    if (!bfcCfg || !P3.Autores.usaApiPhp(bfcCfg)) {
        bfcSetStatus('Busca facial só está disponível para o 10º BPM (fonte de dados Hostinger).');
        document.getElementById('bfc-input-foto').disabled = true;
        document.getElementById('bfc-btn-camera').disabled = true;
        return;
    }

    document.getElementById('bfc-input-foto').addEventListener('change', e => {
        const arquivo = e.target.files && e.target.files[0];
        if (arquivo) bfcProcessarArquivo(arquivo);
    });
    document.getElementById('bfc-btn-buscar').addEventListener('click', bfcBuscarCompatibilidade);
    document.getElementById('bfc-btn-camera').addEventListener('click', bfcAbrirCamera);
    document.getElementById('bfc-btn-capturar').addEventListener('click', bfcCapturarFoto);
    document.getElementById('bfc-btn-cancelar-camera').addEventListener('click', bfcFecharCamera);
    document.getElementById('bfc-btn-fechar-pessoa').addEventListener('click', bfcFecharModalPessoa);

    document.getElementById('bfc-resultados').addEventListener('click', e => {
        const foto = e.target.closest('.bfc-foto-clicavel');
        if (foto) bfcAbrirModalPessoa(Number(foto.dataset.idx));
    });
});
