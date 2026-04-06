// ─────────────────────────────────────────────────────────────
//  Proxy Server — DataJud CNJ
//  Resolve o bloqueio de CORS ao consultar a API do DataJud.
//
//  Requisitos: Node.js 18+
//  Instalação: npm install express node-fetch cors
//  Uso:        node server.js
//              (mantenha rodando enquanto usa a página HTML)
// ─────────────────────────────────────────────────────────────

const express  = require("express");
const fetch    = require("node-fetch");
const cors     = require("cors");

const app  = express();
const PORT = 3131;

const API_KEY  = "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw";
const BASE_URL = "https://api-publica.datajud.cnj.jus.br";

app.use(cors());
app.use(express.json());

// ── Rota de proxy ──────────────────────────────────────────────────────────
//    POST /api/:tribunal
//    Body: qualquer query Elasticsearch (repassada direto)
app.post("/api/:tribunal", async (req, res) => {
  const { tribunal } = req.params;
  const endpoint = `${BASE_URL}/${tribunal}/_search`;

  console.log(`[${new Date().toLocaleTimeString()}] → ${tribunal} | query: ${JSON.stringify(req.body)}`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `APIKey ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`  ✗ Erro HTTP ${response.status}:`, data);
      return res.status(response.status).json({ error: data });
    }

    console.log(`  ✓ ${data?.hits?.total?.value ?? 0} resultado(s) encontrado(s).`);
    res.json(data);

  } catch (err) {
    console.error("  ✗ Erro de rede:", err.message);
    res.status(502).json({ error: "Falha ao conectar com a API DataJud.", detail: err.message });
  }
});

// ── Healthcheck ────────────────────────────────────────────────────────────
app.get("/", (_, res) => res.json({
  status: "ok",
  message: "Proxy DataJud rodando.",
  porta: PORT,
  uso: "POST /api/<tribunal> com body JSON Elasticsearch"
}));

app.listen(PORT, () => {
  console.log("─────────────────────────────────────────────────");
  console.log(`  ✅  Proxy DataJud iniciado em http://localhost:${PORT}`);
  console.log("     Mantenha este terminal aberto.");
  console.log("     Abra o arquivo HTML no navegador (Live Server).");
  console.log("─────────────────────────────────────────────────");
});
