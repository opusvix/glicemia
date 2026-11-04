/* logic.js - regras do app, sem tela. Roda no navegador e no Node (testes). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Glic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const INICIO_PADRAO = '2025-06-04';   // primeira linha com dados da planilha
  /* Faixas definidas pelo usuário: normal < 125, atenção de 125 a < 180, alta >= 180. */
  const FAIXAS_PADRAO = { atencao: 125, alta: 180 };
  const FAIXAS_ANTIGAS = { atencao: 100, alta: 126 };
  const DIAS_GUARDA_EXCLUSAO = 400;
  const VALOR_MIN = 20;
  const VALOR_MAX = 600;
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIAS_LONGOS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const pad2 = (n) => (n < 10 ? '0' : '') + n;

  /* ---------- datas ---------- */

  function isoValido(y, m, d) {
    if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  /* Aceita 2025-10-18, 18/10/2025, 18/10/25, 18.10.2025 e número de série do Excel.
     Com barras, a ordem é dia/mês/ano; passe ordem 'MDY' para ler mês/dia/ano (arquivos em formato americano). */
  function parseData(s, ordem) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(s);
    if (m) return isoValido(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/.exec(s);
    if (m) {
      let y = +m[3];
      if (m[3].length === 2) y += 2000;
      return ordem === 'MDY' ? isoValido(y, +m[1], +m[2]) : isoValido(y, +m[2], +m[1]);
    }
    if (/^\d{5}(\.\d+)?$/.test(s)) {
      const n = Math.floor(+s);
      if (n >= 36526 && n <= 73050) {
        const dt = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
        return isoValido(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      }
    }
    return null;
  }

  function diaNum(iso) {
    const p = iso.split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }

  function dataBR(iso) {
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function dataCurta(iso) {
    const p = iso.split('-');
    return p[2] + '/' + p[1];
  }

  function mesAno(iso) {
    const p = iso.split('-');
    return MESES[+p[1] - 1] + '/' + p[0].slice(2);
  }

  function diaSemana(iso) {
    const p = iso.split('-');
    return DIAS[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()];
  }

  function dataExtenso(iso) {
    const p = iso.split('-');
    const dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return DIAS_LONGOS[dt.getUTCDay()] + ', ' + (+p[2]) + ' de ' + MESES_LONGOS[+p[1] - 1];
  }

  function hojeISO(agora) {
    const d = agora || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  /* ---------- números ---------- */

  /* Aceita 98, 98,5, 98.5, "98 mg/dL", 1.234,5. Devolve null se não for número. */
  function parseNumero(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    s = s.replace(/mg\s*\/?\s*dl/ig, '').replace(/\s+/g, '');
    if (!/^[-+]?[\d.,]+$/.test(s)) return null;
    const c = s.lastIndexOf(',');
    const p = s.lastIndexOf('.');
    if (c > -1 && p > -1) {
      s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (c > -1) {
      s = s.replace(',', '.');
    }
    const v = Number(s);
    return Number.isFinite(v) ? v : null;
  }

  /* 8:00, 05:25, 8:00:00 AM, 7:00:00 PM -> 'HH:MM'. Vazio ou inválido -> null. */
  function parseHora(s) {
    if (s == null) return null;
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?$/.exec(String(s).trim());
    if (!m) return null;
    let h = +m[1];
    const mi = +m[2];
    if (m[3]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (m[3].toLowerCase() === 'pm' ? 12 : 0);
    }
    if (h > 23 || mi > 59) return null;
    return pad2(h) + ':' + pad2(mi);
  }

  function horaDecimal(hhmm) {
    const p = hhmm.split(':');
    return +p[0] + (+p[1]) / 60;
  }

  function sanitizarObs(s) {
    return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  }

  const arredonda1 = (v) => Math.round(v * 10) / 10;

  function fmt(v, casas) {
    if (v == null || !Number.isFinite(v)) return '—';
    const c = casas == null ? 0 : casas;
    return v.toFixed(c).replace('.', ',');
  }

  /* ---------- importação da planilha ---------- */

  function dividirLinha(linha, delim) {
    const out = [];
    let cur = '';
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (aspas) {
        if (c === '"') {
          if (linha[i + 1] === '"') { cur += '"'; i++; } else aspas = false;
        } else cur += c;
      } else if (c === '"') aspas = true;
      else if (c === delim) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  }

  function contarFora(linha, ch) {
    let n = 0;
    let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      if (linha[i] === '"') aspas = !aspas;
      else if (!aspas && linha[i] === ch) n++;
    }
    return n;
  }

  /* Tab (colado da planilha), ponto e vírgula (Excel pt-BR) ou vírgula. Ignora o que está entre aspas. */
  function detectarDelimitador(linhas) {
    const amostra = linhas.slice(0, 20);
    const soma = (ch) => amostra.reduce((a, l) => a + contarFora(l, ch), 0);
    if (soma('\t') > 0) return '\t';
    const pv = soma(';');
    return pv > 0 && pv >= soma(',') ? ';' : ',';
  }

  /* Texto de CSV (ou colado da planilha) -> matriz de linhas. */
  function lerTabela(texto) {
    texto = String(texto || '').replace(/^﻿/, '');
    const linhas = texto.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
    if (!linhas.length) return [];
    const delim = detectarDelimitador(linhas);
    return linhas.map((l) => dividirLinha(l, delim));
  }

  /* Descobre sozinho qual coluna é a data e qual é a glicemia. */
  function detectarColunas(linhas) {
    let ncols = 0;
    linhas.forEach((l) => { if (l.length > ncols) ncols = l.length; });
    const datas = new Array(ncols).fill(0);
    const nums = new Array(ncols).fill(0);
    linhas.forEach((l) => {
      for (let c = 0; c < l.length; c++) {
        if (parseData(l[c]) || parseData(l[c], 'MDY')) datas[c]++;
        else {
          const v = parseNumero(l[c]);
          if (v !== null && v >= VALOR_MIN && v <= VALOR_MAX) nums[c]++;
        }
      }
    });
    let colData = -1;
    let melhor = 0;
    for (let c = 0; c < ncols; c++) if (datas[c] > melhor) { melhor = datas[c]; colData = c; }
    let colValor = -1;
    melhor = 0;
    for (let c = 0; c < ncols; c++) if (c !== colData && nums[c] > melhor) { melhor = nums[c]; colValor = c; }
    // um cabeçalho "jejum" (ou "glicemia") vale mais que a contagem: a planilha tem outras colunas numéricas
    const alvo = /^(glicemia( em)? jejum|jejum|glicemia)$/i;
    let achou = false;
    for (let r = 0; r < Math.min(3, linhas.length) && !achou; r++) {
      for (let c = 0; c < linhas[r].length; c++) {
        if (c !== colData && alvo.test(String(linhas[r][c]).trim()) && nums[c] > 0) { colValor = c; achou = true; break; }
      }
    }
    // hora do jejum e observações: também achadas pelo cabeçalho (horaJejum, hora, observacoes...)
    let colHora = -1;
    let colObs = -1;
    for (let r = 0; r < Math.min(3, linhas.length); r++) {
      for (let c = 0; c < linhas[r].length; c++) {
        const t = String(linhas[r][c]).trim();
        if (colHora < 0 && c !== colData && /^hora\s*(do\s*)?(jejum|coleta)?$/i.test(t)) colHora = c;
        if (colObs < 0 && c !== colData && /^observa(ç|c)(ões|oes|ão|ao)$/i.test(t)) colObs = c;
      }
    }
    return { colData: colData, colValor: colValor, colHora: colHora, colObs: colObs, ncols: ncols };
  }

  /* 6/4/2025 é 4 de junho (americano) ou 6 de abril (brasileiro)? Um dia maior que 12 resolve; se todos
     forem ambíguos, vale a ordem em que linhas vizinhas ficam a 1 a 3 dias uma da outra (planilha diária). Devolve 'DMY' ou 'MDY'. */
  function detectarOrdemData(linhas, colData) {
    const partes = [];
    linhas.forEach((l) => {
      const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})(?!\d)/.exec(String(l[colData] == null ? '' : l[colData]).trim());
      if (m) partes.push([+m[1], +m[2]]);
    });
    const diaPrimeiro = partes.some((p) => p[0] > 12), diaSegundo = partes.some((p) => p[1] > 12);
    if (diaPrimeiro && !diaSegundo) return 'DMY';
    if (diaSegundo && !diaPrimeiro) return 'MDY';
    const pontuar = (ordem) => {
      let boas = 0, anterior = null;
      linhas.forEach((l) => {
        const d = parseData(l[colData], ordem);
        if (d) {
          if (anterior) { const dif = diaNum(d) - diaNum(anterior); if (dif >= 1 && dif <= 3) boas++; }
          anterior = d;
        }
      });
      return boas;
    };
    return pontuar('MDY') > pontuar('DMY') ? 'MDY' : 'DMY';
  }

  /* Linhas -> registros {data, valor}. Conta o que foi deixado de fora. */
  function extrairRegistros(linhas, colData, colValor, opcoes) {
    const o = opcoes || {};
    const inicio = o.inicio || INICIO_PADRAO;
    const ordem = o.ordem || 'DMY';
    const colHora = o.colHora == null ? -1 : o.colHora;
    const colObs = o.colObs == null ? -1 : o.colObs;
    const r = { ordem: ordem, registros: [], notas: [], lidas: 0, semData: 0, vazias: 0, antesDoInicio: 0, foraDeFaixa: 0, repetidas: 0 };
    const porData = {};
    const notas = {};
    linhas.forEach((l) => {
      const data = colData >= 0 ? parseData(l[colData], ordem) : null;
      if (!data) { r.semData++; return; }
      r.lidas++;
      if (data < inicio) { r.antesDoInicio++; return; }
      const texto = colObs >= 0 ? sanitizarObs(l[colObs]) : '';
      if (texto) notas[data] = texto;               // a observação vale mesmo sem medição no dia
      const v = colValor >= 0 ? parseNumero(l[colValor]) : null;
      if (v === null) { r.vazias++; return; }
      if (v < VALOR_MIN || v > VALOR_MAX) { r.foraDeFaixa++; return; }
      if (porData[data] !== undefined) r.repetidas++;
      const reg = { data: data, valor: arredonda1(v) };
      const hora = colHora >= 0 ? parseHora(l[colHora]) : null;
      if (hora) reg.hora = hora;
      porData[data] = reg;
    });
    r.registros = ordenar(Object.keys(porData).map((d) => porData[d]));
    r.notas = ordenar(Object.keys(notas).map((d) => ({ data: d, texto: notas[d] })));
    return r;
  }

  function ordenar(regs) {
    return regs.slice().sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
  }

  /* Junta registros novos aos existentes. Por padrão não mexe em dia que já tem valor. */
  function mesclar(existentes, novos, sobrescrever) {
    const mapa = {};
    existentes.forEach((e) => { mapa[e.data] = e; });
    let adicionados = 0;
    let jaExistiam = 0;
    let substituidos = 0;
    novos.forEach((n) => {
      const atual = mapa[n.data];
      if (atual === undefined) { mapa[n.data] = n; adicionados++; } else if (sobrescrever) {
        if (atual.valor !== n.valor) substituidos++;
        mapa[n.data] = n;
      } else jaExistiam++;
    });
    const registros = ordenar(Object.keys(mapa).map((d) => mapa[d]));
    return { registros: registros, adicionados: adicionados, jaExistiam: jaExistiam, substituidos: substituidos };
  }

  /* ---------- estatística ---------- */

  function media(valores) {
    if (!valores.length) return null;
    return valores.reduce((a, b) => a + b, 0) / valores.length;
  }

  /* Média móvel por dias corridos: no dia D, média dos registros de (D - janela, D]. */
  function serieMediaMovel(regs, janela) {
    const out = [];
    let ini = 0;
    let soma = 0;
    for (let i = 0; i < regs.length; i++) {
      soma += regs[i].valor;
      const di = diaNum(regs[i].data);
      while (diaNum(regs[ini].data) <= di - janela) { soma -= regs[ini].valor; ini++; }
      const n = i - ini + 1;
      out.push({ data: regs[i].data, valor: regs[i].valor, media: soma / n, n: n });
    }
    return out;
  }

  /* Últimos N dias corridos, contando hoje. dias = 0 ou null devolve tudo. */
  function filtrarUltimosDias(regs, dias, hoje) {
    if (!dias) return regs.slice();
    const corte = diaNum(hoje) - dias;
    return regs.filter((r) => diaNum(r.data) > corte);
  }

  function classificar(valor, faixas) {
    if (valor < faixas.atencao) return 'normal';
    if (valor < faixas.alta) return 'atencao';
    return 'alta';
  }

  function validarFaixas(f) {
    if (!f) return false;
    const { atencao, alta } = f;
    if (![atencao, alta].every((x) => Number.isFinite(x) && x >= VALOR_MIN && x <= VALOR_MAX)) return false;
    return atencao < alta;
  }

  /* ---------- Painel (só jejum; dia sem medição fica de fora, nunca vira zero) ---------- */

  const DIAS_ORDEM = [1, 2, 3, 4, 5, 6, 0];   // seg a dom (0 = domingo, como no Date)

  function diaSemanaNum(iso) {
    const p = iso.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
  }

  function anosDisponiveis(itens) {
    const m = {};
    itens.forEach((r) => { m[+r.data.slice(0, 4)] = true; });
    return Object.keys(m).map(Number).sort((a, b) => b - a);
  }

  /* f = { anos: [2026], meses: [1..12], dias: [0..6] }; lista vazia = tudo. Serve para registros e observações. */
  function filtrarPainel(itens, f) {
    f = f || {};
    const anos = f.anos || [], meses = f.meses || [], dias = f.dias || [];
    return itens.filter((r) => {
      if (anos.length && anos.indexOf(+r.data.slice(0, 4)) < 0) return false;
      if (meses.length && meses.indexOf(+r.data.slice(5, 7)) < 0) return false;
      if (dias.length && dias.indexOf(diaSemanaNum(r.data)) < 0) return false;
      return true;
    });
  }

  function resumoPainel(regs, faixas) {
    const r = { n: regs.length, media: media(regs.map((x) => x.valor)), max: null, min: null, normal: 0, atencao: 0, alta: 0 };
    regs.forEach((x) => {
      if (!r.max || x.valor >= r.max.valor) r.max = { valor: x.valor, data: x.data };   // empate: o mais recente
      if (!r.min || x.valor <= r.min.valor) r.min = { valor: x.valor, data: x.data };
      r[classificar(x.valor, faixas)]++;
    });
    return r;
  }

  function porMes(regs, faixas) {
    const grupos = {};
    regs.forEach((x) => { (grupos[x.data.slice(0, 7)] = grupos[x.data.slice(0, 7)] || []).push(x); });
    return Object.keys(grupos).sort().map((m) => Object.assign({ mes: m }, resumoPainel(grupos[m], faixas)));
  }

  function porDiaSemana(regs) {
    return DIAS_ORDEM.map((d) => {
      const doDia = regs.filter((x) => diaSemanaNum(x.data) === d);
      return { dia: d, nome: DIAS[d], n: doDia.length, media: media(doDia.map((x) => x.valor)) };
    });
  }

  /* Fim de semana = sábado e domingo. difPct = (fim de semana - dias úteis) / dias úteis. */
  function fdsVsUtil(regs) {
    const fds = regs.filter((x) => { const d = diaSemanaNum(x.data); return d === 0 || d === 6; });
    const util = regs.filter((x) => { const d = diaSemanaNum(x.data); return d !== 0 && d !== 6; });
    const a = { n: fds.length, media: media(fds.map((x) => x.valor)) };
    const b = { n: util.length, media: media(util.map((x) => x.valor)) };
    return { fds: a, util: b, difPct: a.media !== null && b.media ? ((a.media - b.media) / b.media) * 100 : null };
  }

  function pontosHora(regs) {
    return regs.filter((x) => x.hora).map((x) => ({ data: x.data, x: horaDecimal(x.hora), y: x.valor }));
  }

  /* Correlação de Pearson entre hora e glicemia. r = null com menos de 3 pontos ou sem variação. */
  function correlacao(pontos) {
    const n = pontos.length;
    if (n < 3) return { n: n, r: null };
    const mx = media(pontos.map((p) => p.x)), my = media(pontos.map((p) => p.y));
    let sxy = 0, sxx = 0, syy = 0;
    pontos.forEach((p) => { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) * (p.x - mx); syy += (p.y - my) * (p.y - my); });
    if (sxx === 0 || syy === 0) return { n: n, r: null };
    return { n: n, r: sxy / Math.sqrt(sxx * syy) };
  }

  function forcaCorrelacao(r) {
    if (r === null) return 'indefinida';
    const a = Math.abs(r);
    return a < 0.1 ? 'nenhuma' : a < 0.3 ? 'fraca' : a < 0.5 ? 'moderada' : 'forte';
  }

  /* ---------- exportar e restaurar ---------- */

  /* data;glicemia;hora;observacao. Um dia só com observação sai com a glicemia em branco. */
  function gerarCSV(regs, notas) {
    const campo = (t) => (/[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
    const dias = {};
    regs.forEach((r) => { dias[r.data] = { valor: r.valor, hora: r.hora || '', obs: '' }; });
    (notas || []).forEach((n) => {
      if (!n.texto) return;
      if (!dias[n.data]) dias[n.data] = { valor: null, hora: '', obs: '' };
      dias[n.data].obs = n.texto;
    });
    const linhas = ['data;glicemia_mg_dl;hora;observacao'];
    Object.keys(dias).sort().forEach((d) => {
      const x = dias[d];
      linhas.push(dataBR(d) + ';' + (x.valor === null ? '' : String(x.valor).replace('.', ',')) + ';' + x.hora + ';' + campo(x.obs));
    });
    return '\ufeff' + linhas.join('\r\n') + '\r\n';
  }

  /* Tema de cores escolhido pela pessoa: 'auto' (segue o sistema), 'claro' ou 'escuro'. Sincroniza como as faixas. */
  const TEMAS = ['auto', 'claro', 'escuro'];
  const resolverTema = (t) => (TEMAS.indexOf(t) > -1 ? t : 'auto');

  function gerarBackup(estado, agora) {
    return JSON.stringify({
      app: 'glicemia-diaria',
      versao: 2,
      exportadoEm: (agora || new Date()).toISOString(),
      faixas: estado.faixas,
      faixasTs: estado.faixasTs || 0,
      tema: resolverTema(estado.tema),
      temaTs: estado.temaTs || 0,
      registros: estado.registros,
      apagados: estado.apagados || [],
      notas: estado.notas || [],
    }, null, 1);
  }

  /* Valida o arquivo de backup. Lança Error com mensagem clara se estiver errado. */
  /* Valida o arquivo de backup (versões 1 e 2). Lança Error com mensagem clara se estiver errado. */
  function lerBackup(texto) {
    let obj;
    try { obj = JSON.parse(texto); } catch (e) { throw new Error('Esse arquivo não é um backup do app.'); }
    if (!obj || obj.app !== 'glicemia-diaria' || !Array.isArray(obj.registros)) {
      throw new Error('Esse arquivo não é um backup do app.');
    }
    return normalizarEstado(obj);
  }

  /* ---------- sincronização ---------- */

  /* Cada dia guarda o valor e a hora da última alteração (ts). Apagar um dia guarda só a hora da exclusão.
     Em qualquer conflito vence a alteração mais recente; no empate, o dado vence a exclusão e,
     entre dois valores, o maior (regra fixa, para os dois aparelhos chegarem ao mesmo resultado). */
  function vence(x, y) {
    if (x.ts !== y.ts) return x.ts > y.ts;
    if (x.valor === null || y.valor === null) return x.valor !== null && y.valor === null;
    if (x.valor !== y.valor) return x.valor > y.valor;
    return String(x.hora || '') > String(y.hora || '');
  }

  function fundir(a, b, agora) {
    const mapa = {};
    const considerar = (data, valor, ts, hora) => {
      const c = { valor: valor, ts: ts, hora: hora || '' };
      if (!mapa[data] || vence(c, mapa[data])) mapa[data] = c;
    };
    const notasMapa = {};
    const considerarNota = (data, texto, ts) => {
      const c = { texto: texto || '', ts: ts || 0 };
      const atual = notasMapa[data];
      if (!atual || c.ts > atual.ts || (c.ts === atual.ts && c.texto > atual.texto)) notasMapa[data] = c;
    };
    [a, b].forEach((e) => {
      ((e && e.registros) || []).forEach((r) => considerar(r.data, r.valor, r.ts || 0, r.hora));
      ((e && e.apagados) || []).forEach((r) => considerar(r.data, null, r.ts || 0));
      ((e && e.notas) || []).forEach((r) => considerarNota(r.data, r.texto, r.ts));
    });
    const limite = (agora || Date.now()) - DIAS_GUARDA_EXCLUSAO * 86400000;
    const registros = [];
    const apagados = [];
    Object.keys(mapa).forEach((d) => {
      const c = mapa[d];
      if (c.valor !== null) {
        const reg = { data: d, valor: c.valor, ts: c.ts };
        if (c.hora) reg.hora = c.hora;
        registros.push(reg);
      } else if (c.ts >= limite) apagados.push({ data: d, ts: c.ts });
    });
    const notas = [];
    Object.keys(notasMapa).forEach((d) => {
      const c = notasMapa[d];
      if (c.texto || c.ts >= limite) notas.push({ data: d, texto: c.texto, ts: c.ts });
    });
    const fa = resolverFaixas(a && a.faixas), fb = resolverFaixas(b && b.faixas);
    const ta = tsValido(a && a.faixasTs), tb = tsValido(b && b.faixasTs);
    const ehPadrao = (f) => f.atencao === FAIXAS_PADRAO.atencao && f.alta === FAIXAS_PADRAO.alta;
    let usaB = false;
    if (b) {
      if (tb !== ta) usaB = tb > ta;
      else if (ehPadrao(fa) !== ehPadrao(fb)) usaB = ehPadrao(fa);   // empate: a faixa personalizada vence o padrão
      else usaB = JSON.stringify(fb) > JSON.stringify(fa);
    }
    // tema: vence a escolha mais recente; no empate, o texto maior (regra fixa, os dois aparelhos chegam ao mesmo resultado)
    const tha = resolverTema(a && a.tema), thb = resolverTema(b && b.tema);
    const tsa = tsValido(a && a.temaTs), tsb = tsValido(b && b.temaTs);
    const temaB = !!b && (tsb !== tsa ? tsb > tsa : thb > tha);
    return { registros: ordenar(registros), apagados: ordenar(apagados), notas: ordenar(notas), faixas: usaB ? fb : fa, faixasTs: usaB ? tb : ta,
      tema: temaB ? thb : tha, temaTs: temaB ? tsb : tsa };
  }

  /* Estado vindo do armazenamento ou de arquivo -> estado limpo e sem duplicidades. */
  function normalizarEstado(o) {
    o = o || {};
    return fundir({
      registros: sanitizarRegistros(o.registros),
      apagados: sanitizarApagados(o.apagados),
      notas: sanitizarNotas(o.notas),
      faixas: o.faixas,
      faixasTs: o.faixasTs,
      tema: o.tema,
      temaTs: o.temaTs,
    }, null);
  }

  /* Texto que identifica o conteúdo: duas assinaturas iguais = nada a sincronizar. */
  function assinatura(e) {
    const n = normalizarEstado(e);
    return JSON.stringify([n.registros, n.apagados, n.notas, n.faixas, n.faixasTs, n.tema, n.temaTs]);
  }

  /* Filtra o que vem do armazenamento ou de um backup: data válida (normalizada) e valor dentro do limite. */
  const tsValido = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.floor(x) : 0);

  /* Filtra o que vem do armazenamento ou de um backup: data válida (normalizada), valor dentro do limite
     e carimbo de hora da última alteração (0 = registro antigo, de antes da sincronização). */
  function sanitizarRegistros(lista) {
    const mapa = {};
    (Array.isArray(lista) ? lista : []).forEach((r) => {
      const d = r && parseData(r.data);
      const v = r && typeof r.valor === 'number' ? r.valor : null;
      if (!d || v === null || !Number.isFinite(v) || v < VALOR_MIN || v > VALOR_MAX) return;
      const ts = tsValido(r.ts);
      if (mapa[d] && ts < mapa[d].ts) return;
      const reg = { data: d, valor: arredonda1(v), ts: ts };
      const hora = parseHora(r.hora);
      if (hora) reg.hora = hora;
      mapa[d] = reg;
    });
    return ordenar(Object.keys(mapa).map((d) => mapa[d]));
  }

  /* Observações do dia: valem com ou sem medição. texto vazio + ts = observação removida (a remoção também sincroniza). */
  function sanitizarNotas(lista) {
    const mapa = {};
    (Array.isArray(lista) ? lista : []).forEach((r) => {
      const d = r && parseData(r.data);
      if (!d) return;
      const texto = sanitizarObs(r.texto);
      const ts = tsValido(r.ts);
      if (!texto && ts === 0) return;
      const atual = mapa[d];
      if (!atual || ts > atual.ts || (ts === atual.ts && texto > atual.texto)) mapa[d] = { data: d, texto: texto, ts: ts };
    });
    return ordenar(Object.keys(mapa).map((d) => mapa[d]));
  }

  /* Dias apagados: guardados para que a exclusão chegue aos outros aparelhos. */
  function sanitizarApagados(lista) {
    const mapa = {};
    (Array.isArray(lista) ? lista : []).forEach((r) => {
      const d = r && parseData(r.data);
      const ts = r ? tsValido(r.ts) : 0;
      if (d && ts > 0 && (!mapa[d] || ts > mapa[d])) mapa[d] = ts;
    });
    return ordenar(Object.keys(mapa).map((d) => ({ data: d, ts: mapa[d] })));
  }

  /* Faixas inválidas viram o padrão. Quem ainda tem as faixas antigas (70/100/126) passa para as novas. */
  /* Faixas inválidas viram o padrão. Quem ainda tem as faixas antigas (100/126) passa para as novas.
     Backups e dados antigos com o campo "baixa" têm esse campo descartado. */
  function resolverFaixas(f) {
    if (!validarFaixas(f)) return Object.assign({}, FAIXAS_PADRAO);
    if (f.atencao === FAIXAS_ANTIGAS.atencao && f.alta === FAIXAS_ANTIGAS.alta) return Object.assign({}, FAIXAS_PADRAO);
    return { atencao: f.atencao, alta: f.alta };
  }

  return {
    INICIO_PADRAO, FAIXAS_PADRAO, VALOR_MIN, VALOR_MAX,
    parseData, parseNumero, diaNum, dataBR, dataCurta, mesAno, diaSemana, dataExtenso, hojeISO,
    arredonda1, fmt,
    lerTabela, detectarColunas, detectarOrdemData, extrairRegistros, ordenar, mesclar,
    media, serieMediaMovel, filtrarUltimosDias, classificar, validarFaixas,
    gerarCSV, gerarBackup, lerBackup, sanitizarRegistros, sanitizarApagados, resolverFaixas, detectarDelimitador,
    TEMAS, resolverTema, fundir, normalizarEstado, assinatura,
    parseHora, horaDecimal, sanitizarObs, sanitizarNotas,
    diaSemanaNum, anosDisponiveis, filtrarPainel, resumoPainel, porMes, porDiaSemana, fdsVsUtil, pontosHora, correlacao, forcaCorrelacao,
  };
}));
