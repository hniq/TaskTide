# 在 app.py 开头添加
from dotenv import load_dotenv
import os
# 加载 .env 文件里的环境变量
load_dotenv()
# 获取令牌
dashscope_key = os.getenv("DASHSCOPE_KEY")

#!/usr/bin/env python3
"""
TaskTide MVP Backend
零依赖 Python 后端，仅使用标准库
监听 0.0.0.0:7860，适配魔搭创空间部署
"""

import http.server
import socketserver
import json
import os
import mimetypes
import urllib.request
import urllib.error

# 配置
PORT = 7860
HOST = "0.0.0.0"
DASHSCOPE_KEY = os.environ.get("DASHSCOPE_KEY", "")
MODELSCOPE_API_URL = "https://api-inference.modelscope.cn/v1/chat/completions"
MODEL_NAME = "Qwen/Qwen3-8B"

# 前端静态文件目录（相对于 backend 目录）
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.normpath(os.path.join(BACKEND_DIR, "..", "frontend"))


class CORSHandler(http.server.BaseHTTPRequestHandler):
    """支持 CORS 的 HTTP 请求处理器"""
    
    def log_message(self, format, *args):
        """简化日志输出"""
        print(f"[{self.log_date_time_string()}] {args[0]}")
    
    def _send_cors_headers(self):
        """发送 CORS 响应头"""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
    
    def _send_json_response(self, data, status=200):
        """发送 JSON 响应"""
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))
    
    def _serve_static_file(self, filepath):
        """提供静态文件服务"""
        try:
            with open(filepath, 'rb') as f:
                content = f.read()
            
            # 猜测 MIME 类型
            content_type, _ = mimetypes.guess_type(filepath)
            if not content_type:
                # 根据扩展名设置默认 MIME 类型
                if filepath.endswith('.js'):
                    content_type = 'application/javascript'
                elif filepath.endswith('.css'):
                    content_type = 'text/css'
                elif filepath.endswith('.html'):
                    content_type = 'text/html'
                else:
                    content_type = 'application/octet-stream'
            
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
            return True
        except FileNotFoundError:
            return False
        except Exception as e:
            print(f"Error serving file {filepath}: {e}")
            return False
    
    def do_OPTIONS(self):
        """处理预检请求"""
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        """处理 GET 请求"""
        path = self.path
        print(f"[DEBUG] GET request: {path}")
        
        if path == "/health":
            # 健康检查端点（魔搭创空间要求）
            self._send_json_response({
                "status": "ok",
                "timestamp": __import__('datetime').datetime.now().isoformat()
            })
        elif path == "/api/info":
            # API 信息端点
            self._send_json_response({
                "service": "TaskTide MVP Backend",
                "version": "1.0.0",
                "endpoints": ["/health", "/api/parse-task", "/api/info"]
            })
        elif path.startswith("/api/"):
            # API 路径未找到
            self._send_json_response({"error": "Not found"}, 404)
        else:
            # 静态文件服务
            print(f"[DEBUG] Serving frontend for: {path}")
            self._serve_frontend(path)
    
    def _serve_frontend(self, path):
        """提供前端静态文件"""
        print(f"[DEBUG] _serve_frontend: path={path}, FRONTEND_DIR={FRONTEND_DIR}")
        
        # 默认返回 index.html
        if path == "/" or path == "":
            path = "index.html"
        else:
            # 移除开头的 /
            path = path.lstrip('/')
        
        # 安全路径检查，防止目录遍历攻击
        safe_path = os.path.normpath(path)
        print(f"[DEBUG] safe_path: {safe_path}")
        
        if safe_path.startswith('..'):
            self._send_json_response({"error": "Forbidden"}, 403)
            return
        
        # 构建完整文件路径（使用正斜杠统一处理）
        safe_path = safe_path.replace('\\', '/')
        filepath = os.path.join(FRONTEND_DIR, *safe_path.split('/'))
        print(f"[DEBUG] filepath: {filepath}, exists: {os.path.exists(filepath)}")
        
        # 检查文件是否存在
        if not os.path.exists(filepath) or not os.path.isfile(filepath):
            # 对于前端路由，返回 index.html（支持 SPA）
            index_path = os.path.join(FRONTEND_DIR, "index.html")
            print(f"[DEBUG] File not found, trying index.html: {index_path}, exists: {os.path.exists(index_path)}")
            if os.path.exists(index_path):
                self._serve_static_file(index_path)
            else:
                self._send_json_response({
                    "error": "Frontend not found",
                    "message": "请确保 frontend 目录存在且包含 index.html"
                }, 404)
            return
        
        # 提供静态文件
        if not self._serve_static_file(filepath):
            self._send_json_response({"error": "File not found"}, 404)
    
    def do_POST(self):
        """处理 POST 请求"""
        path = self.path
        
        if path == "/api/parse-task":
            self._handle_parse_task()
        else:
            self._send_json_response({"error": "Not found"}, 404)
    
    def _handle_parse_task(self):
        """处理 AI 任务拆分请求"""
        # 检查 API Key
        if not DASHSCOPE_KEY:
            self._send_json_response({
                "error": "DASHSCOPE_KEY not configured",
                "message": "请设置环境变量 DASHSCOPE_KEY"
            }, 500)
            return
        
        # 读取请求体
        content_length = int(self.headers.get('Content-Length', 0))
        if content_length == 0:
            self._send_json_response({"error": "Empty request body"}, 400)
            return
        
        try:
            body = self.rfile.read(content_length).decode('utf-8')
            data = json.loads(body)
            task_text = data.get('task', '').strip()
            
            if not task_text:
                self._send_json_response({"error": "Task text is required"}, 400)
                return
            
            # 调用魔搭 API
            result = self._call_modelscope_api(task_text)
            self._send_json_response(result)
            
        except json.JSONDecodeError:
            self._send_json_response({"error": "Invalid JSON"}, 400)
        except Exception as e:
            print(f"Error: {e}")
            self._send_json_response({"error": str(e)}, 500)
    
    def _call_modelscope_api(self, task_text):
        """调用魔搭推理 API"""
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
        
        # 创建请求
        req = urllib.request.Request(
            MODELSCOPE_API_URL,
            data=json.dumps(payload).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        
        # 发送请求（支持 HTTPS）
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                api_response = json.loads(response.read().decode('utf-8'))
                # 打印原始返回，看模型到底返回了什么
                print("=== 魔搭原始返回 ===")
                print(json.dumps(api_response, ensure_ascii=False, indent=2))
                
                # 提取AI返回的content（任务拆分的JSON字符串）
                assistant_content = api_response["choices"][0]["message"]["content"]
                
                # 把带换行的JSON字符串解析成真正的JSON对象
                try:
                    task_list = json.loads(assistant_content)
                    return {
                        "success": True,
                        "subtasks": task_list
                    }
                except json.JSONDecodeError as e:
                    return {
                        "success": False,
                        "error": "AI返回的格式不是合法JSON",
                        "raw_content": assistant_content
                    }
                    
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"API Error: {e.code} - {error_body}")
            return {
                "success": False,
                "error": f"API request failed: {e.code}",
                "details": error_body
            }
        except Exception as e:
            print(f"Request Error: {e}")
            return {
                "success": False,
                "error": f"Request failed: {str(e)}"
            }


class ReusableTCPServer(socketserver.TCPServer):
    """允许端口复用的 TCP 服务器"""
    allow_reuse_address = True


def run_server():
    """启动服务器"""
    print(f"=" * 50)
    print(f"TaskTide MVP Backend")
    print(f"=" * 50)
    print(f"Server:  http://{HOST}:{PORT}")
    print(f"Web:     http://{HOST}:{PORT}/ (前端页面)")
    print(f"Health:  http://{HOST}:{PORT}/health")
    print(f"API:     http://{HOST}:{PORT}/api/parse-task")
    print(f"=" * 50)
    print(f"FRONTEND_DIR: {FRONTEND_DIR}")
    print(f"Frontend exists: {os.path.exists(FRONTEND_DIR)}")
    print(f"=" * 50)
    
    if DASHSCOPE_KEY:
        masked_key = DASHSCOPE_KEY[:8] + "..." + DASHSCOPE_KEY[-4:] if len(DASHSCOPE_KEY) > 12 else "***"
        print(f"DASHSCOPE_KEY: {masked_key}")
    else:
        print("WARNING: DASHSCOPE_KEY not set!")
    print(f"=" * 50)
    print("Press Ctrl+C to stop")
    print()
    
    with ReusableTCPServer((HOST, PORT), CORSHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    run_server()
