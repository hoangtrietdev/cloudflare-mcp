document.querySelector('#check').addEventListener('click', async () => {
  const result = document.querySelector('#result');
  const response = await fetch('/assets/mark.svg', { method: 'HEAD' });
  result.textContent = response.ok ? 'Browser check passed: HTML, CSS, JavaScript and nested SVG are loading.' : 'Asset check failed: the SVG request did not succeed.';
});
