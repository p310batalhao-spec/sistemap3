// ════════════════════════════════════════════════════════════════════
// Service Worker do Xerife — existe só pra manter a IA local (WebLLM)
// carregada UMA VEZ, sobrevivendo a recarregar a página ou navegar entre
// páginas do sistema. Um Service Worker roda fora de qualquer aba
// específica e continua ativo enquanto pelo menos uma aba do site estiver
// aberta — sem isso, cada nova página recarregava o modelo do zero (os
// ARQUIVOS do modelo já ficam em cache do navegador, mas a INICIALIZAÇÃO —
// compilar o WASM, alocar buffers de GPU etc. — ainda custa tempo/CPU toda
// vez, e é isso que este arquivo evita repetir).
//
// IMPORTANTE — por que importa de um arquivo LOCAL (js/vendor/) e não do
// CDN direto: testado e confirmado que um Service Worker do tipo module
// que importa uma biblioteca de origem CRUZADA (cross-origin, ex.:
// https://esm.run/...) falha o registro em todo navegador testado (erro
// "ServiceWorker cannot be started") — é uma restrição de plataforma, não
// bug daqui. Importar a MESMA biblioteca de um arquivo local (mesma
// origem do site) resolve — por isso o pacote foi vendorizado uma vez em
// js/vendor/ em vez de importado do CDN toda vez.
//
// Fica na RAIZ do projeto (não em js/) de propósito: o escopo máximo de
// um Service Worker é a pasta onde o arquivo está servido (e abaixo dela),
// então na raiz ele cobre o site inteiro sem precisar de nenhum cabeçalho
// especial do servidor (Service-Worker-Allowed).
// ════════════════════════════════════════════════════════════════════
import { ServiceWorkerMLCEngineHandler } from './js/vendor/web-llm-0.2.84.esm.js';

// IMPORTANTE — o handler é criado aqui, no NÍVEL DE MÓDULO (topo do
// arquivo), não dentro de nenhum listener de evento. Motivo (2 bugs reais
// encontrados e confirmados testando, o 2º só depois de já ter corrigido
// o 1º):
//
// 1º bug (já corrigido antes): o construtor de ServiceWorkerMLCEngineHandler
// registra o PRÓPRIO listener interno de 'message' (é assim que ele
// processa o pedido de carregar o modelo) — se o handler fosse criado só
// sob demanda dentro do listener de 'message' da página, esse listener
// interno seria registrado tarde demais pra pegar a própria mensagem que
// disparou sua criação, e ela seria descartada.
//
// 2º bug (este) — criar o handler dentro de 'activate' (como a correção
// anterior fazia) resolvia o 1º bug, mas só funcionava na PRIMEIRA
// página: um Service Worker ocioso é TERMINADO pelo navegador pra
// economizar memória (comportamento normal, acontece rápido, em
// segundos) — e quando uma página NOVA manda a mensagem de
// CreateServiceWorkerMLCEngine, o navegador "acorda" o SW rodando o
// script INTEIRO de novo do zero, MAS 'install'/'activate' NÃO disparam
// de novo nesse despertar (só acontecem 1x na vida do SW). Resultado:
// `handler` ficava undefined a partir do 2º acordar em diante — mesma
// trava silenciosa de antes (nem erro, nem progresso, "baixando 0%" pra
// sempre), só que agora reaparecendo a cada nova página depois da
// primeira. O código no nível de módulo, ao contrário, roda em TODA
// execução do script — 1ª instalação ou qualquer despertar seguinte —
// garantindo que o handler (e o listener interno dele) sempre já existe
// antes de qualquer mensagem poder chegar.
const handler = new ServiceWorkerMLCEngineHandler();

// self.skipWaiting() + clients.claim(): sem os dois, um Service Worker
// recém-registrado só passa a controlar a página a partir da PRÓXIMA
// navegação — a aba que acabou de registrá-lo continua "não controlada"
// até um reload, e CreateServiceWorkerMLCEngine falha com "There is no
// active service worker" porque `navigator.serviceWorker.controller`
// ainda está nulo nessa mesma aba. skipWaiting() pula a espera de
// instalação e claim() assume o controle imediatamente, sem precisar de
// reload — essencial justamente pro caso de uso daqui (1º carregamento).
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    console.log('Xerife: service worker da IA local ativado.');
});
