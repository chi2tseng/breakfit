'use strict';
// Looping demo clip with a graceful placeholder when the file is missing or fails to load.
(function () {
  function placeholder(name) {
    const ph = document.createElement('div');
    ph.className = 'ph';
    ph.innerHTML = '<span class="ms">directions_run</span><span class="ph-name"></span>';
    ph.querySelector('.ph-name').textContent = name || '';
    return ph;
  }

  // Fill `el` (a .clip container) with a looping muted video or the placeholder.
  function mountClip(el, url, name, { autoplay = true, poster = null } = {}) {
    if (el.dataset.src === (url || '') && el.dataset.name === (name || '') && el.firstChild) return;
    el.dataset.src = url || '';
    el.dataset.name = name || '';
    el.textContent = '';
    if (!url) {
      el.appendChild(placeholder(name));
      return;
    }
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = autoplay ? 'auto' : 'metadata';
    if (poster) v.poster = poster;
    v.autoplay = autoplay;
    v.addEventListener('error', () => {
      el.textContent = '';
      el.appendChild(placeholder(name));
    });
    v.src = url;
    el.appendChild(v);
    if (autoplay) v.play().catch(() => {});
  }

  window.mountClip = mountClip;
})();
