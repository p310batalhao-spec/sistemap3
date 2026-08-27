// ====================================================================
// Sistema P3 — Autores: Upload de foto (aba "Upload de foto")
// ====================================================================
// Busca um autor OU suspeito (nome/CPF), permite escolher uma foto e
// salva no servidor Hostinger — detecta o rosto e calcula o embedding
// no navegador (js/core/facial-detect.js) e manda tudo numa chamada só
// (POST multipart ?action=uploadFoto em autores.php/suspeitos.php).
// A foto não precisa ter rosto detectável pra ser salva (fica só sem
// vetor, não aparece na busca de "Reconhecimento facial" até alguém
// subir uma foto onde o rosto seja detectado).
//
// Cada envio ACRESCENTA um vetor à lista da pessoa (até 5 fotos, ver
// p3_acrescentar_vetor_facial em hostinger-api/config.php) — não
// substitui os anteriores. Subir mais de uma foto da mesma pessoa (
// ângulos/iluminação diferentes) melhora a qualidade do reconhecimento
// depois, porque a busca compara contra a MELHOR referência salva, não
// só a última.

const UF_SCORE_BAIXO = 0.5; // mesmo limiar usado nas telas de busca — abaixo disso, avisa mas não bloqueia (a foto ainda pode ser a única referência disponível dessa pessoa).

let ufCfg = null;
let ufSelecionado = null; // { tipo: 'autor'|'suspeito', id, NOME, CPF }
let ufDescritorAtual = null;
let ufScoreAtual = null;
let ufBuscaDebounce = null;

function ufSetStatus(msg) {
    const el = document.getElementById('uf-status-msg');
    if (el) el.textContent = msg || '';
}

function ufEscaparHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function ufBuscarPessoas(termo) {
    const somenteDigitos = /^\d+$/.test(termo.replace(/\D/g, '')) && termo.replace(/\D/g, '').length >= 3;
    const filtro = somenteDigitos ? { cpf: termo } : { nome: termo };

    const [autores, suspeitos] = await Promise.all([
        P3.Autores.buscar(ufCfg, filtro).catch(() => ({})),
        P3.Suspeitos.buscar(ufCfg, filtro).catch(() => ({}))
    ]);

    const resultado = [];
    Object.entries(autores || {}).forEach(([id, a]) => {
        if (a && a.NOME && a.NOME !== '---') resultado.push({ tipo: 'autor', id, NOME: a.NOME, CPF: a.CPF });
    });
    Object.entries(suspeitos || {}).forEach(([id, s]) => {
        if (s && s.NOME) resultado.push({ tipo: 'suspeito', id: String(id), NOME: s.NOME, CPF: s.CPF });
    });
    return resultado.slice(0, 20);
}

function ufRenderResultadosBusca(pessoas) {
    const wrap = document.getElementById('uf-resultados-busca');
    if (!pessoas.length) {
        wrap.innerHTML = '<div class="uf-item-pessoa" style="cursor:default;">Nenhum resultado.</div>';
        wrap.style.display = '';
        return;
    }
    wrap.innerHTML = pessoas.map((p, idx) => `
        <div class="uf-item-pessoa" data-idx="${idx}">
            <span>${ufEscaparHtml(p.NOME)} <span style="opacity:.6;font-size:11px;">CPF ${ufEscaparHtml(p.CPF || '—')}</span></span>
            <span class="uf-tipo-badge">${p.tipo === 'suspeito' ? 'Suspeito' : 'Autor'}</span>
        </div>`).join('');
    wrap.style.display = '';
    wrap.dataset.pessoas = JSON.stringify(pessoas);
}

function ufSelecionarPessoa(pessoa) {
    ufSelecionado = pessoa;
    document.getElementById('uf-busca-input').value = '';
    document.getElementById('uf-resultados-busca').style.display = 'none';

    const rotulo = pessoa.tipo === 'suspeito' ? 'Suspeito' : 'Autor';
    document.getElementById('uf-selecionado-texto').innerHTML =
        `<strong>${ufEscaparHtml(pessoa.NOME)}</strong> — CPF ${ufEscaparHtml(pessoa.CPF || '—')} (${rotulo})`;
    document.getElementById('uf-selecionado').style.display = '';
    document.getElementById('uf-upload-area').style.display = '';

    // Reseta qualquer foto/estado da seleção anterior.
    ufDescritorAtual = null;
    ufScoreAtual = null;
    document.getElementById('uf-input-foto').value = '';
    document.getElementById('uf-preview').innerHTML = 'Nenhuma imagem selecionada';
    document.getElementById('uf-btn-salvar').disabled = true;
    ufSetStatus('');
}

function ufTrocarPessoa() {
    ufSelecionado = null;
    document.getElementById('uf-selecionado').style.display = 'none';
    document.getElementById('uf-upload-area').style.display = 'none';
    document.getElementById('uf-busca-input').focus();
}

async function ufOnArquivoSelecionado(e) {
    const arquivo = e.target.files && e.target.files[0];
    const preview = document.getElementById('uf-preview');
    const btnSalvar = document.getElementById('uf-btn-salvar');
    ufDescritorAtual = null;
    ufScoreAtual = null;
    btnSalvar.disabled = true;

    if (!arquivo) {
        preview.innerHTML = 'Nenhuma imagem selecionada';
        return;
    }

    preview.innerHTML = `<img src="${URL.createObjectURL(arquivo)}" alt="Foto selecionada">`;

    try {
        ufSetStatus('Detectando rosto na imagem...');
        const resultado = await p3DetectarRostoComQualidade(arquivo);
        if (resultado) {
            ufDescritorAtual = resultado.descritor;
            ufScoreAtual = resultado.score;
            ufSetStatus(resultado.score < UF_SCORE_BAIXO
                ? `⚠️ Rosto detectado, mas com confiança baixa (${Math.round(resultado.score * 100)}%) — se tiver uma foto melhor (mais nítida, rosto de frente), prefira ela. Ainda assim dá pra salvar esta.`
                : 'Rosto detectado — esta foto será somada às referências já salvas dessa pessoa.');
        } else {
            ufSetStatus('Nenhum rosto detectado — a foto será salva mesmo assim, mas não entrará na busca por reconhecimento facial.');
        }
        btnSalvar.disabled = false;
    } catch (err) {
        console.error('[upload-foto] Erro ao detectar rosto:', err);
        ufSetStatus('Erro ao processar a imagem (' + err.message + ') — você ainda pode salvar sem detecção.');
        btnSalvar.disabled = false;
    }
}

async function ufSalvarFoto() {
    const arquivo = document.getElementById('uf-input-foto').files[0];
    if (!ufSelecionado || !arquivo) return;

    const btnSalvar = document.getElementById('uf-btn-salvar');
    btnSalvar.disabled = true;
    ufSetStatus('Enviando...');

    try {
        const fn = ufSelecionado.tipo === 'suspeito' ? P3.Suspeitos.uploadFoto : P3.Autores.uploadFoto;
        await fn(ufCfg, ufSelecionado.id, arquivo, ufDescritorAtual);
        const avisoQualidade = ufScoreAtual != null && ufScoreAtual < UF_SCORE_BAIXO
            ? ` ⚠️ Confiança da detecção foi baixa (${Math.round(ufScoreAtual * 100)}%) — considere subir outra foto dessa pessoa quando possível.`
            : '';
        ufSetStatus('Foto salva com sucesso' + (ufDescritorAtual ? ' (com vetor facial).' : ' (sem vetor facial — nenhum rosto detectado).') + avisoQualidade);
    } catch (err) {
        console.error('[upload-foto] Erro ao salvar:', err);
        ufSetStatus('Erro ao salvar: ' + err.message);
        btnSalvar.disabled = false;
    }
}

document.addEventListener('DOMContentLoaded', async function () {
    if (!P3.requireAuth()) return;

    try { ufCfg = await P3.loadUnidadeConfig(); } catch (e) { console.warn('[upload-foto] loadUnidadeConfig:', e.message); }

    const buscaInput = document.getElementById('uf-busca-input');
    if (!buscaInput) return; // página sem esta aba

    if (!ufCfg || !P3.Autores.usaApiPhp(ufCfg)) {
        buscaInput.disabled = true;
        buscaInput.placeholder = 'Upload de foto só está disponível para o 10º BPM.';
        return;
    }

    buscaInput.addEventListener('input', function () {
        const termo = buscaInput.value.trim();
        clearTimeout(ufBuscaDebounce);
        if (termo.length < 2) {
            document.getElementById('uf-resultados-busca').style.display = 'none';
            return;
        }
        ufBuscaDebounce = setTimeout(async () => {
            try {
                const pessoas = await ufBuscarPessoas(termo);
                ufRenderResultadosBusca(pessoas);
            } catch (err) {
                console.error('[upload-foto] Erro na busca:', err);
            }
        }, 300);
    });

    document.getElementById('uf-resultados-busca').addEventListener('click', function (e) {
        const item = e.target.closest('.uf-item-pessoa');
        if (!item || !item.dataset.idx) return;
        const wrap = document.getElementById('uf-resultados-busca');
        const pessoas = JSON.parse(wrap.dataset.pessoas || '[]');
        const pessoa = pessoas[parseInt(item.dataset.idx, 10)];
        if (pessoa) ufSelecionarPessoa(pessoa);
    });

    // Fecha a lista de resultados ao clicar fora dela.
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.uf-busca-wrap')) {
            document.getElementById('uf-resultados-busca').style.display = 'none';
        }
    });

    document.getElementById('uf-btn-trocar').addEventListener('click', ufTrocarPessoa);
    document.getElementById('uf-input-foto').addEventListener('change', ufOnArquivoSelecionado);
    document.getElementById('uf-btn-salvar').addEventListener('click', ufSalvarFoto);
});
