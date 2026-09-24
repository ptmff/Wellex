(function(){
  var METRIKA_ID = 113005346;
  var STORAGE_KEY = 'wellex-cookie-consent';
  var banner = document.getElementById('cookie-banner');
  var metrikaStarted = false;

  function loadConsent(){
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { status: 'pending' };
      return JSON.parse(raw);
    } catch (e) {
      return { status: 'pending' };
    }
  }

  function saveConsent(state){
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function analyticsAllowed(state){
    return state && state.status === 'accepted' && state.consent && state.consent.analytics === true;
  }

  function showBanner(){
    if (!banner) return;
    banner.classList.add('is-visible');
  }

  function hideBanner(){
    if (!banner) return;
    banner.classList.remove('is-visible');
  }

  function initYandexMetrika(){
    if (metrikaStarted || !METRIKA_ID) return;
    metrikaStarted = true;
    window.dataLayer = window.dataLayer || [];
    (function(m,e,t,r,i,k,a){
      m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      for (var j = 0; j < document.scripts.length; j++) { if (document.scripts[j].src === r) { return; } }
      k=e.createElement(t);a=e.getElementsByTagName(t)[0];k.async=1;k.src=r;a.parentNode.insertBefore(k,a);
    })(window, document, 'script', 'https://mc.yandex.ru/metrika/tag.js?id=' + METRIKA_ID, 'ym');

    ym(METRIKA_ID, 'init', {
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: location.href,
      accurateTrackBounce: true,
      trackLinks: true
    });
  }

  function applyConsent(state){
    saveConsent(state);
    hideBanner();
    if (analyticsAllowed(state)) initYandexMetrika();
  }

  function acceptAll(){
    applyConsent({
      status: 'accepted',
      consent: { necessary: true, analytics: true, functional: true }
    });
  }

  function rejectAnalytics(){
    applyConsent({
      status: 'accepted',
      consent: { necessary: true, analytics: false, functional: false }
    });
  }

  var consent = loadConsent();
  if (consent.status === 'pending') showBanner();
  else if (analyticsAllowed(consent)) initYandexMetrika();

  var acceptBtn = document.getElementById('cookie-accept');
  var rejectBtn = document.getElementById('cookie-reject');
  var settingsLink = document.getElementById('cookie-settings-link');
  if (acceptBtn) acceptBtn.addEventListener('click', acceptAll);
  if (rejectBtn) rejectBtn.addEventListener('click', rejectAnalytics);
  if (settingsLink) settingsLink.addEventListener('click', function(e){
    e.preventDefault();
    showBanner();
  });
})();
