// DropFlow: Force all shadow roots to open mode so the extension can traverse
// the DOM for variation builder detection and interaction.
// Runs in MAIN world at document_start, before any page scripts.
(function () {
  console.warn('[DropFlow] open-shadow-roots.js MAIN world script active');
  const origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    if (init && init.mode === 'closed') {
      console.warn('[DropFlow] Intercepted closed shadow root on:', this.tagName, this.className || '');
    }
    return origAttachShadow.call(this, { ...init, mode: 'open' });
  };
})();
