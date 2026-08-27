// ====================================================================
// Sistema P3 — utilitário compartilhado de detecção facial (browser)
// ====================================================================
// Usado por js/autores-reconhecimento-facial.js (busca por similaridade)
// e js/autores-upload-foto.js (cadastro de foto) — carrega os modelos
// de face-api.js (js/vendor/face-api.min.js, precisa estar incluído
// ANTES deste arquivo) uma única vez por página e expõe uma função só
// pra detectar rosto + calcular o embedding de um arquivo de imagem.
// Roda 100% no navegador — a imagem nunca sai do dispositivo além do
// upload explícito que cada tela faz depois de chamar isto.

const P3_FACIAL_MODELOS_URL = '../models/face-api';

let p3FacialModelosCarregados = false;
let p3FacialCarregandoPromise = null;
// TinyFaceDetector é só uma tentativa A MAIS (fallback) — não pode ser
// obrigatório. Se o arquivo do modelo dele não estiver no servidor (ex.:
// esqueceu de subir junto com o resto), essa falha NÃO pode derrubar os
// outros 3 modelos (que são os que already funcionavam) nem virar "todo
// mundo tem 0 rosto detectado" em silêncio — sintoma real já visto: um
// Promise.all só, com os 4 modelos juntos, fazia UM 404 rejeitar TODOS,
// e o catch(){} em volta de cada detecção individual (cad-busca-foto.js)
// escondia isso como se fosse simplesmente "sem rosto na foto".
let p3TinyFaceDetectorDisponivel = false;

async function p3CarregarModelosFaciais() {
    if (p3FacialModelosCarregados) return;
    if (p3FacialCarregandoPromise) return p3FacialCarregandoPromise;
    p3FacialCarregandoPromise = (async () => {
        // OBRIGATÓRIOS — se algum destes falhar, deixa rejeitar de
        // verdade (propaga o erro real pra quem chamou) em vez de
        // mascarar como "sem rosto detectado".
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(P3_FACIAL_MODELOS_URL),
            faceapi.nets.faceLandmark68Net.loadFromUri(P3_FACIAL_MODELOS_URL),
            faceapi.nets.faceRecognitionNet.loadFromUri(P3_FACIAL_MODELOS_URL)
        ]);
        // OPCIONAL — try/catch PRÓPRIO, isolado dos obrigatórios acima.
        try {
            await faceapi.nets.tinyFaceDetector.loadFromUri(P3_FACIAL_MODELOS_URL);
            p3TinyFaceDetectorDisponivel = true;
        } catch (err) {
            console.warn('[facial-detect] TinyFaceDetector não carregou (modelo pode não ter sido enviado pro servidor) — seguindo só com SSD Mobilenet v1.', err);
            p3TinyFaceDetectorDisponivel = false;
        }
        p3FacialModelosCarregados = true;
    })();
    return p3FacialCarregandoPromise;
}

// Deixa a imagem mais fácil de detectar antes de tentar achar o rosto —
// as fotos que mais importam aqui (câmera de segurança, foto antiga do
// CAD, celular com pouca luz) raramente são "de estúdio". Amplia
// imagens pequenas (rosto ocupando poucos pixels prejudica muito a
// detecção) e espica o contraste de fotos escuras/apagadas via
// auto-contraste simples de histograma — sem depender de nenhuma lib
// extra além do canvas nativo.
function p3PrepararImagemParaDeteccao_(img) {
    const canvas = document.createElement('canvas');
    const escala = img.width < 600 ? Math.min(3, 600 / img.width) : 1;
    canvas.width = Math.round(img.width * escala);
    canvas.height = Math.round(img.height * escala);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const dados = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = dados.data;
    let min = 255, max = 0;
    for (let i = 0; i < px.length; i += 4) {
        const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
        if (lum < min) min = lum;
        if (lum > max) max = lum;
    }
    const faixa = max - min;
    // Só reforça contraste quando a foto realmente tem pouco (faixa
    // estreita) — numa foto já bem exposta isso não muda quase nada.
    if (faixa > 10 && faixa < 200) {
        const ganho = 255 / faixa;
        for (let i = 0; i < px.length; i += 4) {
            px[i] = Math.min(255, Math.max(0, (px[i] - min) * ganho));
            px[i + 1] = Math.min(255, Math.max(0, (px[i + 1] - min) * ganho));
            px[i + 2] = Math.min(255, Math.max(0, (px[i + 2] - min) * ganho));
        }
        ctx.putImageData(dados, 0, 0);
    }
    return canvas;
}

// Devolve { descritor, score } do rosto encontrado na imagem, ou null se
// nenhum rosto foi detectado em NENHUMA das tentativas. `score` (0-1,
// confiança do detector) serve pra escolher a MELHOR entre várias fotos
// da mesma pessoa — ver p3DetectarRostoDeArquivo (só o descritor, uso
// mais comum) e js/cad-busca-foto.js (usa o score pra decidir qual das
// fotos baixadas do CAD vira a capa da pessoa, em vez de pegar a
// última só porque foi a última processada — uma foto de mão/documento
// sem rosto não teria como virar capa por engano dessa forma). Lança
// erro se os modelos falharem ao carregar (problema de rede/caminho,
// não "não achou rosto").
//
// Tenta várias combinações de detector/parâmetros, da mais precisa pra
// mais permissiva, antes de desistir — um único detector com os
// parâmetros padrão (afinados pra foto "de estúdio", bem iluminada, de
// frente) deixa passar como "rosto não detectado" muita foto real de
// CAD/câmera de segurança/celular com pouca luz. minConfidence/
// scoreThreshold bem abaixo do padrão da lib (0.5) é proposital — o uso
// aqui é achar QUALQUER rosto plausível pra comparar depois (a tela já
// avisa que o resultado é uma estimativa a confirmar manualmente, não
// uma identificação positiva), então vale mais errar puxando pra achar
// demais do que deixar passar um rosto de verdade.
async function p3DetectarRostoComQualidade(arquivo) {
    await p3CarregarModelosFaciais();
    const imgOriginal = await faceapi.bufferToImage(arquivo);
    const imgPreparada = p3PrepararImagemParaDeteccao_(imgOriginal);

    const tentativas = [
        () => faceapi.detectSingleFace(imgPreparada, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 })),
        // Último recurso: imagem ORIGINAL (sem o pré-processamento) — em
        // casos raros o auto-contraste/ampliação atrapalha mais do que
        // ajuda (ex.: ruído amplificado numa foto já bem exposta).
        () => faceapi.detectSingleFace(imgOriginal, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.15 })),
    ];
    // Só entra se o modelo carregou de verdade (ver p3CarregarModelosFaciais) —
    // sem essa checagem, chamar detectSingleFace com um modelo não
    // carregado lança um erro que derrubaria a detecção inteira (mesmo a
    // 1ª tentativa, que já tinha funcionado).
    if (p3TinyFaceDetectorDisponivel) {
        tentativas.splice(1, 0, () => faceapi.detectSingleFace(imgPreparada, new faceapi.TinyFaceDetectorOptions({ inputSize: 608, scoreThreshold: 0.15 })));
    }

    for (const tentar of tentativas) {
        const deteccao = await tentar().withFaceLandmarks().withFaceDescriptor();
        if (deteccao) return { descritor: deteccao.descriptor, score: deteccao.detection.score };
    }
    return null;
}

// Atalho pra quem só precisa do embedding (uso mais comum — cadastro de
// 1 foto só, ou a foto pesquisada na tela de reconhecimento facial).
async function p3DetectarRostoDeArquivo(arquivo) {
    const resultado = await p3DetectarRostoComQualidade(arquivo);
    return resultado ? resultado.descritor : null;
}
