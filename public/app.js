const form = document.querySelector("#avatarForm");
const resultBox = document.querySelector("#resultBox");
const status = document.querySelector("#apiStatus");
const downloadButton = document.querySelector("#downloadButton");
const generateButton = document.querySelector("#generateButton");
const apiDialog = document.querySelector("#apiDialog");
const apiForm = document.querySelector("#apiForm");
const apiKeyInput = document.querySelector("#apiKeyInput");
const modelIdInput = document.querySelector("#modelIdInput");
const apiError = document.querySelector("#apiError");
const llmModelIdInput = document.querySelector("#llmModelIdInput");
const referenceUpload = document.querySelector("#referenceUpload");
const uploadPreview = document.querySelector("#uploadPreview");
const userRequest = document.querySelector("#userRequest");
const ideaButton = document.querySelector("#ideaButton");
const thinkingNote = document.querySelector("#thinkingNote");
const refineBox = document.querySelector("#refineBox");
const feedbackInput = document.querySelector("#feedbackInput");
const refineButton = document.querySelector("#refineButton");
const workspace = document.querySelector("#workspace");
const startSessionButton = document.querySelector("#startSessionButton");
const stopGenerationButton = document.querySelector("#stopGenerationButton");
const endSessionButton = document.querySelector("#endSessionButton");
const sessionTitle = document.querySelector("#sessionTitle");
const sessionHint = document.querySelector("#sessionHint");
const conversationHistory = document.querySelector("#conversationHistory");
let latestImage = "";
let referenceFiles = [];
let selectedPlan = null;
let sessionActive = false;
let activeController = null;
let conversationMessages = [];

const STYLE_RULES = [
  "严格参考输入图片的统一Q版头像画风，但创作一个全新的虚构人物",
  "超大黑棕色圆眼，眼睛有白色高光，五官简洁可爱，头大身小",
  "圆润脸型，柔和浅肤色，脸颊有粉色短线腮红",
  "深色干净描边，局部白色贴纸外轮廓，平滑细腻的数字插画上色",
  "胸像构图，人物居中，浅灰米色虚化纯净背景",
  "构图硬性要求：只画腰部以上近景头像，画面下边缘在腰部或胸部自然裁切",
  "禁止全身构图，禁止出现腿、膝盖、鞋、脚和地面，禁止把包、球等物品摆在地上",
  "如有球、书或其他道具，只能由人物抱在胸前或拿在上半身附近，并允许道具在画面边缘自然裁切",
  "明亮高饱和服装，整体亲切、阳光、充满活力",
  "保持参考图相同的线条粗细、五官比例、光影方式和完成度",
  "不要写实，不要照片质感，不要3D渲染，不要文字，不要水印，不要多余人物"
];

function buildPrompt(plan) {
  return [
    ...STYLE_RULES,
    `人物设定：${plan.characterPrompt || plan.details || plan.summary}。`,
    "最终必须生成一张1:1正方形的单人半身头像，只呈现头部、肩部、手臂和少量腰部，绝对不要为了展示服装或道具而拉远镜头。"
  ].filter(Boolean).join("；");
}

async function requestPlans(isRefine = false) {
  if (!sessionActive) return;
  const description = userRequest.value.trim();
  const feedback = feedbackInput.value.trim();
  if (!description && !isRefine) {
    userRequest.focus();
    thinkingNote.textContent = "先用一句话说说你想要什么样的头像。";
    return;
  }
  if (isRefine && !selectedPlan) {
    thinkingNote.textContent = "请先生成第一版头像。";
    return;
  }
  if (isRefine && !feedback) {
    feedbackInput.focus();
    return;
  }
  appendMessage("user", isRefine ? feedback : description);
  const button = isRefine ? refineButton : ideaButton;
  setBusy(true);
  button.textContent = "正在整理想法…";
  activeController = new AbortController();
  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description, feedback, currentPlan: isRefine ? selectedPlan : null }),
      signal: activeController.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "暂时没能整理出方案");
    selectedPlan = data.plan;
    thinkingNote.textContent = data.message || (isRefine ? "已经理解修改要求，正在重新生成。" : "已经理解你的要求，正在生成头像。");
    appendMessage("assistant", isRefine
      ? `好的，我会保留之前的设定，只修改：${feedback}`
      : `好的，我已经记住这些要求：${data.plan.summary || description}`);
    refineBox.hidden = false;
    if (isRefine) feedbackInput.value = "";
    await generateAvatar(selectedPlan);
  } catch (error) {
    thinkingNote.textContent = error.name === "AbortError" ? "已停止生成，你可以修改描述后再试。" : error.message;
    appendMessage("assistant", error.name === "AbortError" ? "这次生成已停止，你可以修改要求后再试。" : `没有生成成功：${error.message}`);
  } finally {
    activeController = null;
    setBusy(false);
    button.textContent = isRefine ? "按这个要求修改" : "生成头像";
  }
}

ideaButton.addEventListener("click", () => requestPlans(false));
refineButton.addEventListener("click", () => requestPlans(true));

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("参考图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function renderUploads() {
  uploadPreview.innerHTML = "";
  referenceFiles.forEach((file, index) => {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = `人物参考图 ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `删除人物参考图 ${index + 1}`);
    remove.addEventListener("click", () => {
      referenceFiles.splice(index, 1);
      renderUploads();
    });
    figure.append(image, remove);
    uploadPreview.append(figure);
  });
}

referenceUpload.addEventListener("change", () => {
  const selected = Array.from(referenceUpload.files || []);
  const valid = selected.filter(file => file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp");
  referenceFiles = valid.slice(0, 2);
  referenceUpload.value = "";
  renderUploads();
});

async function checkStatus() {
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    const label = data.connected ? (data.llmConnected ? "豆包与 Seedream 已连接" : "Seedream 已连接") : "当前为演示模式";
    status.innerHTML = `<span></span>${label}`;
    status.classList.toggle("connected", data.connected);
  } catch {
    status.innerHTML = "<span></span>接口状态未知";
  }
}

status.addEventListener("click", () => {
  apiError.textContent = "";
  apiKeyInput.value = "";
  apiDialog.showModal();
});

apiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = apiKeyInput.value.trim();
  if (!key) return;
  apiError.textContent = "正在连接…";
  try {
    const response = await fetch("/api/configure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: key, modelId: modelIdInput.value.trim(), llmModelId: llmModelIdInput.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "连接失败");
    apiKeyInput.value = "";
    apiDialog.close();
    await checkStatus();
  } catch (error) {
    apiError.textContent = error.message;
  }
});

async function generateAvatar(plan = selectedPlan) {
  if (!plan) return;
  let prompt = buildPrompt(plan);
  if (referenceFiles.length) {
    prompt += "；附加上传图片仅作为人物外形、发型、服装与配饰参考，最终作品必须使用第一张固定样图的Q版插画画风，不要照搬照片背景。";
  }
  setBusy(true);
  downloadButton.hidden = true;
  resultBox.innerHTML = `<div class="empty-state"><div class="empty-face">⌛</div><p>正在生成</p><small>保持页面开启，通常需要一点时间</small></div>`;

  activeController = new AbortController();
  try {
    const images = await Promise.all(referenceFiles.map(fileToDataUrl));
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, images }),
      signal: activeController.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成失败");

    if (data.demo) {
      resultBox.innerHTML = `<div class="prompt-card"><strong>页面已经可以使用</strong><p>${escapeHtml(prompt)}</p><p class="hint">${escapeHtml(data.message)}</p></div>`;
    } else {
      latestImage = data.imageUrl;
      resultBox.innerHTML = `<img src="${encodeURI(data.imageUrl)}" alt="新生成的Q版头像" />`;
      downloadButton.hidden = false;
      endSessionButton.textContent = "下载照片并结束";
      sessionHint.textContent = "可以继续修改，也可以下载照片并结束";
      appendMessage("assistant", "新头像已经生成。你可以继续告诉我哪里需要修改。");
    }
  } catch (error) {
    if (error.name === "AbortError") {
      showCurrentResult("已停止生成");
    } else {
      resultBox.innerHTML = `<div class="error"><strong>这次没有生成成功</strong><br>${escapeHtml(error.message)}</div>`;
    }
  } finally {
    activeController = null;
    setBusy(false);
  }
}

window.generateAvatar = generateAvatar;

function downloadLatest() {
  if (!latestImage) return;
  const link = document.createElement("a");
  link.href = latestImage;
  link.download = `同画头像-${Date.now()}.png`;
  link.target = "_blank";
  link.click();
}

downloadButton.addEventListener("click", downloadLatest);

function setBusy(busy) {
  ideaButton.disabled = busy || !sessionActive;
  refineButton.disabled = busy || !sessionActive;
  referenceUpload.disabled = busy || !sessionActive;
  userRequest.disabled = busy || !sessionActive;
  feedbackInput.disabled = busy || !sessionActive;
  stopGenerationButton.hidden = !busy;
  endSessionButton.disabled = busy;
  sessionTitle.textContent = busy ? "正在创作" : (sessionActive ? "对话进行中" : "准备开始");
  if (busy) sessionHint.textContent = "正在理解需求并生成头像";
}

function showCurrentResult(message = "") {
  if (latestImage) {
    resultBox.innerHTML = `<img src="${encodeURI(latestImage)}" alt="新生成的Q版头像" />`;
    downloadButton.hidden = false;
  } else {
    resultBox.innerHTML = `<div class="empty-state"><div class="empty-face">◕‿◕</div><p>${escapeHtml(message || "说说你想要的头像")}</p><small>生成后可以继续修改</small></div>`;
    downloadButton.hidden = true;
  }
}

function resetConversation() {
  selectedPlan = null;
  latestImage = "";
  referenceFiles = [];
  userRequest.value = "";
  feedbackInput.value = "";
  referenceUpload.value = "";
  uploadPreview.innerHTML = "";
  conversationMessages = [];
  renderConversation();
  refineBox.hidden = true;
  thinkingNote.textContent = "豆包会先整理你的描述，再交给 Seedream 生成。";
  endSessionButton.textContent = "结束对话";
}

function startConversation() {
  resetConversation();
  sessionActive = true;
  workspace.classList.remove("session-inactive");
  startSessionButton.hidden = true;
  endSessionButton.hidden = false;
  sessionTitle.textContent = "对话进行中";
  sessionHint.textContent = "描述头像，生成后还可以继续修改";
  showCurrentResult();
  appendMessage("assistant", "你好，请告诉我你想要什么样的头像。生成后还可以继续修改。", false);
  setBusy(false);
  userRequest.focus();
}

function endConversation() {
  if (activeController) activeController.abort();
  if (latestImage) downloadLatest();
  sessionActive = false;
  resetConversation();
  workspace.classList.add("session-inactive");
  startSessionButton.hidden = false;
  stopGenerationButton.hidden = true;
  endSessionButton.hidden = true;
  sessionTitle.textContent = "本次对话已结束";
  sessionHint.textContent = "照片已下载，需要时可以重新开始";
  resultBox.innerHTML = `<div class="empty-state"><div class="empty-face">✓</div><p>本次对话已结束</p><small>点击“开始对话”创作下一张头像</small></div>`;
  setBusy(false);
}

startSessionButton.addEventListener("click", startConversation);
stopGenerationButton.addEventListener("click", () => activeController?.abort());
endSessionButton.addEventListener("click", endConversation);

function appendMessage(role, text, scroll = true) {
  const value = String(text || "").trim();
  if (!value) return;
  conversationMessages.push({ role, text: value });
  renderConversation();
  if (scroll) conversationHistory.scrollTop = conversationHistory.scrollHeight;
}

function renderConversation() {
  conversationHistory.innerHTML = conversationMessages.map(message => `
    <div class="message ${message.role}">
      <span>${message.role === "user" ? "你" : "头像助手"}</span>
      <p>${escapeHtml(message.text)}</p>
    </div>`).join("");
  conversationHistory.hidden = conversationMessages.length === 0;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

checkStatus();
setBusy(false);
