// Módulo Isolado: Gestão de Backup Manual
(() => {
  // Aguarda que o documento carregue completamente
  document.addEventListener('DOMContentLoaded', () => {
    const backupBtn = document.getElementById('manualBackupButton');
    if (!backupBtn) return;

    backupBtn.addEventListener('click', async () => {
      // Confirmação para evitar cliques acidentais
      if (!confirm('Deseja forçar a criação de um backup agora? O sistema também apagará os backups antigos que excedam o limite.')) return;

      backupBtn.disabled = true;
      const originalText = backupBtn.textContent;
      backupBtn.textContent = 'A processar...';

      try {
        // Aproveita a função apiRequest que já existe globalmente no seu app.js
        await window.apiRequest('/api/backup', { method: 'POST', body: '{}' });
        alert('Backup criado e expurgo executado com sucesso no servidor da VPS!');
      } catch (error) {
        alert('Falha ao forçar o backup: ' + error.message);
      } finally {
        backupBtn.disabled = false;
        backupBtn.textContent = originalText;
      }
    });
  });
})();