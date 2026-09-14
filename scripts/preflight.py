"""Read-only deployment checks; never creates a session or calls a paid model."""
import argparse
import json
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def check(base_url, *, origin=None, public=False, require_custom_ai=False, require_verified_content=False):
    parsed = urlsplit(base_url)
    if parsed.scheme not in {'http','https'} or not parsed.netloc or parsed.username or parsed.password:
        raise ValueError('需提供不含凭据的 HTTP(S) 服务地址')
    findings = []
    if public and parsed.scheme != 'https':
        findings.append('共享服务地址必须使用 HTTPS')
    request = Request(base_url.rstrip('/')+'/health', headers={'Origin':origin} if origin else {})
    with urlopen(request, timeout=10) as response:
        health = json.load(response)
        if response.headers.get('Cache-Control') != 'no-store':
            findings.append('健康响应缺少 no-store')
        if not response.headers.get('X-Request-ID'):
            findings.append('缺少请求追踪头')
        if origin and response.headers.get('Access-Control-Allow-Origin') != origin:
            findings.append('前端来源没有获得 CORS 许可')
    if health.get('status') != 'ok':
        findings.append('存储健康检查未通过')
    if require_custom_ai and health.get('ai_mode') != 'custom':
        findings.append('尚未配置真实 AI 模块')
    if require_verified_content and not health.get('original_verified'):
        findings.append('原文尚未核对')
    return {'ok':not findings,'ai_mode':health.get('ai_mode'),'flow':health.get('flow'),
            'findings':findings,'note':'配置预检不代表真实模型问答或前端播放器已通过验收'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:8000')
    parser.add_argument('--origin')
    parser.add_argument('--public', action='store_true')
    parser.add_argument('--require-custom-ai', action='store_true')
    parser.add_argument('--require-verified-content', action='store_true')
    args = parser.parse_args()
    try:
        result = check(args.base_url, origin=args.origin, public=args.public,
                       require_custom_ai=args.require_custom_ai, require_verified_content=args.require_verified_content)
    except Exception as exc:
        result = {'ok':False,'error_type':type(exc).__name__,'findings':['预检未完成，请检查服务地址和连接']}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(0 if result['ok'] else 1)
