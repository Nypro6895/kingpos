document.getElementById('retry').addEventListener('click', async () => {
  const button = document.getElementById('retry');
  button.disabled = true;
  try { await window.kingposDesktop.recovery.retry(); }
  catch { button.disabled = false; }
});
