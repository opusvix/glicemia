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
      (estado.sinc.ativa ? ' Com a sincronização ligada, eles também serão apagados da nuvem e dos outros aparelhos.' : ''))) return;
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

  /* ---------- sincronização (Supabase; login que se mantém sozinho) ---------- */
  /* A biblioteca do Supabase (vendor/supabase.js) só é carregada quando a sincronização está configurada.
     A sessão fica guardada e é renovada pelo próprio Supabase — não precisa entrar de novo a cada hora. */

  const TABELA = 'glicemia';

  function cfgSup() {
    const c = window.GLIC_CONFIG || {};
    const url = String(c.supabaseUrl || '').trim();
    const chave = String(c.supabaseAnonKey || '').trim();
    return url && chave ? { url: url, chave: chave } : null;
  }

  let supPromessa = null;
  let sb = null;               // cliente Supabase
  let sessao = null;           // sessão atual (ou null)
  let sincEmCurso = null;
  let sincPendente = false;
  let sincMsg = '';
  let temporizadorSinc = null;
  let timerPeriodico = null;

  function quando(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = (n) => (n < 10 ? '0' : '') + n;
    return G.dataBR(G.hojeISO(d)) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* Carrega a biblioteca uma vez e cria o cliente, que já lê a sessão guardada no aparelho. */
  function obterCliente() {
    if (sb) return Promise.resolve(sb);
    const cfg = cfgSup();
    if (!cfg) return Promise.reject(new Error('sem-config'));
    if (!supPromessa) {
      supPromessa = new Promise((ok, falha) => {
        if (window.supabase && window.supabase.createClient) return ok();
        const el = document.createElement('script');
        el.src = 'vendor/supabase.js';
        el.async = true;
        el.onload = () => ok();
        el.onerror = () => { supPromessa = null; falha(new Error('sem-rede')); };
        document.head.appendChild(el);
      });
    }
    return supPromessa.then(() => {
      if (!sb) {
        sb = window.supabase.createClient(cfg.url, cfg.chave, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'glicemia-sb-auth' },
        });
        sb.auth.onAuthStateChange((_ev, s) => { sessao = s; });
      }
      return sb;
    });
  }

  function sessaoAtual() {
    return obterCliente().then((c) => c.auth.getSession()).then((r) => { sessao = r.data ? r.data.session : null; return sessao; });
  }

  const logado = () => !!sessao;

  function traduzErroAuth(e) {
    const m = ((e && e.message) || '').toLowerCase();
    if (m.indexOf('invalid login') > -1) return 'E-mail ou senha incorretos.';
    if (m.indexOf('already registered') > -1 || m.indexOf('already been registered') > -1) return 'Já existe conta com esse e-mail. Toque em Entrar.';
    if (m.indexOf('at least 6') > -1 || m.indexOf('password should be') > -1) return 'A senha precisa ter ao menos 6 caracteres.';
    if (m.indexOf('not confirmed') > -1 || m.indexOf('email not confirmed') > -1) return 'Confirme o e-mail antes de entrar (ou desligue a confirmação no Supabase).';
    if (m.indexOf('invalid email') > -1) return 'E-mail inválido.';
    return (e && e.message) || 'Não consegui entrar.';
  }

  /* A pessoa digita a senha; o app só repassa ao Supabase e nunca a guarda. */
  function entrar(email, senha, criar) {
    return obterCliente().then((c) => (criar
      ? c.auth.signUp({ email: email, password: senha })
      : c.auth.signInWithPassword({ email: email, password: senha })
    )).then((resp) => {
      if (resp.error) { const e = new Error(resp.error.message || 'auth'); e.auth = true; throw e; }
      sessao = resp.data ? resp.data.session : null;   // null no signUp quando o Supabase exige confirmar o e-mail
      return sessao;
    });
  }

  const vistaDoEstado = () => ({ registros: estado.registros, apagados: estado.apagados, notas: estado.notas, faixas: estado.faixas, faixasTs: estado.faixasTs });

  function aplicarEstado(novo) {
    estado.registros = novo.registros;
    estado.apagados = novo.apagados;
    estado.notas = novo.notas;
    estado.faixas = novo.faixas;
    estado.faixasTs = novo.faixasTs;
  }

  async function executarSinc() {
    const s = await sessaoAtual();
    if (!s) { const e = new Error('precisa-login'); e.login = true; throw e; }
    const uid = s.user.id;
    const sel = await sb.from(TABELA).select('dados').eq('user_id', uid).maybeSingle();
    if (sel.error) { const e = new Error(sel.error.message); e.codigo = sel.error.code || 'erro'; throw e; }
    const remoto = G.normalizarEstado(sel.data ? sel.data.dados : {});
    const fundido = G.fundir(vistaDoEstado(), remoto, Date.now());
    if (!sel.data || G.assinatura(fundido) !== G.assinatura(remoto)) {
      const up = await sb.from(TABELA).upsert({ user_id: uid, dados: fundido, atualizado_em: new Date().toISOString() }, { onConflict: 'user_id' });
      if (up.error) { const e = new Error(up.error.message); e.codigo = up.error.code || 'erro'; throw e; }
    }
    // a pessoa pode ter mexido durante a conversa com o servidor: funde de novo com o que está na tela agora
    const novo = G.fundir(vistaDoEstado(), fundido, Date.now());
    if (G.assinatura(novo) !== G.assinatura(vistaDoEstado())) {
      aplicarEstado(novo);
      sincPendente = G.assinatura(novo) !== G.assinatura(fundido) || sincPendente;
    }
    estado.sinc.ultima = new Date().toISOString();
    salvar();
    if (!$('#tela-hoje').hidden) desenharHoje(true);
    else if (!$('#tela-relatorio').hidden) desenharRelatorio();
    else if (!$('#tela-painel').hidden) desenharPainel();
  }

  function mensagemErroSinc(e) {
    const m = (e && e.message) || '';
    if (e && e.login) return 'Entre com seu e-mail e senha para sincronizar.';
    if (e instanceof TypeError || m === 'sem-rede') return 'Sem conexão. Tente de novo mais tarde.';
    if (e && e.auth) return traduzErroAuth(e);
    if (e && e.codigo) return 'O servidor recusou o pedido (' + e.codigo + '). Veja a Parte 4 do LEIA-ME.';
    return 'Não consegui sincronizar agora.';
  }

  function sincronizar() {
    if (!cfgSup()) return Promise.resolve(false);
    if (sincEmCurso) { sincPendente = true; return sincEmCurso; }
    sincMsg = 'Sincronizando…';
    mostrarSinc();
    sincEmCurso = executarSinc()
      .then(() => { sincMsg = ''; return true; }, (e) => { sincMsg = mensagemErroSinc(e); return false; })
      .then((deu) => {
        sincEmCurso = null;
        mostrarSinc();
        if (sincPendente) { sincPendente = false; agendarSinc(); }
        return deu;
      });
    return sincEmCurso;
  }

  function agendarSinc() {
    if (!estado.sinc.ativa || !cfgSup()) return;
    clearTimeout(temporizadorSinc);
    temporizadorSinc = setTimeout(() => { if (logado()) sincronizar(); }, 1200);
  }

  function iniciarTimerPeriodico() {
    clearInterval(timerPeriodico);
    timerPeriodico = setInterval(() => {
      if (estado.sinc.ativa && cfgSup() && document.visibilityState === 'visible' && logado() && !sincEmCurso) sincronizar();
    }, 45000);
  }

  function desenharSincHoje() {
    const b = $('#sinc-hoje');
    if (!estado.sinc.ativa || !cfgSup()) { b.hidden = true; return; }
    b.hidden = false;
    if (!logado()) { b.textContent = sincMsg || 'Toque para entrar e sincronizar'; return; }
    b.textContent = sincMsg || (estado.sinc.ultima ? 'Sincronizado em ' + quando(estado.sinc.ultima) : 'Tocar para sincronizar');
  }

  function desenharSinc() {
    const cfg = cfgSup();
    const form = $('#sinc-login'), agora = $('#btn-sinc-agora'), sair = $('#btn-sinc-sair'), aviso = $('#sinc-aviso-privacidade');
    if (!cfg) {
      $('#sinc-texto').textContent = 'Ainda não configurada. O passo a passo está na Parte 4 do arquivo LEIA-ME.';
      form.hidden = true; agora.hidden = true; sair.hidden = true; aviso.hidden = true;
      $('#sinc-status').textContent = '';
      return;
    }
    aviso.hidden = false;
    if (logado()) {
      const email = sessao && sessao.user ? sessao.user.email : '';
      $('#sinc-texto').textContent = 'Conectado' + (email ? ' como ' + email : '') + '. Os registros ficam iguais em todos os aparelhos onde você entra com essa conta.';
      form.hidden = true; agora.hidden = false; sair.hidden = false;
    } else {
      $('#sinc-texto').textContent = 'Entre com um e-mail e uma senha (a mesma conta nos dois aparelhos) para manter os registros iguais no celular e no computador.';
      form.hidden = false; agora.hidden = true; sair.hidden = true;
    }
    $('#sinc-status').textContent = sincMsg || (logado() && estado.sinc.ultima ? 'Última sincronização: ' + quando(estado.sinc.ultima) + '.' : '');
  }

  function mostrarSinc() {
    desenharSincHoje();
    if (!$('#tela-dados').hidden) desenharSinc();
  }

  function tentarEntrar(criar) {
    const email = $('#sinc-email').value.trim();
    const senha = $('#sinc-senha').value;
    if (!email || !senha) { sincMsg = 'Digite e-mail e senha.'; mostrarSinc(); return; }
    sincMsg = criar ? 'Criando conta…' : 'Entrando…';
    mostrarSinc();
    entrar(email, senha, criar).then((s) => {
      $('#sinc-senha').value = '';
      if (!s) { sincMsg = 'Conta criada. Confirme o e-mail (ou desligue a confirmação no Supabase) e toque em Entrar.'; mostrarSinc(); return; }
      estado.sinc.ativa = true;
      salvar();
      iniciarTimerPeriodico();
      sincMsg = '';
      return sincronizar().then(() => { avisar('Sincronização ligada'); });
    }).catch((e) => { sincMsg = mensagemErroSinc(e); mostrarSinc(); });
  }

  function sair() {
    const c = sb;
    estado.sinc.ativa = false;
    clearTimeout(temporizadorSinc);
    clearInterval(timerPeriodico);
    salvar();
    sincMsg = '';
    (c ? c.auth.signOut().catch(() => {}) : Promise.resolve()).then(() => { sessao = null; mostrarSinc(); });
    avisar('Você saiu. Os dados continuam neste aparelho e na nuvem.');
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
    $('#sinc-login').addEventListener('submit', (ev) => { ev.preventDefault(); tentarEntrar(false); });
    $('#btn-sinc-criar').addEventListener('click', () => tentarEntrar(true));
    $('#btn-sinc-agora').addEventListener('click', () => sincronizar());
    $('#btn-sinc-sair').addEventListener('click', sair);
    $('#sinc-hoje').addEventListener('click', () => { if (logado()) sincronizar(); else { mostrarTela('dados'); const el = $('#sinc-email'); if (el) el.focus(); } });

    // pede ao navegador para não apagar os dados sozinho quando faltar espaço
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verificarVirada(); });
    window.addEventListener('pageshow', verificarVirada);
    window.addEventListener('focus', verificarVirada);

    // ao voltar para o app, busca o que foi anotado no outro aparelho
    let ultimaTentativa = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !estado.sinc.ativa || !cfgSup() || Date.now() - ultimaTentativa < 8000) return;
      ultimaTentativa = Date.now();
      if (logado()) sincronizar(); else sessaoAtual().then((ses) => { if (ses) sincronizar(); else mostrarSinc(); }).catch(() => {});
    });

    mostrarTela((location.hash || '#hoje').slice(1));
    if (estado.sinc.ativa && cfgSup()) {
      iniciarTimerPeriodico();
      ultimaTentativa = Date.now();
      sessaoAtual().then((ses) => { mostrarSinc(); if (ses) sincronizar(); }).catch(() => {});
    }
  }

  iniciar();
}());
