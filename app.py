#!/usr/bin/env python3
"""
TaskTide - 完整版
根路径提供完整HTML前端应用，API端点供前端调用
"""

import os
import json
import urllib.request
import urllib.error
import mimetypes

# 配置
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
DASHSCOPE_KEY = os.environ.get("DASHSCOPE_KEY", "")
MODELSCOPE_API_URL = "https://api-inference.modelscope.cn/v1/chat/completions"
MODEL_NAME = "Qwen/Qwen3-8B"

print("=" * 50)
print("TaskTide - DDL任务规划器")
print("=" * 50)
print(f"FRONTEND_DIR: {FRONTEND_DIR}")
print(f"Frontend exists: {os.path.exists(FRONTEND_DIR)}")
if os.path.exists(FRONTEND_DIR):
    for root, dirs, files in os.walk(FRONTEND_DIR):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), FRONTEND_DIR)
            print(f"  -> {rel}")
print(f"DASHSCOPE_KEY set: {bool(DASHSCOPE_KEY)}")
print(f"MODEL: {MODEL_NAME}")
print("=" * 50)


def call_model_api(task_text):
    """调用魔搭模型API"""
    if not DASHSCOPE_KEY:
        return None, "DASHSCOPE_KEY 未配置"

    prompt = f"""请将以下任务拆分为子任务列表，返回 JSON 格式：

任务：{task_text}

要求：
1. 分析任务并拆分为 2-6 个可执行的子任务
2. 每个子任务包含：title（标题）、estimatedHours（预估小时数，0.5-8小时）
3. 只返回 JSON 数组，不要其他文字

示例格式：
[
  {{"title": "子任务1", "estimatedHours": 2}},
  {{"title": "子任务2", "estimatedHours": 1.5}}
]"""

    payload = {
        "model": MODEL_NAME,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 2000,
        "enable_thinking": False
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DASHSCOPE_KEY}"
    }

    try:
        req = urllib.request.Request(
            MODELSCOPE_API_URL,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        with urllib.request.urlopen(req, timeout=60) as response:
            api_response = json.loads(response.read().decode('utf-8'))
            content = api_response["choices"][0]["message"]["content"]
            try:
                subtasks = json.loads(content)
                return {"success": True, "subtasks": subtasks}, None
            except json.JSONDecodeError:
                return {"success": True, "subtasks": [], "raw": content}, None
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        return None, f"API错误 {e.code}: {error_body}"
    except Exception as e:
        return None, f"请求异常: {str(e)}"


# ============ FastAPI 应用 ============
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response
import uvicorn

app = FastAPI(title="TaskTide")


# --- API 端点 ---

@app.get("/health")
async def health():
    return {"status": "ok", "dashscope_key": bool(DASHSCOPE_KEY)}


@app.post("/api/parse-task")
async def api_parse_task(request: Request):
    try:
        data = await request.json()
        task_text = data.get("task", "").strip()
        if not task_text:
            return JSONResponse({"success": False, "error": "task is required"}, status_code=400)
        result, error = call_model_api(task_text)
        if error:
            return JSONResponse({"success": False, "error": error}, status_code=500)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)


@app.get("/api/info")
async def api_info():
    return {
        "service": "TaskTide",
        "version": "2.1.0",
        "endpoints": ["/health", "/api/parse-task", "/api/info"]
    }


# --- 前端静态文件（根路径 / 直接提供完整HTML应用）---

def _read_file(filepath):
    """读取文件并返回 (content_bytes, content_type)"""
    content_type, _ = mimetypes.guess_type(filepath)
    if not content_type:
        if filepath.endswith('.js'):
            content_type = 'application/javascript'
        elif filepath.endswith('.mjs'):
            content_type = 'application/javascript'
        elif filepath.endswith('.css'):
            content_type = 'text/css'
        elif filepath.endswith('.html'):
            content_type = 'text/html; charset=utf-8'
        elif filepath.endswith('.json'):
            content_type = 'application/json'
        elif filepath.endswith('.svg'):
            content_type = 'image/svg+xml'
        elif filepath.endswith('.png'):
            content_type = 'image/png'
        elif filepath.endswith('.ico'):
            content_type = 'image/x-icon'
        else:
            content_type = 'application/octet-stream'

    with open(filepath, 'rb') as f:
        return f.read(), content_type


@app.get("/{path:path}")
async def serve_frontend(path: str = ""):
    """根路径下提供完整HTML前端应用"""
    # 空路径 → index.html
    if not path or path == "" or path == "/":
        path = "index.html"

    file_path = os.path.normpath(os.path.join(FRONTEND_DIR, path))

    # 安全：防止目录遍历
    if not file_path.startswith(os.path.normpath(FRONTEND_DIR)):
        return JSONResponse({"error": "Forbidden"}, status_code=403)

    # 文件存在则直接返回
    if os.path.isfile(file_path):
        try:
            content, ctype = _read_file(file_path)
            return Response(content=content, media_type=ctype)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    # 文件不存在 → 返回 index.html（SPA路由支持）
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_path):
        try:
            content, ctype = _read_file(index_path)
            return Response(content=content, media_type=ctype)
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    return JSONResponse({"error": "Frontend not found"}, status_code=404)


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("Starting TaskTide server...")
    print("=" * 50)
    print("Frontend:  http://0.0.0.0:7860/")
    print("API:       http://0.0.0.0:7860/api/parse-task")
    print("Health:    http://0.0.0.0:7860/health")
    print("=" * 50 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=7860)
