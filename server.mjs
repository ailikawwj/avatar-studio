import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 4184);
let apiKey = process.env.SEEDREAM_API_KEY || "";
let modelId = process.env.SEEDREAM_MODEL || "doubao-seedream-5-0-flash-260915";
let llmModelId = process.env.DOUBAO_LLM_MODEL || "";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function referenceDataUrl() {
  const image = await fs.readFile(path.join(publicDir, "reference.png"));
  return `data:image/png;base64,${image.toString("base64")}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/status") {
      return json(res, 200, { connected: Boolean(apiKey), llmConnected: Boolean(apiKey && llmModelId) });
    }

    if (req.method === "POST" && req.url === "/api/configure") {
      const body = await readBody(req);
      const key = String(body.apiKey || "").trim();
      const model = String(body.modelId || "").trim();
      const llmModel = String(body.llmModelId || "").trim();
      if (!key) return json(res, 400, { error: "请填写完整的 API Key。" });
      if (!model) return json(res, 400, { error: "请填写控制台显示的 Model ID。" });
      apiKey = key;
      modelId = model;
      llmModelId = llmModel;
      return json(res, 200, { connected: true, llmConnected: Boolean(llmModelId), modelId, llmModelId });
    }

    if (req.method === "POST" && req.url === "/api/plan") {
      const body = await readBody(req);
      const description = String(body.description || "").trim();
      const feedback = String(body.feedback || "").trim();
      const currentPlan = body.currentPlan && typeof body.currentPlan === "object" ? body.currentPlan : null;
      if (!description && !feedback) return json(res, 400, { error: "先告诉我你想要什么样的头像。" });

      if (!apiKey || !llmModelId) {
        const subject = description || currentPlan?.summary || "亲切自然的人物";
        return json(res, 200, {
          demo: true,
          message: "连接豆包语言模型后，会自动把你的描述整理成更完整的绘图指令。",
          plan: currentPlan && feedback
            ? { title: "修改后的头像", summary: `${currentPlan.summary || subject}；修改要求：${feedback}`, details: feedback, characterPrompt: `${currentPlan.characterPrompt || subject}，根据新要求修改：${feedback}，腰部以上近景头像` }
            : { title: "你的头像", summary: subject, details: subject, characterPrompt: `${subject}，腰部以上近景头像` }
        });
      }

      const instruction = `你是固定画风头像设计助手。把用户的自然语言需求整理成一份准确、完整的头像人物设定，直接用于图像生成。必须保持固定Q版画风，不建议水墨、写实、3D等其他画风。不要擅自改变用户明确提出的性别、身份、服饰、配件和动作；只补足必要且不冲突的细节。构图只能是胸部以上或腰部以上近景头像，不能出现全身、腿、鞋、脚、地面、放在地上的物品或需要全身才能完成的姿势。需要球、书等道具时，只能抱在胸前或拿在上半身附近。返回 title、summary、details、characterPrompt 四个字段。characterPrompt只写人物内容，不写画风、尺寸、参考图、水印等技术要求，并明确写出“腰部以上近景头像”。只返回严格JSON，格式为 {"plan":{...}}，不要Markdown。`;
      const userContent = currentPlan
        ? `最初需求：${description}\n当前人物设定：${JSON.stringify(currentPlan)}\n用户的新修改：${feedback}\n请保留未被要求修改的内容，只调整用户明确提出的部分。`
        : `用户需求：${description}\n请补足对头像生成有帮助且不与原意冲突的细节。`;

      const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: llmModelId,
          messages: [
            { role: "system", content: instruction },
            { role: "user", content: userContent }
          ],
          temperature: 0.8,
          response_format: { type: "json_object" }
        })
      });
      const result = await response.json();
      if (!response.ok) return json(res, response.status, { error: result?.error?.message || result?.message || "豆包暂时没有给出方案。" });
      const raw = result?.choices?.[0]?.message?.content || "";
      let parsed;
      try { parsed = JSON.parse(raw); } catch { return json(res, 502, { error: "豆包返回的方案格式不正确，请再试一次。" }); }
      const plan = parsed.plan && typeof parsed.plan === "object" ? parsed.plan : parsed;
      if (!plan.characterPrompt) return json(res, 502, { error: "豆包没有返回可用的人物设定，请再试一次。" });
      return json(res, 200, { plan });
    }

    if (req.method === "POST" && req.url === "/api/generate") {
      const body = await readBody(req);
      if (!apiKey) {
        return json(res, 200, {
          demo: true,
          prompt: body.prompt,
          message: "页面已准备好。填入 Seedream API 密钥后即可真实生成。",
        });
      }

      const uploadedImages = Array.isArray(body.images)
        ? body.images.slice(0, 2).filter(value => /^data:image\/(png|jpeg|webp);base64,/i.test(value))
        : [];
      const response = await fetch("https://ark.cn-beijing.volces.com/api/v3/images/generations", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelId,
          prompt: body.prompt,
          image: [await referenceDataUrl(), ...uploadedImages],
          size: "1.5K",
          response_format: "url",
          watermark: false,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        return json(res, response.status, {
          error: result?.error?.message || result?.message || "图片生成失败，请检查 API 配置。",
        });
      }

      const imageUrl = result?.data?.[0]?.url;
      const imageBase64 = result?.data?.[0]?.b64_json;
      const generatedDir = path.join(publicDir, "generated");
      await fs.mkdir(generatedDir, { recursive: true });
      const filename = `avatar-${Date.now()}.png`;
      const outputPath = path.join(generatedDir, filename);

      if (imageBase64) {
        await fs.writeFile(outputPath, Buffer.from(imageBase64, "base64"));
      } else if (imageUrl) {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error("图片已经生成，但下载临时图片失败，请再试一次。");
        await fs.writeFile(outputPath, Buffer.from(await imageResponse.arrayBuffer()));
      } else {
        return json(res, 502, { error: "接口返回成功，但没有找到图片内容。" });
      }

      return json(res, 200, { imageUrl: `/generated/${filename}` });
    }

    if (req.method !== "GET") return json(res, 405, { error: "Method not allowed" });
    const pathname = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
    const filePath = path.resolve(publicDir, `.${pathname}`);
    if (!filePath.startsWith(path.resolve(publicDir))) return json(res, 403, { error: "Forbidden" });
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return json(res, 404, { error: "Not found" });
    json(res, 500, { error: error.message || "服务器出错了。" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`头像工坊已启动：http://127.0.0.1:${port}`);
});
