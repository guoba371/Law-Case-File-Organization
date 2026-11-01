(function () {
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const MAX_FILE_SIZE = 100 * 1024 * 1024;
  const MAX_FILES = 500;
  const MAX_TOTAL_SIZE = 2 * 1024 * 1024 * 1024;
  const MAX_FEEDBACK_IMAGES = 5;
  const MAX_FEEDBACK_IMAGE_SIZE = 5 * 1024 * 1024;
  const FEEDBACK_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
  let feedbackFiles = [];

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }

  function statusLabel(status) {
    return ({ uploading: '上传中', queued: '等待处理', extracting: '提取材料', chunking: '整理片段', summarizing: '生成摘要', analyzing: '结构化研判', ready: '可查看', partial_ready: '部分完成', failed: '待处理' })[status] || '待处理';
  }

  async function request(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) {
      let message = '操作未完成';
      try { message = (await response.json()).error || message; } catch {}
      throw new Error(message);
    }
    return response.json();
  }

  function renderCaseList(items) {
    const container = document.getElementById('caseList');
    if (!Array.isArray(items) || items.length === 0) {
      container.innerHTML = '<div class="empty-state">暂无数据</div>';
      return;
    }
    container.innerHTML = items.map((item) => `
      <a class="case-list-item" href="/cases/${encodeURIComponent(item.id)}">
        <div><span class="case-list-name">${escapeHtml(item.name)}</span><span class="case-list-meta">${new Date(item.updatedAt).toLocaleString('zh-CN')} · ${escapeHtml(item.model)}</span></div>
        <span class="case-status case-status-${escapeHtml(item.status)}">${statusLabel(item.status)}</span>
      </a>`).join('');
  }

  async function loadCases() {
    try { renderCaseList(await request('/api/cases')); }
    catch (error) { console.error('Failed to load cases:', error); renderCaseList([]); }
  }

  async function loadModels() {
    try {
      const data = await request('/api/providers');
      const select = document.getElementById('caseModel');
      select.innerHTML = data.providers.filter((provider) => provider.enabled).map((provider) => `<option value="${escapeHtml(provider.id)}">${escapeHtml(provider.name)}</option>`).join('');
      select.value = data.active;
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  }

  function validateFiles(files) {
    if (!files.length) throw new Error('请选择案卷材料');
    if (files.length > MAX_FILES) throw new Error('单案件最多上传 500 份材料');
    let total = 0;
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} 超过单文件 100MB 上限`);
      total += file.size;
    }
    if (total > MAX_TOTAL_SIZE) throw new Error('单案件文件合计不能超过 2GB');
  }

  function renderSelectedFiles(files) {
    const target = document.getElementById('fileSelection');
    if (!files.length) { target.textContent = '尚未选择材料'; return; }
    const total = files.reduce((sum, file) => sum + file.size, 0);
    target.textContent = `已选择 ${files.length} 份材料，共 ${formatBytes(total)}`;
  }

  async function uploadFileInChunks(caseId, file, onProgress) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const record = await request(`/api/cases/${caseId}/files/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, size: file.size, totalChunks }),
    });
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * CHUNK_SIZE;
      const body = file.slice(start, Math.min(file.size, start + CHUNK_SIZE));
      await request(`/api/cases/${caseId}/files/${record.id}/chunks/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body });
      onProgress((index + 1) / totalChunks);
    }
    await request(`/api/cases/${caseId}/files/${record.id}/complete`, { method: 'POST' });
  }

  async function createAndUploadCase(event) {
    event.preventDefault();
    const files = Array.from(document.getElementById('caseFiles').files || []);
    const redactedConfirm = document.getElementById('redactedConfirm');
    const status = document.getElementById('uploadStatus');
    const button = document.getElementById('createCaseButton');
    try {
      if (!redactedConfirm.checked) throw new Error('请先确认案卷已经完成必要脱敏；未脱敏材料不会上传或分析');
      validateFiles(files);
      button.disabled = true;
      status.textContent = '正在创建案件…';
      const progress = document.getElementById('uploadProgress');
      const progressBar = document.getElementById('uploadProgressBar');
      const fileProgressList = document.getElementById('fileProgressList');
      progress.hidden = false;
      progressBar.style.width = '0%';
      fileProgressList.innerHTML = files.map((file, index) => `<div class="file-progress-row" id="file-progress-${index}"><span>${escapeHtml(file.name)}</span><strong>等待上传</strong></div>`).join('');
      const created = await request('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('caseName').value.trim(),
          model: document.getElementById('caseModel').value,
          redactedConfirmed: true,
          draftingRequirements: document.getElementById('draftingRequirements').value.trim(),
        }),
      });
      let uploaded = 0;
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const row = document.getElementById(`file-progress-${index}`);
        row.querySelector('strong').textContent = '上传中';
        await uploadFileInChunks(created.id, file, (ratio) => {
          const percent = ((uploaded + file.size * ratio) / totalBytes) * 100;
          progressBar.style.width = `${Math.min(100, percent).toFixed(1)}%`;
          row.querySelector('strong').textContent = `${Math.round(ratio * 100)}%`;
        });
        uploaded += file.size;
        row.querySelector('strong').textContent = '已上传';
      }
      await request(`/api/cases/${created.id}/process`, { method: 'POST' });
      window.location.assign(`/cases/${created.id}`);
    } catch (error) {
      status.textContent = error.message || '操作未完成';
      status.className = 'result err';
      button.disabled = false;
    }
  }

  function setFeedbackStatus(message, state = '') {
    const status = document.getElementById('feedbackStatus');
    status.textContent = message;
    status.className = `feedback-result result${state ? ` ${state}` : ''}`;
  }

  function validateFeedbackFiles(files) {
    if (files.length > MAX_FEEDBACK_IMAGES) throw new Error('最多上传 5 张图片');
    for (const file of files) {
      if (!FEEDBACK_IMAGE_TYPES.has(file.type)) throw new Error(`${file.name} 仅支持 PNG、JPG 或 WEBP`);
      if (file.size > MAX_FEEDBACK_IMAGE_SIZE) throw new Error(`${file.name} 超过单张 5MB 上限`);
    }
  }

  function renderFeedbackFiles() {
    const list = document.getElementById('feedbackFileList');
    list.replaceChildren(...feedbackFiles.map((file) => {
      const row = document.createElement('div');
      row.className = 'feedback-file-item';
      const name = document.createElement('span');
      name.textContent = file.name;
      const size = document.createElement('strong');
      size.textContent = formatBytes(file.size);
      row.append(name, size);
      return row;
    }));
  }

  function fileToPayload(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve({ name: file.name, type: file.type, data: String(reader.result).split(',')[1] || '' }));
      reader.addEventListener('error', () => reject(new Error(`${file.name} 读取失败，请重新选择`)));
      reader.readAsDataURL(file);
    });
  }

  function closeFeedbackDialog() {
    document.getElementById('feedbackDialog').close();
  }

  async function submitFeedback(event) {
    event.preventDefault();
    const button = document.getElementById('feedbackSubmit');
    try {
      validateFeedbackFiles(feedbackFiles);
      button.disabled = true;
      setFeedbackStatus('正在提交…');
      const images = await Promise.all(feedbackFiles.map(fileToPayload));
      const result = await request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: document.getElementById('feedbackDescription').value.trim(),
          pageUrl: window.location.pathname,
          images,
        }),
      });
      const sent = result.notificationStatus === 'sent';
      setFeedbackStatus(sent ? '反馈已提交，邮件通知已发送。' : '反馈已保存，邮件通知暂未发送。', sent ? 'ok' : 'warn');
      document.getElementById('feedbackForm').reset();
      feedbackFiles = [];
      renderFeedbackFiles();
    } catch (error) {
      setFeedbackStatus(error.message || '反馈提交未完成，请重试', 'err');
    } finally {
      button.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const newCaseButton = document.getElementById('newCaseButton');
    function toggleNewCase(open) {
      document.getElementById('newCasePanel').hidden = !open;
      document.getElementById('caseListSection').hidden = open;
      newCaseButton.hidden = open;
      newCaseButton.setAttribute('aria-expanded', String(open));
      (open ? document.getElementById('caseName') : newCaseButton).focus();
    }
    newCaseButton.addEventListener('click', () => toggleNewCase(true));
    document.getElementById('cancelNewCaseButton').addEventListener('click', () => toggleNewCase(false));
    document.getElementById('caseFiles').addEventListener('change', (event) => renderSelectedFiles(Array.from(event.target.files || [])));
    document.getElementById('caseForm').addEventListener('submit', createAndUploadCase);
    const feedbackDialog = document.getElementById('feedbackDialog');
    document.getElementById('feedbackTrigger').addEventListener('click', () => {
      setFeedbackStatus('');
      feedbackDialog.showModal();
      document.body.classList.add('feedback-open');
      document.getElementById('feedbackDescription').focus();
    });
    document.getElementById('feedbackClose').addEventListener('click', closeFeedbackDialog);
    document.getElementById('feedbackCancel').addEventListener('click', closeFeedbackDialog);
    feedbackDialog.addEventListener('close', () => document.body.classList.remove('feedback-open'));
    feedbackDialog.addEventListener('click', (event) => { if (event.target === feedbackDialog) closeFeedbackDialog(); });
    document.getElementById('feedbackImages').addEventListener('change', (event) => {
      try {
        const files = Array.from(event.target.files || []);
        validateFeedbackFiles(files);
        feedbackFiles = files;
        setFeedbackStatus('');
      } catch (error) {
        event.target.value = '';
        feedbackFiles = [];
        setFeedbackStatus(error.message, 'err');
      }
      renderFeedbackFiles();
    });
    document.getElementById('feedbackForm').addEventListener('submit', submitFeedback);
    loadModels();
    loadCases();
  });

  window.createAndUploadCase = createAndUploadCase;
  window.uploadFileInChunks = uploadFileInChunks;
  window.renderCaseList = renderCaseList;
})();
