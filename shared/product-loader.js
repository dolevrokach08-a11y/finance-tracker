(function () {
  const screen = document.querySelector('.product-boot-screen');
  if (!screen) return;

  const elapsed = typeof performance !== 'undefined' ? performance.now() : 0;
  const isStillLoading = () => screen.style.display !== 'none' && screen.style.opacity !== '0';

  const revealTimer = window.setTimeout(() => {
    if (isStillLoading()) screen.classList.add('product-boot-visible');
  }, Math.max(0, 260 - elapsed));

  const detailTimer = window.setTimeout(() => {
    if (isStillLoading()) screen.classList.add('product-boot-delayed');
  }, Math.max(0, 1600 - elapsed));

  window.addEventListener('pagehide', () => {
    window.clearTimeout(revealTimer);
    window.clearTimeout(detailTimer);
  }, { once: true });
})();
