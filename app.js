/* app.js - tela e armazenamento. As regras ficam em logic.js. */
(function () {
  'use strict';

  const G = window.Glic;
  const CHAVE = 'glicemia-diaria:v1';
  const DIAS_SEM_BACKUP = 30;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ---------- estado e armazenamento ---------- */

  let estado = {
    registros: [],            // { data, valor, ts }  ts = hora da última alteração (para sincronizar)
    apagados: [],             // { data, ts }         dias excluídos (a exclusão também sincroniza)
    notas: [],                // { data, texto, ts }  observações do dia (opcional, sincroniza)
    faixas: Object.assign({}, G.FAIXAS_PADRAO),
    faixasTs: 0,
    janela: 7,
    periodo: 90,
    ultimoBackup: null,
    sinc: { ativa: false, ultima: null },
  };

  function carregar() {
    try {
      const bruto = localStorage.getItem(CHAVE);
      if (!bruto) return;
      const o = JSON.parse(bruto);
      const n = G.normalizarEstado(o);
      estado.registros = n.registros;
      estado.apagados = n.apagados;
      estado.notas = n.notas;
      estado.faixas = n.faixas;
      estado.faixasTs = n.faixasTs;
      if ([7, 14, 30].indexOf(o.janela) > -1) estado.janela = o.janela;
      if ([0, 30, 90].indexOf(o.periodo) > -1) estado.periodo = o.periodo;
      if (typeof o.ultimoBackup === 'string') estado.ultimoBackup = o.ultimoBackup;
      if (o.sinc && typeof o.sinc === 'object') {
        estado.sinc = { ativa: o.sinc.ativa === true, ultima: typeof o.sinc.ultima === 'string' ? o.sinc.ultima : null };
      }
    } catch (e) { /* começa vazio */ }
  }

  /* Faz a mudança, grava e agenda a sincronização. Se não conseguir gravar, desfaz tudo. */
  function alterar(mudar) {
    const copia = JSON.parse(JSON.stringify(estado));
    mudar();
    if (salvar()) { agendarSinc(); return true; }
    Object.assign(estado, copia);
    return false;
  }

  function salvar() {
    try {
      localStorage.setItem(CHAVE, JSON.stringify(estado));
      return true;
    } catch (e) {
      avisar('Não consegui salvar neste aparelho. Exporte um backup agora.');
      return false;
    }
  }

  /* ---------- utilidades de tela ---------- */

  let temporizadorAviso = null;
  function avisar(texto) {
    const el = $('#aviso');
    el.textContent = texto;
    el.classList.add('mostra');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => el.classList.remove('mostra'), 4200);
  }

  const ROTULO_FAIXA = { normal: 'Normal', atencao: 'Atenção', alta: 'Alta' };
  const ICONE_FAIXA = { normal: '✓', atencao: '!', alta: '▲' };

  function chipFaixa(valor) {
    const c = G.classificar(valor, estado.faixas);
    return '<span class="faixa f-' + c + '"><span class="ico" aria-hidden="true">' + ICONE_FAIXA[c] + '</span>' + ROTULO_FAIXA[c] + '</span>';
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function baixarArquivo(nome, texto, tipo) {
    const blob = new Blob([texto], { type: tipo });
    const arquivo = new File([blob], nome, { type: tipo });
    // No celular o menu de compartilhar deixa salvar em Arquivos, Drive, WhatsApp etc.
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      return navigator.share({ files: [arquivo], title: nome }).then(() => true).catch((e) => (e && e.name === 'AbortError' ? false : baixarLink(blob, nome)));
    }
    return Promise.resolve(baixarLink(blob, nome));
  }

  function baixarLink(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  }

  /* ---------- navegação ---------- */

  const TELAS = ['hoje', 'relatorio', 'painel', 'dados'];

  function mostrarTela(nome) {
    if (TELAS.indexOf(nome) < 0) nome = 'hoje';
    TELAS.forEach((t) => { $('#tela-' + t).hidden = t !== nome; });
    $$('.aba').forEach((b) => {
      if (b.dataset.tela === nome) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (nome === 'relatorio') desenharRelatorio();
    if (nome === 'painel') desenharPainel();
    if (nome === 'dados') desenharDados();
    if (nome === 'hoje') desenharHoje();
    window.scrollTo(0, 0);
    try { history.replaceState(null, '', '#' + nome); } catch (e) { /* ignora */ }
  }

  /* ---------- tela Hoje ---------- */

  /* Grava, atualiza ou remove a observação de um dia (texto vazio = remover). */
  function definirNota(data, texto, agora) {
    const outras = estado.notas.filter((n) => n.data !== data);
    const atual = estado.notas.find((n) => n.data === data);
    if (texto) estado.notas = G.ordenar(outras.concat([{ data: data, texto: texto, ts: agora }]));
    else if (atual) estado.notas = G.ordenar(outras.concat([{ data: data, texto: '', ts: agora }]));
  }

  /* App aberto em segundo plano atravessa a meia-noite: o campo "Dia" precisa acompanhar,
     senão o valor de hoje sobrescreve o registro de ontem. Só acompanha se o usuário não escolheu outro dia. */
  let diaAtual = G.hojeISO();
  function verificarVirada() {
    const hoje = G.hojeISO();
    if (hoje === diaAtual) return;
    const inData = $('#in-data');
    const seguia = !inData.value || inData.value === diaAtual;
    diaAtual = hoje;
    if (seguia) inData.value = hoje;
    if (!$('#tela-hoje').hidden) desenharHoje();
    else if (!$('#tela-relatorio').hidden) desenharRelatorio();
  }

  function registroDoDia(data) {
    return estado.registros.find((r) => r.data === data);
  }

  function notaDoDia(data) {
    const n = estado.notas.find((x) => x.data === data);
    return n ? n.texto : '';
  }

  function desenharPainel() {
    window.Painel.desenhar($('#painel-raiz'), { registros: estado.registros, notas: estado.notas, faixas: estado.faixas });
  }

  function atualizarFormulario(preencher) {
    const data = $('#in-data').value;
    const existente = data ? registroDoDia(data) : null;
    if (preencher) {
      $('#in-valor').value = existente ? String(existente.valor).replace('.', ',') : '';
      $('#in-hora').value = existente && existente.hora ? existente.hora : '';
      $('#in-obs').value = notaDoDia(data);
      const ex = $('#extra-dia');
      if (ex) ex.open = !!((existente && existente.hora) || notaDoDia(data));
    }
    $('#btn-excluir').hidden = !existente;
    atualizarMensagem(existente);
  }

  function atualizarMensagem(existente) {
    const v = G.parseNumero($('#in-valor').value);
    const msg = $('#msg-registro');
    if (v !== null && v >= G.VALOR_MIN && v <= G.VALOR_MAX) {
      const troca = existente && G.arredonda1(v) !== existente.valor;
      msg.innerHTML = chipFaixa(v) + (troca ? ' · este dia tinha ' + G.fmt(existente.valor, existente.valor % 1 ? 1 : 0) + ', salvar substitui' : '');
    } else {
      msg.textContent = '';
    }
  }

  function desenharHoje(manter) {
    const hoje = G.hojeISO();
    $('#hoje-extenso').textContent = G.dataExtenso(hoje);
    desenharSincHoje();
    const inData = $('#in-data');
    inData.max = hoje;
    if (!inData.value) inData.value = hoje;
    atualizarFormulario(!manter);

    // últimos registros
    const ul = $('#lista-recentes');
    const ult = estado.registros.slice(-5).reverse();
    if (!ult.length) {
      ul.innerHTML = '<li class="vazio">Nenhum registro ainda. Digite a taxa de hoje, ou importe o histórico da planilha na aba Dados.</li>';
    } else {
      ul.innerHTML = ult.map((r) =>
        '<li><button type="button" data-data="' + r.data + '" aria-label="Editar ' + G.dataBR(r.data) + ', ' + G.fmt(r.valor, r.valor % 1 ? 1 : 0) + ' miligramas por decilitro">' +
        '<span>' + G.diaSemana(r.data) + ' ' + G.dataBR(r.data) + '</span>' +
        '<span class="num">' + G.fmt(r.valor, r.valor % 1 ? 1 : 0) + '</span>' +
        chipFaixa(r.valor) + '</button></li>').join('');
    }

    // lembrete de backup
    const aviso = $('#aviso-backup');
    if (!estado.registros.length) { aviso.hidden = true; return; }
    const dias = estado.ultimoBackup ? G.diaNum(hoje) - G.diaNum(estado.ultimoBackup) : null;
    if (dias === null) {
      $('#aviso-backup-texto').textContent = 'Você ainda não fez backup. Se o celular for perdido ou formatado, o histórico vai junto.';
      aviso.hidden = false;
    } else if (dias >= DIAS_SEM_BACKUP) {
      $('#aviso-backup-texto').textContent = 'Último backup há ' + dias + ' dias. Vale gerar um novo.';
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }
  }

  function salvarRegistro(ev) {
    ev.preventDefault();
    const data = $('#in-data').value;
    const v = G.parseNumero($('#in-valor').value);
    const msg = $('#msg-registro');
    if (!data || !G.parseData(data)) { msg.textContent = 'Escolha o dia do registro.'; return; }
    if (data > G.hojeISO()) { msg.textContent = 'Essa data ainda não chegou.'; return; }
    if (v === null || v < G.VALOR_MIN || v > G.VALOR_MAX) {
      msg.textContent = 'Digite um valor entre ' + G.VALOR_MIN + ' e ' + G.VALOR_MAX + '.';
      $('#in-valor').focus();
      return;
    }
    const valor = G.arredonda1(v);
    const hora = G.parseHora($('#in-hora').value);
    const obs = G.sanitizarObs($('#in-obs').value);
    const agora = Date.now();
    const gravou = alterar(() => {
      const reg = { data: data, valor: valor, ts: agora };
      if (hora) reg.hora = hora;
      estado.registros = G.mesclar(estado.registros, [reg], true).registros;
      estado.apagados = estado.apagados.filter((a) => a.data !== data);
      definirNota(data, obs, agora);
    });
    if (!gravou) return;
    avisar('Salvo: ' + G.fmt(valor, valor % 1 ? 1 : 0) + ' mg/dL em ' + G.dataBR(data));
    $('#in-valor').blur();
    desenharHoje();
  }

  function excluirRegistro() {
    const data = $('#in-data').value;
    const r = registroDoDia(data);
    if (!r) return;
    if (!window.confirm('Excluir o registro de ' + G.dataBR(data) + ' (' + G.fmt(r.valor, r.valor % 1 ? 1 : 0) + ' mg/dL)?')) return;
    const agora = Date.now();
    const gravou = alterar(() => {
      estado.registros = estado.registros.filter((x) => x.data !== data);
      estado.apagados = estado.apagados.filter((a) => a.data !== data).concat([{ data: data, ts: agora }]);
      definirNota(data, '', agora);
    });
    if (!gravou) return;
    avisar('Registro excluído');
    desenharHoje();
  }

  /* ---------- tela Relatório ---------- */

  function desenharRelatorio() {
    const todos = estado.registros;
    $('#sel-janela').value = String(estado.janela);
    $$('.chip').forEach((c) => c.setAttribute('aria-pressed', String(+c.dataset.dias === estado.periodo)));

    const f = estado.faixas;
    $('#rodape-faixas').textContent = 'Faixas: normal abaixo de ' + f.atencao + ' · atenção de ' + f.atencao + ' a ' + (f.alta - 1) +
      ' · alta a partir de ' + f.alta + ' mg/dL. Ajustáveis na aba Dados.';

    if (!todos.length) {
      $('#rel-subtitulo').textContent = 'Sem registros ainda';
      $('#kpi-media').textContent = '—';
      $('#kpi-media-nota').textContent = '';
      $('#kpi-mm').textContent = '—';
      $('#kpi-mm-nota').textContent = '';
      $('#legenda').innerHTML = '';
      $('#grafico').innerHTML = '';
      $('#tabela-area').innerHTML = '<p class="vazio">Sem registros para mostrar. Anote o primeiro na aba Hoje ou importe o histórico na aba Dados.</p>';
      return;
    }

    const serieTodos = G.serieMediaMovel(todos, estado.janela);
    const ultimo = serieTodos[serieTodos.length - 1];
    const mediaGeral = G.media(todos.map((r) => r.valor));
    $('#rel-subtitulo').textContent = G.dataBR(todos[0].data) + ' a ' + G.dataBR(todos[todos.length - 1].data);
    $('#kpi-media').textContent = G.fmt(mediaGeral, 0);
    $('#kpi-media-nota').textContent = 'em ' + todos.length + (todos.length === 1 ? ' dia' : ' dias') + ' registrados';
    $('#kpi-mm').textContent = G.fmt(ultimo.media, 0);
    const atraso = G.diaNum(G.hojeISO()) - G.diaNum(ultimo.data);
    $('#kpi-mm-nota').textContent = 'até ' + G.dataBR(ultimo.data) + (atraso > 1 ? ' · último registro há ' + atraso + ' dias' : '');

    // período (a média móvel de cada dia sempre usa o histórico completo)
    const hoje = G.hojeISO();
    const cortePeriodo = estado.periodo ? G.diaNum(hoje) - estado.periodo : null;
    const serie = serieTodos.filter((p) => cortePeriodo === null || G.diaNum(p.data) > cortePeriodo);

    desenharGrafico(serie);
    desenharTabela(serie);
  }

  function desenharTabela(serie) {
    const area = $('#tabela-area');
    if (!serie.length) {
      area.innerHTML = '<p class="vazio">Sem registros neste período. Escolha "Tudo" para ver o histórico.</p>';
      return;
    }
    const linhas = serie.slice().reverse().map((p) =>
      '<tr><td>' + G.dataBR(p.data) + '<span class="d">' + G.diaSemana(p.data) + '</span></td>' +
      '<td class="n valor">' + G.fmt(p.valor, p.valor % 1 ? 1 : 0) + '</td>' +
      '<td>' + chipFaixa(p.valor) + '</td>' +
      '<td class="n">' + G.fmt(p.media, 0) + '</td></tr>').join('');
    area.innerHTML = '<table class="tabela"><caption class="so-leitor">Detalhamento diário da glicemia em jejum, mais recente primeiro</caption>' +
      '<thead><tr><th scope="col">Data</th><th scope="col" class="n">mg/dL</th><th scope="col">Faixa</th><th scope="col" class="n">Média ' + estado.janela + 'd</th></tr></thead>' +
      '<tbody>' + linhas + '</tbody></table>';
  }

  /* ---------- gráfico (SVG, sem biblioteca) ---------- */

  function desenharGrafico(serie) {
    const el = $('#grafico');
    $('#legenda').innerHTML = '<span><i class="marca-ponto"></i>Glicemia do dia</span><span><i class="marca-linha"></i>Média móvel (' + estado.janela + ' dias)</span>' +
      '<span><i class="marca-ref"></i>Limites ' + estado.faixas.atencao + ' e ' + estado.faixas.alta + '</span>';
    if (serie.length < 2) {
      el.innerHTML = '<p class="vazio">O gráfico aparece com pelo menos 2 registros no período.</p>';
      $('#grafico-legenda').textContent = '';
      return;
    }

    const W = 360, H = 230;
    const m = { t: 14, r: 44, b: 28, l: 38 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const f = estado.faixas;

    const t0 = G.diaNum(serie[0].data);
    const t1 = G.diaNum(serie[serie.length - 1].data);
    const span = Math.max(1, t1 - t0);

    const todos = [];
    serie.forEach((p) => { todos.push(p.valor, p.media); });
    let lo = Math.min.apply(null, todos.concat([f.atencao]));
    let hi = Math.max.apply(null, todos.concat([f.alta]));
    const amplitude = hi - lo + 10;
    const passo = amplitude <= 60 ? 10 : (amplitude <= 120 ? 20 : 50);
    lo = Math.floor((lo - 4) / passo) * passo;
    hi = Math.ceil((hi + 4) / passo) * passo;

    const X = (iso) => m.l + ((G.diaNum(iso) - t0) / span) * pw;
    const Y = (v) => m.t + ((hi - v) / (hi - lo)) * ph;

    let svg = '';
    for (let v = lo; v <= hi; v += passo) {
      svg += '<line class="' + (v === lo ? 'g-eixo' : 'g-grade') + '" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/>';
      svg += '<text x="' + (m.l - 6) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + '</text>';
    }
    // linhas de referência das faixas (o valor está na legenda)
    [f.atencao, f.alta].forEach((ref) => {
      if (ref > lo && ref < hi) {
        svg += '<line class="g-ref" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(ref).toFixed(1) + '" y2="' + Y(ref).toFixed(1) + '"/>';
      }
    });
    // rótulos do eixo x
    const meses = span > 120;
    const nTicks = 4;
    for (let i = 0; i <= nTicks; i++) {
      const dia = Math.round(t0 + (span * i) / nTicks);
      const iso = new Date(dia * 86400000).toISOString().slice(0, 10);
      const anc = i === 0 ? 'start' : (i === nTicks ? 'end' : 'middle');
      svg += '<text x="' + X(iso).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="' + anc + '">' + (meses ? G.mesAno(iso) : G.dataCurta(iso)) + '</text>';
    }

    const caminho = (campo) => serie.map((p, i) => (i ? 'L' : 'M') + X(p.data).toFixed(1) + ' ' + Y(p[campo]).toFixed(1)).join(' ');
    svg += '<path class="g-linha-dia" d="' + caminho('valor') + '"/>';
    svg += '<path class="g-linha-mm" d="' + caminho('media') + '"/>';
    if (serie.length <= 45) {
      serie.forEach((p) => { svg += '<circle class="g-ponto" cx="' + X(p.data).toFixed(1) + '" cy="' + Y(p.valor).toFixed(1) + '" r="4"/>'; });
    }

    // rótulos diretos na margem direita, na altura do último ponto de cada série
    const u = serie[serie.length - 1];
    let yDia = Y(u.valor);
    let yMed = Y(u.media);
    if (Math.abs(yDia - yMed) < 14) {
      const meio = (yDia + yMed) / 2;
      if (yDia <= yMed) { yDia = meio - 7; yMed = meio + 7; } else { yDia = meio + 7; yMed = meio - 7; }
    }
    svg += '<text class="rotulo-direto" x="' + (W - m.r + 6) + '" y="' + (yDia + 4).toFixed(1) + '" text-anchor="start">' + G.fmt(u.valor, u.valor % 1 ? 1 : 0) + '</text>';
    svg += '<text class="rotulo-direto" x="' + (W - m.r + 6) + '" y="' + (yMed + 4).toFixed(1) + '" text-anchor="start">' + G.fmt(u.media, 0) + '</text>';

    // cruz de leitura
    svg += '<g id="g-cruz" hidden><line class="g-cruz" id="g-cruz-l" y1="' + m.t + '" y2="' + (H - m.b) + '"/>' +
      '<circle class="g-ponto" id="g-cruz-a" r="5"/><circle id="g-cruz-b" r="5" fill="var(--serie-2)" stroke="var(--superficie)" stroke-width="2"/></g>';

    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Gráfico da glicemia em jejum e da média móvel de ' + estado.janela + ' dias. A tabela abaixo traz os mesmos valores.">' + svg + '</svg>' +
      '<div class="dica-flutuante" id="g-dica" hidden></div>';
    $('#grafico-legenda').textContent = 'Glicemia diária e média móvel de ' + estado.janela + ' dias, de ' + G.dataBR(serie[0].data) + ' a ' + G.dataBR(u.data) + '.';

    const svgEl = el.querySelector('svg');
    const dica = $('#g-dica');
    const cruz = $('#g-cruz');

    function mostrar(ev) {
      const r = svgEl.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let melhor = 0, dist = Infinity;
      for (let i = 0; i < serie.length; i++) {
        const d = Math.abs(X(serie[i].data) - px);
        if (d < dist) { dist = d; melhor = i; }
      }
      const p = serie[melhor];
      const x = X(p.data);
      cruz.removeAttribute('hidden');
      $('#g-cruz-l').setAttribute('x1', x); $('#g-cruz-l').setAttribute('x2', x);
      $('#g-cruz-a').setAttribute('cx', x); $('#g-cruz-a').setAttribute('cy', Y(p.valor));
      $('#g-cruz-b').setAttribute('cx', x); $('#g-cruz-b').setAttribute('cy', Y(p.media));
      dica.innerHTML = '<strong>' + G.diaSemana(p.data) + ' ' + G.dataBR(p.data) + '</strong>' +
        'Glicemia: ' + G.fmt(p.valor, p.valor % 1 ? 1 : 0) + ' mg/dL<br>' + chipFaixa(p.valor) + '<br>' +
        'Média móvel ' + estado.janela + 'd: ' + G.fmt(p.media, 0);
      dica.hidden = false;
      const larg = el.clientWidth;
      const alvo = (x / W) * larg;
      const w = dica.offsetWidth;
      dica.style.left = Math.max(0, Math.min(larg - w, alvo - w / 2)) + 'px';
    }
    svgEl.addEventListener('pointermove', mostrar);
    svgEl.addEventListener('pointerdown', mostrar);
    svgEl.addEventListener('pointerleave', (ev) => {
      if (ev.pointerType === 'mouse') { cruz.setAttribute('hidden', ''); dica.hidden = true; }
    });
  }

  /* ---------- tela Dados ---------- */

  let tabelaImportada = [];
  let colsImportacao = {};

  function desenharDados() {
    $('#fx-atencao').value = estado.faixas.atencao;
    $('#fx-alta').value = estado.faixas.alta;
    $('#txt-ultimo-backup').textContent = estado.ultimoBackup ? 'Último backup: ' + G.dataBR(estado.ultimoBackup) + '.' : 'Nenhum backup feito ainda.';
    desenharSinc();
  }

  function lerDadosImportacao() {
    const texto = $('#txt-colar').value;
    tabelaImportada = G.lerTabela(texto);
    if (!tabelaImportada.length) { avisar('Não encontrei linhas. Escolha um arquivo ou cole os dados.'); return; }
    const col = G.detectarColunas(tabelaImportada);
    if (col.colData < 0) { avisar('Não achei uma coluna de datas nesses dados.'); return; }
    colsImportacao = { colHora: col.colHora, colObs: col.colObs };

    const opcoes = Array.from({ length: col.ncols }, (_, i) => '<option value="' + i + '">Coluna ' + (i + 1) + '</option>').join('');
    $('#sel-col-data').innerHTML = opcoes;
    $('#sel-col-valor').innerHTML = opcoes;
    $('#sel-col-data').value = String(col.colData);
    $('#sel-col-valor').value = String(col.colValor >= 0 ? col.colValor : (col.colData === 0 ? Math.min(1, col.ncols - 1) : 0));
    $('#in-inicio').value = G.INICIO_PADRAO;

    const amostra = tabelaImportada.slice(0, 5).map((l) => '<tr>' + Array.from({ length: col.ncols }, (_, i) => '<td>' + esc(l[i] || '') + '</td>').join('') + '</tr>').join('');
    $('#previa-tabela').innerHTML = '<table><thead><tr>' + Array.from({ length: col.ncols }, (_, i) => '<th>Col. ' + (i + 1) + '</th>').join('') + '</tr></thead><tbody>' + amostra + '</tbody></table>';
    $('#imp-previa').hidden = false;
    atualizarResumoImportacao();
  }

  function extrairAtual() {
    const colData = +$('#sel-col-data').value;
    const ordem = G.detectarOrdemData(tabelaImportada, colData);
    return G.extrairRegistros(tabelaImportada, colData, +$('#sel-col-valor').value, {
      inicio: $('#in-inicio').value || G.INICIO_PADRAO, ordem: ordem,
      colHora: colsImportacao.colHora, colObs: colsImportacao.colObs,
    });
  }

  function atualizarResumoImportacao() {
    const r = extrairAtual();
    const ini = $('#in-inicio').value || G.INICIO_PADRAO;
    let t = '';
    if (!r.registros.length) {
      t = 'Nenhum registro válido com essas colunas. Confira as colunas escolhidas.';
    } else {
      t = 'Serão lidos ' + r.registros.length + ' registros, de ' + G.dataBR(r.registros[0].data) + ' a ' + G.dataBR(r.registros[r.registros.length - 1].data) + '.';
    }
    const fora = [];
    if (r.vazias) fora.push(r.vazias + ' dias sem valor');
    if (r.antesDoInicio) fora.push(r.antesDoInicio + ' antes de ' + G.dataBR(ini));
    if (r.foraDeFaixa) fora.push(r.foraDeFaixa + ' fora de ' + G.VALOR_MIN + ' a ' + G.VALOR_MAX);
    if (r.repetidas) fora.push(r.repetidas + ' repetidos (vale o último)');
    if (fora.length) t += ' Deixados de fora: ' + fora.join(', ') + '.';
    if (r.ordem === 'MDY') t += ' Datas lidas como mês/dia/ano.';
    $('#imp-resumo').textContent = t;
    $('#btn-importar').disabled = !r.registros.length;
  }

  function importar() {
    const r = extrairAtual();
    if (!r.registros.length) return;
    const agora = Date.now();
    const novos = r.registros.map((x) => { const reg = { data: x.data, valor: x.valor, ts: agora }; if (x.hora) reg.hora = x.hora; return reg; });
    let m = null;
    const gravou = alterar(() => {
      m = G.mesclar(estado.registros, novos, false);
      estado.registros = m.registros;
      estado.apagados = estado.apagados.filter((a) => !registroDoDia(a.data));
      // observações novas só entram em dias que ainda não têm observação
      const agora = Date.now();
      const tem = {};
      estado.notas.forEach((n) => { if (n.texto) tem[n.data] = true; });
      r.notas.forEach((n) => { if (!tem[n.data]) estado.notas = estado.notas.filter((x) => x.data !== n.data).concat([{ data: n.data, texto: n.texto, ts: agora }]); });
      estado.notas = G.ordenar(estado.notas);
    });
    if (!gravou) return;
    let t = m.adicionados + ' registros importados.';
    if (m.jaExistiam) t += ' ' + m.jaExistiam + ' dias já tinham valor e foram mantidos.';
    avisar(t);
    $('#imp-previa').hidden = true;
    $('#txt-colar').value = '';
    tabelaImportada = [];
  }

  function lerArquivoTexto(arquivo, aoLer) {
    const leitor = new FileReader();
    leitor.onload = () => aoLer(String(leitor.result || ''));
    leitor.onerror = () => avisar('Não consegui ler esse arquivo.');
    leitor.readAsText(arquivo);
  }

  function exportarBackup() {
    const nome = 'backup-glicemia-' + G.hojeISO() + '.json';
    baixarArquivo(nome, G.gerarBackup(estado), 'application/json').then((ok) => {
      if (!ok) return;
      estado.ultimoBackup = G.hojeISO();
      salvar();
      desenharDados();
      avisar('Backup gerado: ' + nome);
    });
  }

  function exportarCSV() {
    baixarArquivo('glicemia-' + G.hojeISO() + '.csv', G.gerarCSV(estado.registros, estado.notas), 'text/csv').then((ok) => { if (ok) avisar('CSV gerado'); });
  }

  function restaurarBackup(arquivo) {
    lerArquivoTexto(arquivo, (texto) => {
      let b;
      try { b = G.lerBackup(texto); } catch (e) { avisar(e.message); return; }
      if (estado.registros.length && !window.confirm('Substituir os ' + estado.registros.length + ' registros atuais pelos ' + b.registros.length + ' do backup?' +
        (estado.sinc.ativa ? ' Com a sincronização ligada, os outros aparelhos também passam a ter o conteúdo do backup.' : ''))) return;
      const agora = Date.now();
      const gravou = alterar(() => {
        const noBackup = {};
        b.registros.forEach((r) => { noBackup[r.data] = true; });
        // dias que existiam e não estão no backup viram "apagados", para a restauração valer nos outros aparelhos
        const sumiram = estado.registros.filter((r) => !noBackup[r.data]).map((r) => ({ data: r.data, ts: agora }));
        const antigos = estado.apagados.filter((a) => !noBackup[a.data]);
        estado.registros = b.registros.map((r) => { const x = { data: r.data, valor: r.valor, ts: agora }; if (r.hora) x.hora = r.hora; return x; });
        estado.apagados = antigos.concat(sumiram);
        estado.notas = G.ordenar((b.notas || []).map((n) => ({ data: n.data, texto: n.texto, ts: agora })));
        estado.faixas = b.faixas;
        estado.faixasTs = agora;
      });
      if (gravou) { avisar('Backup restaurado: ' + b.registros.length + ' registros'); desenharDados(); }
    });
  }

  function salvarFaixas() {
    const nova = { atencao: G.parseNumero($('#fx-atencao').value), alta: G.parseNumero($('#fx-alta').value) };
    const msg = $('#msg-faixas');
    if (!G.validarFaixas(nova)) {
      msg.textContent = 'Use números de ' + G.VALOR_MIN + ' a ' + G.VALOR_MAX + ', com a faixa de atenção menor que a alta.';
      return;
    }
    const gravou = alterar(() => { estado.faixas = nova; estado.faixasTs = Date.now(); });
    msg.textContent = gravou ? 'Faixas salvas.' : 'Não consegui salvar as faixas.';
  }

  function apagarTudo() {
    if (!estado.registros.length) { avisar('Não há dados para apagar.'); return; }
    if (!window.confirm('Apagar os ' + estado.registros.length + ' registros deste aparelho? Isso não pode ser desfeito.' +
      (estado.sinc.ativa ? ' Com a sincronização ligada, eles também serão apagados do Google Drive e dos outros aparelhos.' : ''))) return;
    const agora = Date.now();
    const gravou = alterar(() => {
      estado.apagados = estado.apagados.filter((a) => !registroDoDia(a.data)).concat(estado.registros.map((r) => ({ data: r.data, ts: agora })));
      estado.registros = [];
      estado.notas = G.ordenar(estado.notas.filter((n) => n.texto).map((n) => ({ data: n.data, texto: '', ts: agora })));
      estado.ultimoBackup = null;
    });
    if (!gravou) return;
    avisar('Dados apagados');
    desenharDados();
  }

  /* ---------- sincronização (Google Drive, pasta privada do app) ---------- */
  /* Escopo drive.appdata: o app só enxerga o arquivo que ele mesmo criou, numa pasta oculta da sua conta.
     O token de acesso fica só na memória. O script do Google só é carregado quando a sincronização está configurada. */

  const ESCOPO_DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
  const ARQUIVO_NUVEM = 'glicemia.json';
  const clienteId = () => String((window.GLIC_CONFIG && window.GLIC_CONFIG.clienteId) || '').trim();

  let gisPromessa = null;
  let clienteToken = null;
  let resolverToken = () => {};
  let token = null;
  let tokenValidoAte = 0;
  let sincEmCurso = null;
  let sincPendente = false;
  let sincMsg = '';
  let temporizadorSinc = null;

  function quando(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => (n < 10 ? '0' : '') + n;
    return G.dataBR(G.hojeISO(d)) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function carregarGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
    if (!gisPromessa) {
      gisPromessa = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => ok();
        s.onerror = () => { gisPromessa = null; falha(new Error('sem-rede')); };
        document.head.appendChild(s);
      });
    }
    return gisPromessa;
  }

  /* interativo = true abre a janela de login do Google; false só renova em silêncio (sem janela). */
  function obterToken(interativo) {
    if (token && Date.now() < tokenValidoAte - 60000) return Promise.resolve(token);
    return carregarGIS().then(() => new Promise((ok, falha) => {
      if (!clienteToken) {
        clienteToken = window.google.accounts.oauth2.initTokenClient({
          client_id: clienteId(),
          scope: ESCOPO_DRIVE,
          callback: (r) => resolverToken(r),
          error_callback: (e) => resolverToken({ error: (e && e.type) || 'erro' }),
        });
      }
      resolverToken = (r) => {
        if (r && r.access_token) { token = r.access_token; tokenValidoAte = Date.now() + (r.expires_in || 3600) * 1000; ok(token); } else falha(new Error((r && r.error) || 'negado'));
      };
      clienteToken.requestAccessToken({ prompt: interativo ? '' : 'none' });
    }));
  }

  function chamarDrive(url, init) {
    init = init || {};
    init.headers = Object.assign({ Authorization: 'Bearer ' + token }, init.headers || {});
    return fetch(url, init).then((r) => {
      if (r.ok) return r;
      if (r.status === 401) token = null;
      const e = new Error('Drive ' + r.status);
      e.codigo = r.status;
      throw e;
    });
  }

  function enviarParaNuvem(id, corpo) {
    if (id) {
      return chamarDrive('https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: corpo,
      });
    }
    const limite = 'glic' + Date.now().toString(36);
    const meta = JSON.stringify({ name: ARQUIVO_NUVEM, parents: ['appDataFolder'] });
    const partes = '--' + limite + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta +
      '\r\n--' + limite + '\r\nContent-Type: application/json\r\n\r\n' + corpo + '\r\n--' + limite + '--';
    return chamarDrive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + limite }, body: partes,
    });
  }

  const vistaDoEstado = () => ({ registros: estado.registros, apagados: estado.apagados, notas: estado.notas, faixas: estado.faixas, faixasTs: estado.faixasTs });

  async function executarSinc(interativo, repetiu) {
    try {
      await obterToken(interativo);
      const q = encodeURIComponent("name='" + ARQUIVO_NUVEM + "'");
      const lista = await (await chamarDrive('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&orderBy=createdTime&pageSize=10&fields=files(id)&q=' + q)).json();
      const id = lista.files && lista.files[0] && lista.files[0].id;
      let remoto = G.normalizarEstado({});
      if (id) {
        const texto = await (await chamarDrive('https://www.googleapis.com/drive/v3/files/' + id + '?alt=media')).text();
        remoto = G.lerBackup(texto);          // arquivo ilegível: lança erro e nada é alterado
      }
      const fundido = G.fundir(vistaDoEstado(), remoto, Date.now());
      if (!id || G.assinatura(fundido) !== G.assinatura(remoto)) await enviarParaNuvem(id, G.gerarBackup(fundido));
      // o usuário pode ter mexido durante a conversa com o Drive: funde de novo com o que está na tela agora
      const novo = G.fundir(vistaDoEstado(), fundido, Date.now());
      if (G.assinatura(novo) !== G.assinatura(vistaDoEstado())) {
        estado.registros = novo.registros;
        estado.apagados = novo.apagados;
        estado.notas = novo.notas;
        estado.faixas = novo.faixas;
        estado.faixasTs = novo.faixasTs;
        sincPendente = G.assinatura(novo) !== G.assinatura(fundido) || sincPendente;
      }
      estado.sinc.ultima = new Date().toISOString();
      salvar();
      if (!$('#tela-hoje').hidden) desenharHoje(true);
      else if (!$('#tela-relatorio').hidden) desenharRelatorio();
      else if (!$('#tela-painel').hidden) desenharPainel();
    } catch (e) {
      if (e && e.codigo === 401 && !repetiu) return executarSinc(interativo, true);
      throw e;
    }
  }

  function mensagemErroSinc(e, interativo) {
    const c = e && e.codigo;
    const m = (e && e.message) || '';
    if (/backup/.test(m)) return 'O arquivo no Google Drive está ilegível. Não alterei nada, nem aqui nem lá.';
    if (e instanceof TypeError || m === 'sem-rede') return 'Sem conexão. Tente de novo mais tarde.';
    if (c) return 'O Google Drive recusou o pedido (código ' + c + '). Veja a Parte 4 do LEIA-ME.';
    return interativo ? 'Não consegui entrar na conta Google.' : 'Toque aqui para entrar na conta Google e sincronizar.';
  }

  function sincronizar(interativo) {
    if (!clienteId()) return Promise.resolve(false);
    if (sincEmCurso) { sincPendente = true; return sincEmCurso; }
    sincMsg = 'Sincronizando…';
    mostrarSinc();
    sincEmCurso = executarSinc(interativo, false)
      .then(() => { sincMsg = ''; return true; }, (e) => { sincMsg = mensagemErroSinc(e, interativo); return false; })
      .then((deu) => {
        sincEmCurso = null;
        mostrarSinc();
        if (sincPendente) { sincPendente = false; agendarSinc(); }
        return deu;
      });
    return sincEmCurso;
  }

  function agendarSinc() {
    if (!estado.sinc.ativa || !clienteId()) return;
    clearTimeout(temporizadorSinc);
    temporizadorSinc = setTimeout(() => sincronizar(false), 1500);
  }

  function desenharSincHoje() {
    const b = $('#sinc-hoje');
    if (!estado.sinc.ativa || !clienteId()) { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = sincMsg || (estado.sinc.ultima ? 'Sincronizado em ' + quando(estado.sinc.ultima) + ' · tocar para sincronizar' : 'Tocar para sincronizar');
  }

  function desenharSinc() {
    const ligar = $('#btn-sinc-ligar'), agora = $('#btn-sinc-agora'), desl = $('#btn-sinc-desligar');
    if (!clienteId()) {
      $('#sinc-texto').textContent = 'Ainda não configurada. O passo a passo está na Parte 4 do arquivo LEIA-ME.';
      ligar.hidden = agora.hidden = desl.hidden = true;
      $('#sinc-status').textContent = '';
      return;
    }
    const ativa = estado.sinc.ativa;
    $('#sinc-texto').textContent = ativa
      ? 'Ligada. Os registros ficam iguais neste aparelho e nos outros que usam a mesma conta Google.'
      : 'Mantém os registros iguais no celular e no computador, num arquivo privado da sua conta Google Drive. Só este app lê esse arquivo.';
    ligar.hidden = ativa;
    agora.hidden = !ativa;
    desl.hidden = !ativa;
    $('#sinc-status').textContent = sincMsg || (estado.sinc.ultima ? 'Última sincronização: ' + quando(estado.sinc.ultima) + '.' : '');
    if (!ativa) carregarGIS().catch(() => {});   // já carregado quando o toque no botão abrir a janela do Google
  }

  function mostrarSinc() {
    desenharSincHoje();
    if (!$('#tela-dados').hidden) desenharSinc();
  }

  function ligarSinc() {
    sincronizar(true).then((deu) => {
      if (deu) { estado.sinc.ativa = true; salvar(); avisar('Sincronização ligada'); }
      mostrarSinc();
    });
  }

  function desligarSinc() {
    estado.sinc.ativa = false;
    token = null;
    clearTimeout(temporizadorSinc);
    salvar();
    sincMsg = '';
    mostrarSinc();
    avisar('Sincronização desligada. Os dados continuam aqui e no Drive.');
  }

  /* ---------- ligações ---------- */

  function iniciar() {
    carregar();

    $$('.aba').forEach((b) => b.addEventListener('click', () => mostrarTela(b.dataset.tela)));
    $('#btn-ir-backup').addEventListener('click', () => mostrarTela('dados'));

    $('#form-registro').addEventListener('submit', salvarRegistro);
    $('#in-data').addEventListener('change', () => atualizarFormulario(true));
    $('#in-valor').addEventListener('input', () => atualizarMensagem(registroDoDia($('#in-data').value)));
    $('#btn-excluir').addEventListener('click', excluirRegistro);
    $('#lista-recentes').addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-data]');
      if (!b) return;
      $('#in-data').value = b.dataset.data;
      atualizarFormulario(true);
      $('#in-valor').focus();
      window.scrollTo(0, 0);
    });

    $$('.chip').forEach((c) => c.addEventListener('click', () => {
      estado.periodo = +c.dataset.dias;
      salvar();
      desenharRelatorio();
    }));
    $('#sel-janela').addEventListener('change', (ev) => {
      estado.janela = +ev.target.value;
      salvar();
      desenharRelatorio();
    });

    $('#btn-arq-csv').addEventListener('click', () => $('#arq-csv').click());
    $('#arq-csv').addEventListener('change', (ev) => {
      const a = ev.target.files && ev.target.files[0];
      if (!a) return;
      lerArquivoTexto(a, (t) => { $('#txt-colar').value = t; lerDadosImportacao(); });
      ev.target.value = '';
    });
    $('#btn-ler').addEventListener('click', lerDadosImportacao);
    ['#sel-col-data', '#sel-col-valor', '#in-inicio'].forEach((s) => $(s).addEventListener('change', atualizarResumoImportacao));
    $('#btn-importar').addEventListener('click', importar);

    $('#btn-backup').addEventListener('click', exportarBackup);
    $('#btn-csv').addEventListener('click', exportarCSV);
    $('#btn-restaurar').addEventListener('click', () => $('#arq-backup').click());
    $('#arq-backup').addEventListener('change', (ev) => {
      const a = ev.target.files && ev.target.files[0];
      if (a) restaurarBackup(a);
      ev.target.value = '';
    });
    $('#btn-salvar-faixas').addEventListener('click', salvarFaixas);
    $('#btn-faixas-padrao').addEventListener('click', () => {
      const gravou = alterar(() => { estado.faixas = Object.assign({}, G.FAIXAS_PADRAO); estado.faixasTs = Date.now(); });
      if (!gravou) return;
      desenharDados();
      $('#msg-faixas').textContent = 'Faixas padrão restauradas.';
    });
    $('#btn-apagar').addEventListener('click', apagarTudo);
    $('#btn-sinc-ligar').addEventListener('click', ligarSinc);
    $('#btn-sinc-agora').addEventListener('click', () => sincronizar(true));
    $('#btn-sinc-desligar').addEventListener('click', desligarSinc);
    $('#sinc-hoje').addEventListener('click', () => sincronizar(true));

    // pede ao navegador para não apagar os dados sozinho quando faltar espaço
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verificarVirada(); });
    window.addEventListener('pageshow', verificarVirada);
    window.addEventListener('focus', verificarVirada);

    // ao voltar para o app, busca o que foi anotado no outro aparelho (no máximo uma vez por minuto)
    let ultimaTentativa = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !estado.sinc.ativa || Date.now() - ultimaTentativa < 60000) return;
      ultimaTentativa = Date.now();
      sincronizar(false);
    });

    mostrarTela((location.hash || '#hoje').slice(1));
    if (estado.sinc.ativa && clienteId()) { ultimaTentativa = Date.now(); sincronizar(false); }
  }

  iniciar();
}());
