// Apply the last public appearance before the login or loading screen can paint.
(() => {
  let mode = 'warm';
  try {
    const mirror = JSON.parse(localStorage.getItem('user-preferences') || '{}');
    const saved = mirror?.theme ?? localStorage.getItem('appearance-theme') ?? localStorage.getItem('theme');
    if (['warm', 'light', 'dark', 'system'].includes(saved)) mode = saved;
  } catch { /* Warm white also works when storage is unavailable. */ }
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = mode === 'warm' ? 'warm' : dark ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', Boolean(dark));
  document.documentElement.style.backgroundColor = mode === 'warm' ? '#faf9f5' : dark ? '#20211f' : '#ffffff';
})();
