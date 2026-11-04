/* painel.js - aba Painel: 4 páginas (Visão Geral, Por mês, Rotina & Comportamento, Detalhamento Diário).
   Só lê os dados (registros do jejum e observações); os cálculos ficam em logic.js. Dia sem medição fica de fora, nunca vira zero. */
(function () {
  'use strict';

  const G = window.Glic;
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DIAS = [{ n: 1, nome: 'seg' }, { n: 2, nome: 'ter' }, { n: 3, nome: 'qua' }, { n: 4, nome: 'qui' }, { n: 5, nome: 'sex' }, { n: 6, nome: 'sáb' }, { n: 0, nome: 'dom' }];
  const ROTULO = { normal: 'Normal', atencao: 'Atenção', alta: 'Alta' };
  const ICONE = { normal: '✓', atencao: '!', alta: '▲' };

  const PAGINAS = [
    { id: 'visao', nome: 'Visão Geral', titulo: 'Monitoramento e Análise de Glicemia', perguntas: ['Como está meu controle glicêmico ao longo do tempo?'] },
    { id: 'mes', nome: 'Por mês', titulo: 'Análise por Mês', perguntas: ['Em quais meses o jejum ficou mais alto ou mais baixo?'] },
    { id: 'rotina', nome: 'Rotina & Comportamento', titulo: 'Rotina e Comportamento', perguntas: ['Meu controle glicêmico muda quando saio da rotina (fins de semana)?', 'Horários mais tardios estão associados a níveis mais altos de glicemia?'] },
    { id: 'detalhe', nome: 'Detalhamento Diário', titulo: 'Detalhamento Diário', perguntas: ['Quais dias merecem atenção?'] },
  ];

  const estado = { pagina: 'visao', filtros: { anos: [], meses: [], dias: [] }, faixa: 'todos', linhas: 60, filtrosAbertos: null };
  let ultimo = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, c) => G.fmt(v, c == null ? 0 : c);
  const val = (v) => G.fmt(v, v % 1 ? 1 : 0);
  const pct = (parte, total) => (total ? Math.round((parte / total) * 100) : 0);

  function chipFaixa(valor, fx) {
    const c = G.classificar(valor, fx);
    return '<span class="faixa f-' + c + '"><span class="ico" aria-hidden="true">' + ICONE[c] + '</span>' + ROTULO[c] + '</span>';
  }

  /* ---------- estrutura ---------- */

  function ativos(lista) { return lista.length; }
  const totalFiltros = () => ativos(estado.filtros.anos) + ativos(estado.filtros.meses) + ativos(estado.filtros.dias);

  function grupoFiltro(rotulo, chave, opcoes) {
    return '<fieldset class="filtro-grupo"><legend>' + rotulo + '</legend><div class="filtro-chips">' +
      opcoes.map((o) => '<button type="button" class="chip pequeno" data-filtro="' + chave + '" data-valor="' + o.v + '" aria-pressed="' + (estado.filtros[chave].indexOf(o.v) > -1) + '">' + o.t + '</button>').join('') +
      '</div></fieldset>';
  }

  function lateral(todos) {
    const anos = G.anosDisponiveis(todos).map((a) => ({ v: a, t: String(a) }));
    const meses = MESES.map((m, i) => ({ v: i + 1, t: m }));
    const dias = DIAS.map((d) => ({ v: d.n, t: d.nome }));
    const n = totalFiltros();
    const aberto = estado.filtrosAbertos === null ? window.matchMedia('(min-width: 900px)').matches : estado.filtrosAbertos;
    return '<aside class="painel-lateral">' +
      '<nav aria-label="Páginas do painel"><h2 class="painel-rotulo">Páginas</h2><div class="painel-paginas">' +
      PAGINAS.map((p) => '<button type="button" class="chip pag-btn" data-pagina="' + p.id + '" aria-pressed="' + (estado.pagina === p.id) + '">' + p.nome + '</button>').join('') +
      '</div></nav>' +
      '<details class="filtros"' + (aberto ? ' open' : '') + '><summary>Filtros' + (n ? ' (' + n + ' ativos)' : '') + '</summary>' +
      (anos.length ? grupoFiltro('Ano', 'anos', anos) : '') + grupoFiltro('Mês', 'meses', meses) + grupoFiltro('Dia da semana', 'dias', dias) +
      (n ? '<button type="button" class="botao botao-sec" id="painel-limpar">Limpar filtros</button>' : '') +
      '</details></aside>';
  }

  function topo(p) {
    return '<header class="painel-topo"><h1 id="t-painel">' + esc(p.titulo) + '</h1>' +
      '<p class="painel-pergunta"><strong>Pergunta de negócio</strong>' + p.perguntas.map((q) => '<span>' + esc(q) + '</span>').join('') + '</p></header>';
  }

  function cartao(rotulo, valor, nota, unidade) {
    return '<div class="cartao"><span class="rot">' + rotulo + '</span><span class="val">' + valor + (unidade ? '<small>' + unidade + '</small>' : '') + '</span><span class="nota">' + (nota || '') + '</span></div>';
  }

  function barraFaixas(r) {
    const seg = (c) => (r[c] ? '<span class="s-' + c + '" style="flex:' + r[c] + '" title="' + ROTULO[c] + ': ' + r[c] + ' dias (' + pct(r[c], r.n) + '%)"></span>' : '');
    return '<div class="barra-faixas" role="img" aria-label="' + ROTULO.normal + ' ' + pct(r.normal, r.n) + '%, ' + ROTULO.atencao + ' ' + pct(r.atencao, r.n) + '%, ' + ROTULO.alta + ' ' + pct(r.alta, r.n) + '%">' +
      seg('normal') + seg('atencao') + seg('alta') + '</div>';
  }

  function legendaFaixas(fx) {
    return '<p class="legenda-faixas"><span class="faixa f-normal"><span class="ico" aria-hidden="true">✓</span>Normal (&lt; ' + fx.atencao + ')</span>' +
      '<span class="faixa f-atencao"><span class="ico" aria-hidden="true">!</span>Atenção (≥ ' + fx.atencao + ' e &lt; ' + fx.alta + ')</span>' +
      '<span class="faixa f-alta"><span class="ico" aria-hidden="true">▲</span>Alta (≥ ' + fx.alta + ')</span> <span class="un">mg/dL</span></p>';
  }

  const vazio = (t) => '<p class="vazio">' + t + '</p>';

  /* ---------- páginas ---------- */

  function paginaVisao(regs, notas, fx) {
    const r = G.resumoPainel(regs, fx);
    if (!r.n) return vazio('Sem registros neste filtro.');
    return '<div class="cartoes">' +
      cartao('Média geral', num(r.media, 0), 'em ' + r.n + (r.n === 1 ? ' dia' : ' dias'), 'mg/dL') +
      cartao('Maior valor', val(r.max.valor), G.dataBR(r.max.data), 'mg/dL') +
      cartao('Menor valor', val(r.min.valor), G.dataBR(r.min.data), 'mg/dL') +
      cartao('Dias na faixa Normal', pct(r.normal, r.n) + '%', r.normal + ' de ' + r.n + ' dias', '') + '</div>' +
      '<section class="bloco-grafico"><h2>Dias por faixa</h2>' + barraFaixas(r) + legendaFaixas(fx) + '</section>' +
      '<section class="bloco-grafico"><h2>Jejum diário e média móvel de 7 dias</h2>' +
      '<div class="legenda"><span><i class="marca-ponto"></i>Jejum do dia</span><span><i class="marca-linha"></i>Média móvel (7 dias)</span><span><i class="marca-nota"></i>Observação</span></div>' +
      '<div class="grafico" id="g-visao"></div></section>';
  }

  function paginaMes(regs, fx) {
    const meses = G.porMes(regs, fx).reverse();
    if (!meses.length) return vazio('Sem registros neste filtro.');
    const linhas = meses.map((m) => '<tr><th scope="row">' + MESES[+m.mes.slice(5) - 1] + '/' + m.mes.slice(2, 4) + '</th>' +
      '<td class="n">' + m.n + '</td><td class="n valor">' + num(m.media, 0) + '</td><td class="n">' + val(m.max.valor) + '</td><td class="n">' + val(m.min.valor) + '</td>' +
      '<td class="c-barra">' + barraFaixas(m) + '<span class="pcts">' + pct(m.normal, m.n) + '% · ' + pct(m.atencao, m.n) + '% · ' + pct(m.alta, m.n) + '%</span></td></tr>').join('');
    return '<section class="bloco-grafico"><h2>Jejum por mês</h2>' + legendaFaixas(fx) +
      '<div class="rolagem-x"><table class="tabela tabela-mes"><caption class="so-leitor">Jejum por mês: dias, média, maior e menor valor e percentual de dias em cada faixa</caption>' +
      '<thead><tr><th scope="col">Mês</th><th scope="col" class="n">Dias</th><th scope="col" class="n">Média</th><th scope="col" class="n">Máx</th><th scope="col" class="n">Mín</th><th scope="col">Dias por faixa (Normal · Atenção · Alta)</th></tr></thead><tbody>' + linhas + '</tbody></table></div></section>';
  }

  function paginaRotina(regs, fx) {
    if (!regs.length) return vazio('Sem registros neste filtro.');
    const fu = G.fdsVsUtil(regs);
    let dif = '—', difNota = 'Precisa de dias úteis e de fim de semana no filtro.';
    if (fu.difPct !== null) {
      const sinal = fu.difPct > 0 ? '+' : '';
      dif = sinal + G.fmt(fu.difPct, 1) + '%';
      difNota = Math.abs(fu.difPct) < 0.05 ? 'Fim de semana igual aos dias úteis.' : 'Fim de semana ' + G.fmt(Math.abs(fu.difPct), 1) + '% ' + (fu.difPct > 0 ? 'acima' : 'abaixo') + ' dos dias úteis.';
    }
    const pts = G.pontosHora(regs);
    const c = G.correlacao(pts);
    let corr;
    if (c.r === null) corr = 'Poucos dias com hora registrada (' + pts.length + '): preciso de pelo menos 3 com horários diferentes para calcular.';
    else corr = 'Correlação entre hora e glicemia: <strong>r = ' + G.fmt(c.r, 2) + '</strong> (' + G.forcaCorrelacao(c.r) + '), em ' + c.n + ' dias com hora registrada de ' + regs.length + ' no filtro. ' +
      'Correlação não prova causa' + (c.n < 30 ? ', e com tão poucos dias o resultado é instável' : '') + '.';
    return '<div class="cartoes dois">' +
      cartao('Média do jejum no fim de semana', num(fu.fds.media, 0), fu.fds.n + ' dias (sáb e dom)', 'mg/dL') +
      cartao('Média do jejum em dias úteis', num(fu.util.media, 0), fu.util.n + ' dias (seg a sex)', 'mg/dL') + '</div>' +
      '<div class="cartoes dois">' + cartao('Diferença fim de semana × dia útil', dif, difNota, '') + '</div>' +
      '<section class="bloco-grafico"><h2>Média do jejum por dia da semana</h2><div class="grafico" id="g-semana"></div></section>' +
      '<section class="bloco-grafico"><h2>Hora da coleta × jejum</h2><p class="dica">' + corr + '</p>' +
      '<div class="legenda"><span><i class="m-circulo"></i>Normal</span><span><i class="m-quadrado"></i>Atenção</span><span><i class="m-triangulo"></i>Alta</span></div>' +
      '<div class="grafico" id="g-hora"></div></section>';
  }

  function paginaDetalhe(regs, notas, fx) {
    const dias = {};
    regs.forEach((r) => { dias[r.data] = { data: r.data, valor: r.valor, hora: r.hora || '', obs: '' }; });
    notas.forEach((n) => { (dias[n.data] = dias[n.data] || { data: n.data, valor: null, hora: '', obs: '' }).obs = n.texto; });
    let lista = Object.keys(dias).sort().reverse().map((d) => dias[d]);
    if (estado.faixa === 'atencao') lista = lista.filter((x) => x.valor !== null && x.valor >= fx.atencao);
    if (estado.faixa === 'alta') lista = lista.filter((x) => x.valor !== null && x.valor >= fx.alta);
    const filtros = [['todos', 'Todos os dias'], ['atencao', 'Atenção e Alta'], ['alta', 'Só Alta']];
    const barra = legendaFaixas(fx) + '<div class="chips" role="group" aria-label="Faixa dos dias mostrados">' +
      filtros.map((f) => '<button type="button" class="chip" data-faixa="' + f[0] + '" aria-pressed="' + (estado.faixa === f[0]) + '">' + f[1] + '</button>').join('') + '</div>';
    if (!lista.length) return barra + vazio('Nenhum dia com esses filtros.');
    const mostrar = lista.slice(0, estado.linhas);
    const linhas = mostrar.map((x) => '<tr><td>' + G.dataBR(x.data) + '<span class="d">' + G.diaSemana(x.data) + '</span></td>' +
      '<td class="n valor">' + (x.valor === null ? '—' : val(x.valor)) + '</td><td>' + (x.valor === null ? '' : chipFaixa(x.valor, fx)) + '</td>' +
      '<td>' + esc(x.hora) + '</td><td class="obs">' + esc(x.obs) + '</td></tr>').join('');
    return barra + '<p class="dica">' + lista.length + (lista.length === 1 ? ' dia' : ' dias') + ' (mais recente primeiro).</p>' +
      '<div class="rolagem-x"><table class="tabela tabela-detalhe"><caption class="so-leitor">Detalhamento diário do jejum</caption>' +
      '<thead><tr><th scope="col">Data</th><th scope="col" class="n">Jejum</th><th scope="col">Faixa</th><th scope="col">Hora</th><th scope="col">Observação</th></tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      (lista.length > mostrar.length ? '<button type="button" class="botao botao-sec" id="painel-mais">Mostrar mais ' + Math.min(60, lista.length - mostrar.length) + ' (restam ' + (lista.length - mostrar.length) + ')</button>' : '');
  }

  /* ---------- gráficos (SVG sem biblioteca; a largura vem do contêiner) ---------- */

  const medidas = (alvo, proporcao) => {
    const W = Math.max(280, Math.round(alvo.clientWidth || 340));
    return { W: W, H: Math.round(Math.min(340, Math.max(210, W * proporcao))) };
  };

  function eixoY(vals, extras) {
    let lo = Math.min.apply(null, vals.concat(extras)), hi = Math.max.apply(null, vals.concat(extras));
    const passo = [10, 20, 25, 50, 100].filter((p) => (hi - lo) / p <= 7)[0] || 100;
    lo = Math.floor((lo - 5) / passo) * passo;
    hi = Math.ceil((hi + 5) / passo) * passo;
    return { lo: lo, hi: hi, passo: passo };
  }

  function grade(m, W, H, ey, Y, ticksX) {
    let s = '';
    for (let v = ey.lo; v <= ey.hi; v += ey.passo) {
      s += '<line class="' + (v === ey.lo ? 'g-eixo' : 'g-grade') + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>';
      s += '<text x="' + (m.l - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }
    return s + (ticksX || '');
  }

  function bandas(m, W, Y, ey, fx) {
    const x = m.l, w = W - m.l - m.r;
    const faixaRect = (cls, a, b) => (b > a ? '<rect class="banda ' + cls + '" x="' + x + '" width="' + w + '" y="' + Y(b).toFixed(1) + '" height="' + (Y(a) - Y(b)).toFixed(1) + '"/>' : '');
    return faixaRect('b-normal', ey.lo, Math.min(fx.atencao, ey.hi)) + faixaRect('b-atencao', Math.max(fx.atencao, ey.lo), Math.min(fx.alta, ey.hi)) + faixaRect('b-alta', Math.max(fx.alta, ey.lo), ey.hi);
  }

  /* Pedaços de linha: um buraco de mais de 4 dias sem registro interrompe a linha (nada de ligar pontos distantes). */
  function caminhos(serie, X, Y, campo) {
    const partes = [];
    let atual = [];
    serie.forEach((p, i) => {
      if (i && G.diaNum(p.data) - G.diaNum(serie[i - 1].data) > 4) { partes.push(atual); atual = []; }
      atual.push(X(p.data).toFixed(1) + ' ' + Y(p[campo]).toFixed(1));
    });
    partes.push(atual);
    return partes.filter((a) => a.length > 1).map((a) => 'M' + a.join(' L')).join(' ');
  }

  /* Área preenchida sob a linha, respeitando os mesmos buracos de 4+ dias. */
  function areas(serie, X, Y, campo, baseY) {
    const partes = [];
    let atual = [];
    serie.forEach((p, i) => {
      if (i && G.diaNum(p.data) - G.diaNum(serie[i - 1].data) > 4) { partes.push(atual); atual = []; }
      atual.push([X(p.data), Y(p[campo])]);
    });
    partes.push(atual);
    return partes.filter((a) => a.length > 1).map((a) => {
      const linha = a.map((pt, i) => (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ');
      return linha + ' L' + a[a.length - 1][0].toFixed(1) + ' ' + baseY.toFixed(1) + ' L' + a[0][0].toFixed(1) + ' ' + baseY.toFixed(1) + ' Z';
    }).join(' ');
  }

  function dicaFlutuante(alvo, svgEl, W, itens, aoMostrar) {
    const dica = alvo.querySelector('.dica-flutuante');
    const cruz = svgEl.querySelector('.g-cruz');
    function mostrar(ev) {
      const r = svgEl.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let melhor = null, dist = Infinity;
      itens.forEach((it) => { const d = Math.abs(it.x - px); if (d < dist) { dist = d; melhor = it; } });
      if (!melhor) return;
      if (cruz) { cruz.removeAttribute('hidden'); cruz.setAttribute('x1', melhor.x); cruz.setAttribute('x2', melhor.x); }
      dica.innerHTML = aoMostrar(melhor);
      dica.hidden = false;
      const larg = alvo.clientWidth, w = dica.offsetWidth;
      dica.style.left = Math.max(0, Math.min(larg - w, (melhor.x / W) * larg - w / 2)) + 'px';
    }
    svgEl.addEventListener('pointermove', mostrar);
    svgEl.addEventListener('pointerdown', mostrar);
    svgEl.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') { if (cruz) cruz.setAttribute('hidden', ''); dica.hidden = true; } });
  }

  function graficoVisao(alvo, serie, notas, fx) {
    if (!alvo) return;
    if (serie.length < 2) { alvo.innerHTML = vazio('O gráfico aparece com pelo menos 2 registros neste filtro.'); return; }
    const { W, H } = medidas(alvo, 0.5);
    const m = { t: 12, r: 12, b: 30, l: 38 };
    const datas = serie.map((p) => G.diaNum(p.data)).concat(notas.map((n) => G.diaNum(n.data)));
    const t0 = Math.min.apply(null, datas), t1 = Math.max.apply(null, datas), span = Math.max(1, t1 - t0);
    const vals = [];
    serie.forEach((p) => vals.push(p.valor, p.media));
    const ey = eixoY(vals, [fx.atencao, fx.alta]);
    const X = (iso) => m.l + ((G.diaNum(iso) - t0) / span) * (W - m.l - m.r);
    const Y = (v) => m.t + ((ey.hi - v) / (ey.hi - ey.lo)) * (H - m.t - m.b);
    const meses = span > 120;
    let ticks = '';
    for (let i = 0; i <= 4; i++) {
      const iso = new Date(Math.round(t0 + (span * i) / 4) * 86400000).toISOString().slice(0, 10);
      ticks += '<text x="' + X(iso).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + (i === 0 ? 'start' : i === 4 ? 'end' : 'middle') + '">' + (meses ? G.mesAno(iso) : G.dataCurta(iso)) + '</text>';
    }
    const baseY = Y(ey.lo);
    let svg = bandas(m, W, Y, ey, fx) + grade(m, W, H, ey, Y, ticks);
    // área sob cada linha (dourado da média móvel embaixo, azul do dia por cima), como na referência
    svg += '<path class="g-area-mm" d="' + areas(serie, X, Y, 'media', baseY) + '"/>';
    svg += '<path class="g-area-dia" d="' + areas(serie, X, Y, 'valor', baseY) + '"/>';
    svg += '<path class="g-linha-dia" d="' + caminhos(serie, X, Y, 'valor') + '"/><path class="g-linha-mm" d="' + caminhos(serie, X, Y, 'media') + '"/>';
    const raio = serie.length > 200 ? 1.8 : serie.length > 90 ? 2.5 : 3.5;
    serie.forEach((p) => { svg += '<circle class="g-ponto" cx="' + X(p.data).toFixed(1) + '" cy="' + Y(p.valor).toFixed(1) + '" r="' + raio + '"/>'; });
    notas.forEach((n) => { const x = X(n.data), y = H - m.b; svg += '<path class="g-nota" d="M' + (x - 4.5).toFixed(1) + ' ' + y + ' L' + (x + 4.5).toFixed(1) + ' ' + y + ' L' + x.toFixed(1) + ' ' + (y - 8) + ' Z"/>'; });
    // rótulos de valor sobre os pontos: conforme a largura. No PC cabe um mês; no celular, poucos dias.
    // o rótulo do dia aparece mais cedo; o da média móvel só em períodos bem curtos, para não poluir.
    const larguraPlot = W - m.l - m.r;
    const maxDia = Math.floor(larguraPlot / 30);
    const maxMM = Math.floor(larguraPlot / 70);
    if (serie.length <= maxDia) {
      serie.forEach((p) => {
        svg += '<text class="rotulo-dia" x="' + X(p.data).toFixed(1) + '" y="' + (Y(p.valor) - 8).toFixed(1) + '" text-anchor="middle">' + val(p.valor) + '</text>';
        if (serie.length <= maxMM && Math.abs(Y(p.valor) - Y(p.media)) > 13) svg += '<text class="rotulo-mm" x="' + X(p.data).toFixed(1) + '" y="' + (Y(p.media) + 15).toFixed(1) + '" text-anchor="middle">' + num(p.media, 0) + '</text>';
      });
    }
    svg += '<line class="g-cruz" hidden y1="' + m.t + '" y2="' + (H - m.b) + '"/>';
    alvo.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfico do jejum diário e da média móvel de 7 dias, com as faixas Normal, Atenção e Alta. A página Detalhamento Diário traz os mesmos valores em tabela.">' + svg + '</svg><div class="dica-flutuante" hidden></div>';
    const porData = {};
    serie.forEach((p) => { porData[p.data] = { data: p.data, p: p }; });
    notas.forEach((n) => { (porData[n.data] = porData[n.data] || { data: n.data }).nota = n.texto; });
    const itens = Object.keys(porData).map((d) => Object.assign({ x: X(d) }, porData[d]));
    dicaFlutuante(alvo, alvo.querySelector('svg'), W, itens, (it) =>
      '<strong>' + G.diaSemana(it.data) + ' ' + G.dataBR(it.data) + '</strong>' +
      (it.p ? 'Jejum: ' + val(it.p.valor) + ' mg/dL<br>' + chipFaixa(it.p.valor, fx) + '<br>Média móvel 7d: ' + num(it.p.media, 0) : 'Sem medição neste dia') +
      (it.nota ? '<br><em>' + esc(it.nota) + '</em>' : ''));
  }

  function graficoSemana(alvo, dias, fx) {
    if (!alvo) return;
    const com = dias.filter((d) => d.media !== null);
    if (!com.length) { alvo.innerHTML = vazio('Sem registros neste filtro.'); return; }
    const { W, H } = medidas(alvo, 0.5);
    const m = { t: 14, r: 12, b: 30, l: 38 };
    const ey = eixoY(com.map((d) => d.media), [fx.atencao]);
    const Y = (v) => m.t + ((ey.hi - v) / (ey.hi - ey.lo)) * (H - m.t - m.b);
    const X = (i) => m.l + ((i + 0.5) / 7) * (W - m.l - m.r);
    let ticks = '';
    dias.forEach((d, i) => { ticks += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle">' + d.nome + '</text>'; });
    let svg = bandas(m, W, Y, ey, fx) + grade(m, W, H, ey, Y, ticks);
    svg += '<path class="g-linha-mm" d="' + caminhos(dias.map((d, i) => ({ data: new Date(Date.UTC(2000, 0, 3 + i)).toISOString().slice(0, 10), media: d.media === null ? 0 : d.media })).filter((_, i) => dias[i].media !== null), (iso) => X(Math.round((G.diaNum(iso) - G.diaNum('2000-01-03')))), Y, 'media') + '" style="opacity:.35"/>';
    dias.forEach((d, i) => {
      if (d.media === null) return;
      svg += '<circle class="g-ponto grande" cx="' + X(i).toFixed(1) + '" cy="' + Y(d.media).toFixed(1) + '" r="6"><title>' + d.nome + ': média ' + num(d.media, 0) + ' mg/dL em ' + d.n + ' dias</title></circle>';
      svg += '<text class="rotulo-direto" x="' + X(i).toFixed(1) + '" y="' + (Y(d.media) - 11).toFixed(1) + '" text-anchor="middle">' + num(d.media, 0) + '</text>';
    });
    alvo.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Média do jejum por dia da semana: ' + com.map((d) => d.nome + ' ' + num(d.media, 0)).join(', ') + '.">' + svg + '</svg>';
  }

  function marcador(cls, x, y) {
    if (cls === 'atencao') return '<rect class="mk mk-atencao" x="' + (x - 3.5).toFixed(1) + '" y="' + (y - 3.5).toFixed(1) + '" width="7" height="7"/>';
    if (cls === 'alta') return '<path class="mk mk-alta" d="M' + (x - 4.5).toFixed(1) + ' ' + (y + 3.5).toFixed(1) + ' L' + (x + 4.5).toFixed(1) + ' ' + (y + 3.5).toFixed(1) + ' L' + x.toFixed(1) + ' ' + (y - 5).toFixed(1) + ' Z"/>';
    return '<circle class="mk mk-normal" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="3.6"/>';
  }

  function graficoHora(alvo, pts, fx) {
    if (!alvo) return;
    if (pts.length < 2) { alvo.innerHTML = vazio('Poucos dias com hora registrada neste filtro (' + pts.length + '). A hora é opcional na tela Hoje e vem da coluna horaJejum ao importar.'); return; }
    const { W, H } = medidas(alvo, 0.55);
    const m = { t: 12, r: 14, b: 34, l: 38 };
    let x0 = Math.floor(Math.min.apply(null, pts.map((p) => p.x)) * 2) / 2 - 0.5, x1 = Math.ceil(Math.max.apply(null, pts.map((p) => p.x)) * 2) / 2 + 0.5;
    if (x1 - x0 < 2) x1 = x0 + 2;
    const ey = eixoY(pts.map((p) => p.y), [fx.atencao]);
    const Y = (v) => m.t + ((ey.hi - v) / (ey.hi - ey.lo)) * (H - m.t - m.b);
    const X = (h) => m.l + ((h - x0) / (x1 - x0)) * (W - m.l - m.r);
    let ticks = '';
    for (let h = Math.ceil(x0); h <= x1; h += (x1 - x0) > 6 ? 2 : 1) {
      ticks += '<text x="' + X(h).toFixed(1) + '" y="' + (H - 16) + '" text-anchor="middle">' + h + 'h</text>';
    }
    ticks += '<text x="' + ((m.l + W - m.r) / 2) + '" y="' + (H - 3) + '" text-anchor="middle">Hora da coleta</text>';
    let svg = bandas(m, W, Y, ey, fx) + grade(m, W, H, ey, Y, ticks);
    pts.forEach((p) => { svg += marcador(G.classificar(p.y, fx), X(p.x), Y(p.y)); });
    alvo.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Dispersão da hora da coleta contra o valor do jejum, ' + pts.length + ' dias.">' + svg + '</svg><div class="dica-flutuante" hidden></div>';
    dicaFlutuante(alvo, alvo.querySelector('svg'), W, pts.map((p) => ({ x: X(p.x), p: p })), (it) =>
      '<strong>' + G.dataBR(it.p.data) + '</strong>Hora: ' + String(Math.floor(it.p.x)).padStart(2, '0') + ':' + String(Math.round((it.p.x % 1) * 60)).padStart(2, '0') + '<br>Jejum: ' + val(it.p.y) + ' mg/dL<br>' + chipFaixa(it.p.y, fx));
  }

  /* ---------- montagem ---------- */

  function desenhar(el, dados) {
    ultimo = { el: el, dados: dados };
    const fx = dados.faixas;
    const regs = G.filtrarPainel(dados.registros, estado.filtros);
    const notas = G.filtrarPainel(dados.notas.filter((n) => n.texto), estado.filtros);
    const pag = PAGINAS.filter((p) => p.id === estado.pagina)[0] || PAGINAS[0];
    let corpo = '';
    if (!dados.registros.length && !notas.length) corpo = vazio('Sem registros ainda. Anote o primeiro na aba Hoje ou importe o histórico na aba Dados.');
    else if (pag.id === 'visao') corpo = paginaVisao(regs, notas, fx);
    else if (pag.id === 'mes') corpo = paginaMes(regs, fx);
    else if (pag.id === 'rotina') corpo = paginaRotina(regs, fx);
    else corpo = paginaDetalhe(regs, notas, fx);
    el.innerHTML = '<div class="painel">' + lateral(dados.registros) + '<div class="painel-principal">' + topo(pag) + corpo + '</div></div>';

    if (pag.id === 'visao') graficoVisao(el.querySelector('#g-visao'), G.filtrarPainel(G.serieMediaMovel(dados.registros, 7), estado.filtros), notas, fx);
    if (pag.id === 'rotina') { graficoSemana(el.querySelector('#g-semana'), G.porDiaSemana(regs), fx); graficoHora(el.querySelector('#g-hora'), G.pontosHora(regs), fx); }

    el.querySelectorAll('[data-pagina]').forEach((b) => b.addEventListener('click', () => { estado.pagina = b.dataset.pagina; estado.linhas = 60; desenhar(el, dados); window.scrollTo(0, 0); }));
    el.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
      const lista = estado.filtros[b.dataset.filtro], v = +b.dataset.valor, i = lista.indexOf(v);
      if (i > -1) lista.splice(i, 1); else lista.push(v);
      estado.linhas = 60;
      desenhar(el, dados);
    }));
    el.querySelectorAll('[data-faixa]').forEach((b) => b.addEventListener('click', () => { estado.faixa = b.dataset.faixa; estado.linhas = 60; desenhar(el, dados); }));
    const limpar = el.querySelector('#painel-limpar');
    if (limpar) limpar.addEventListener('click', () => { estado.filtros = { anos: [], meses: [], dias: [] }; desenhar(el, dados); });
    const mais = el.querySelector('#painel-mais');
    if (mais) mais.addEventListener('click', () => { estado.linhas += 60; desenhar(el, dados); });
    const det = el.querySelector('details.filtros');
    if (det) det.addEventListener('toggle', () => { estado.filtrosAbertos = det.open; });
  }

  let esperaRedesenho = null;
  window.addEventListener('resize', () => {
    clearTimeout(esperaRedesenho);
    esperaRedesenho = setTimeout(() => {
      if (ultimo && ultimo.el.isConnected && ultimo.el.offsetParent !== null) desenhar(ultimo.el, ultimo.dados);
    }, 200);
  });

  window.Painel = { desenhar: desenhar };
}());
