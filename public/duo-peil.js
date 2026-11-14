/* Tijdelijke peilpagina voor de iPhone Duo (14-11), zie duo-peil.html.
   Los van de app: geen import, geen aanmelding, geen gegevens. Een extern
   bestand omdat de CSP van het portaal geen script in de pagina toelaat. */
(function () {
  var SLEUTEL = 'duo-peil-statusbalk';
  var meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  var bijStart = meta ? meta.getAttribute('content') : '-';
  var bewaard = null;
  try { bewaard = window.localStorage.getItem(SLEUTEL); } catch (e) { /* geen opslag: alleen de startwaarde */ }

  // Zoals de app: de statusbalk-instelling pas na het laden omzetten (de app
  // zet ze in donker thema op "black", in licht thema op "default").
  if (meta && bewaard) meta.setAttribute('content', bewaard);

  function mm(q) { return window.matchMedia(q).matches; }
  function hoogte(id) { var el = document.getElementById(id); return el ? Math.round(el.getBoundingClientRect().height) : '-'; }
  function zoek(kenmerk) {
    for (var n = 200; n <= 1400; n++) if (mm('(' + kenmerk + ': ' + n + 'px)')) return n;
    return '?';
  }

  var schermBreed = zoek('device-width');
  var schermHoog = zoek('device-height');

  function peil() {
    var s = window.getComputedStyle(document.getElementById('p'));
    var vv = window.visualViewport;
    var kop = document.querySelector('header').getBoundingClientRect();
    var nu = new Date();
    var regels = [
      'venster    ' + window.innerWidth + ' x ' + window.innerHeight + '   buiten ' + window.outerWidth + ' x ' + window.outerHeight,
      'document   ' + document.documentElement.clientWidth + ' x ' + document.documentElement.clientHeight,
      'scherm     ' + screen.width + ' x ' + screen.height + '   vrij ' + screen.availWidth + ' x ' + screen.availHeight + '   dpr ' + window.devicePixelRatio,
      'schermmaat in CSS  ' + schermBreed + ' x ' + schermHoog,
      'Duo-regel  binnen 669x951: ' + mm('(device-width: 669px) and (device-height: 951px)') + '   gedraaid 951x669: ' + mm('(device-width: 951px) and (device-height: 669px)') + '   buiten 466x678: ' + mm('(device-width: 466px) and (device-height: 678px)'),
      'zichtbaar  ' + (vv ? Math.round(vv.width) + ' x ' + Math.round(vv.height) + '   verschoven ' + Math.round(vv.offsetLeft) + ', ' + Math.round(vv.offsetTop) + '   schaal ' + vv.scale : '-'),
      'hoogtes    vh ' + hoogte('m-vh') + '   svh ' + hoogte('m-svh') + '   lvh ' + hoogte('m-lvh') + '   dvh ' + hoogte('m-dvh'),
      'veilig     boven ' + s.paddingTop + '   rechts ' + s.paddingRight + '   onder ' + s.paddingBottom + '   links ' + s.paddingLeft,
      'groene kop boven ' + Math.round(kop.top) + '   hoog ' + Math.round(kop.height),
      'stand      ' + (screen.orientation ? screen.orientation.type + ' ' + screen.orientation.angle : '-') + (mm('(orientation: portrait)') ? '   (staand)' : '   (liggend)'),
      'app-modus  ' + (mm('(display-mode: standalone)') ? 'standalone' : 'browser') + '   nav.standalone=' + navigator.standalone,
      'statusbalk bij start ' + bijStart + '   nu ' + (meta ? meta.getAttribute('content') : '-') + '   bewaard ' + (bewaard || 'niets'),
      'breekpunt  640 ' + mm('(min-width: 640px)') + '   768 ' + mm('(min-width: 768px)') + '   1024 ' + mm('(min-width: 1024px)'),
      'aanraking  ' + (mm('(pointer: coarse)') ? 'grof' : 'fijn') + '   hover ' + mm('(hover: hover)'),
      'vouw       posture ' + (navigator.devicePosture ? navigator.devicePosture.type : 'geen API') + '   segmenten ' + (window.viewport && window.viewport.segments ? window.viewport.segments.length : 'geen API'),
      'kleuren    html blauw · body roze · kop groen · theme-color oker · manifest thema paars · manifest achtergrond bruin',
      'toestel    ' + navigator.userAgent.replace(/Mozilla\/5.0 /, '').slice(0, 96),
      'gemeten    ' + nu.toTimeString().slice(0, 8),
    ];
    document.getElementById('uit').textContent = regels.join('\n');
    var knoppen = document.querySelectorAll('#knoppen button');
    var actief = meta ? meta.getAttribute('content') : '';
    for (var i = 0; i < knoppen.length; i++) knoppen[i].setAttribute('aria-pressed', String(knoppen[i].getAttribute('data-stijl') === actief));
  }

  document.getElementById('knoppen').addEventListener('click', function (e) {
    var knop = e.target && e.target.closest ? e.target.closest('button[data-stijl]') : null;
    if (!knop || !meta) return;
    bewaard = knop.getAttribute('data-stijl');
    meta.setAttribute('content', bewaard);
    try { window.localStorage.setItem(SLEUTEL, bewaard); } catch (err) { /* geen opslag: geldt tot de pagina sluit */ }
    peil();
  });

  peil();
  window.addEventListener('resize', peil);
  window.addEventListener('orientationchange', peil);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', peil);
  if (navigator.devicePosture) navigator.devicePosture.addEventListener('change', peil);
  window.setInterval(peil, 1000);
})();
